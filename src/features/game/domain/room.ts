import type { Locale } from '../../../shared/domain/locale.js';
import type { RoomCode } from '../../../shared/domain/room-code.js';
import type { UserId } from '../../../shared/domain/user-id.js';
import { GameError, GameErrorCode } from './game-error.js';
import type { GameOption } from './game-option.js';
import type { Nickname } from './nickname.js';
import { PhaseType, type Phase } from './phase.js';
import { PLAYER_COLORS, type PlayerColor } from './player-color.js';
import { RoomEventType, type RoomEvent } from './room-event.js';

export interface Player {
  readonly userId: UserId;
  readonly nickname: Nickname;
  readonly color: PlayerColor;
  isConnected: boolean;
}

const PLAYERS_CHANGED: RoomEvent = { type: RoomEventType.PlayersChanged };

export class Room {
  #hostId: UserId;
  readonly #players: Player[] = [];
  #phase: Phase = { type: PhaseType.Wait };
  #emptySince: number | null = null;

  private constructor(
    readonly id: RoomCode,
    readonly locale: Locale,
    readonly isQuickStart: boolean,
    readonly option: GameOption,
    hostId: UserId,
  ) {
    this.#hostId = hostId;
  }

  static create(params: {
    id: RoomCode;
    locale: Locale;
    isQuickStart: boolean;
    option: GameOption;
    hostId: UserId;
    hostNickname: Nickname;
  }): Room {
    const room = new Room(params.id, params.locale, params.isQuickStart, params.option, params.hostId);
    room.addPlayer(params.hostId, params.hostNickname);
    return room;
  }

  get hostId(): UserId {
    return this.#hostId;
  }

  /** In join order. */
  get players(): readonly Readonly<Player>[] {
    return this.#players;
  }

  get phase(): Phase {
    return this.#phase;
  }

  /** When the last connected player went away; null while someone is connected. */
  get emptySince(): number | null {
    return this.#emptySince;
  }

  get isInGame(): boolean {
    return this.#phase.type !== PhaseType.Wait;
  }

  get isEmpty(): boolean {
    return this.#players.length === 0;
  }

  hasPlayer(userId: UserId): boolean {
    return this.#find(userId) !== undefined;
  }

  isConnected(userId: UserId): boolean {
    return this.#find(userId)?.isConnected ?? false;
  }

  /** Throws when a new player could not join right now. */
  assertJoinable(): void {
    if (this.isInGame) {
      throw new GameError(GameErrorCode.RoomInGame);
    }
    if (this.#players.length >= this.option.maxPlayers) {
      throw new GameError(GameErrorCode.RoomFull);
    }
  }

  addPlayer(userId: UserId, nickname: Nickname): RoomEvent[] {
    this.assertJoinable();
    const used = new Set(this.#players.map((p) => p.color));
    const color = PLAYER_COLORS.find((c) => !used.has(c));
    if (color === undefined) {
      throw new GameError(GameErrorCode.RoomFull);
    }
    this.#players.push({ userId, nickname, color, isConnected: true });
    this.#emptySince = null;
    return [PLAYERS_CHANGED];
  }

  /** Hands the host role to the earliest remaining joiner. */
  removePlayer(userId: UserId, now: number): RoomEvent[] {
    const index = this.#players.findIndex((p) => p.userId === userId);
    if (index < 0) {
      return [];
    }
    this.#players.splice(index, 1);
    const next = this.#players[0];
    if (userId === this.#hostId && next !== undefined) {
      this.#hostId = next.userId;
    }
    this.#updateEmptySince(now);
    return [PLAYERS_CHANGED];
  }

  setConnected(userId: UserId, isConnected: boolean, now: number): RoomEvent[] {
    const player = this.#find(userId);
    if (player === undefined || player.isConnected === isConnected) {
      return [];
    }
    player.isConnected = isConnected;
    this.#updateEmptySince(now);
    return [PLAYERS_CHANGED];
  }

  #updateEmptySince(now: number): void {
    const anyoneConnected = this.#players.some((p) => p.isConnected);
    this.#emptySince = anyoneConnected ? null : (this.#emptySince ?? now);
  }

  #find(userId: UserId): Player | undefined {
    return this.#players.find((p) => p.userId === userId);
  }
}
