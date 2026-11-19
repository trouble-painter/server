import type { UserId } from '../../../shared/domain/user-id.js';
import type { Room } from '../domain/room.js';
import type { GameStartPushSender } from './ports/game-start-push-sender.js';

/**
 * Remembers each user's push token and tells a room's players when their game starts.
 * Kept in memory only: the app sends its token again after every HELLO.
 */
export class GameStartPush {
  readonly #tokenOf = new Map<UserId, string>();
  readonly #userOf = new Map<string, UserId>();

  constructor(private readonly sender: GameStartPushSender) {}

  /** A device has one token; signing in as a new user moves it, so the maps stay one entry per device. */
  register(userId: UserId, token: string): void {
    const previousUser = this.#userOf.get(token);
    if (previousUser !== undefined) {
      this.#tokenOf.delete(previousUser);
    }
    const previousToken = this.#tokenOf.get(userId);
    if (previousToken !== undefined) {
      this.#userOf.delete(previousToken);
    }
    this.#tokenOf.set(userId, token);
    this.#userOf.set(token, userId);
  }

  /** `except` started the game, so they are looking at the app. */
  notify(room: Room, except?: UserId): void {
    const tokens = room.players
      .filter((p) => p.userId !== except)
      .flatMap((p) => this.#tokenOf.get(p.userId) ?? []);
    if (tokens.length > 0) {
      this.sender.notifyGameStarted(room.locale, tokens);
    }
  }
}
