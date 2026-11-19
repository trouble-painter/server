import type { Locale } from '../../../shared/domain/locale.js';
import type { RoomCode } from '../../../shared/domain/room-code.js';
import type { UserId } from '../../../shared/domain/user-id.js';
import { GameError, GameErrorCode } from './game-error.js';
import type { GameOption } from './game-option.js';
import { assertValidRule, defaultRule, type GameRule } from './game-rule.js';
import { isCorrectGuess } from './keyword.js';
import type { Nickname } from './nickname.js';
import { PhaseType, type Canvas, type Game, type Phase, type Result, type Sketch, type Stroke } from './phase.js';
import { PLAYER_COLORS, type PlayerColor } from './player-color.js';
import type { Reaction } from './reaction.js';
import { RoomEventType, type RoomEvent } from './room-event.js';
import { ROOM_SNAPSHOT_VERSION, type RoomSnapshot } from './room-snapshot.js';
import { Role } from './role.js';
import { scheduleTurn } from './rules/turn-timing.js';
import { accusedBy } from './rules/vote-tally.js';

export interface Player {
  readonly userId: UserId;
  readonly nickname: Nickname;
  readonly color: PlayerColor;
  isConnected: boolean;
}

const PLAYERS_CHANGED: RoomEvent = { type: RoomEventType.PlayersChanged };
const PHASE_CHANGED: RoomEvent = { type: RoomEventType.PhaseChanged };
const RULE_CHANGED: RoomEvent = { type: RoomEventType.RuleChanged };

type PhaseOf<T extends PhaseType> = Extract<Phase, { type: T }>;

export class Room {
  #hostId: UserId;
  #rule: GameRule;
  readonly #players: Player[] = [];
  #phase: Phase = { type: PhaseType.Wait };
  #emptySince: number | null = null;
  #version = 0;

  private constructor(
    readonly id: RoomCode,
    readonly locale: Locale,
    readonly isQuickStart: boolean,
    readonly option: GameOption,
    hostId: UserId,
    rule: GameRule,
  ) {
    this.#hostId = hostId;
    this.#rule = rule;
  }

  static create(params: {
    id: RoomCode;
    locale: Locale;
    isQuickStart: boolean;
    option: GameOption;
    hostId: UserId;
    hostNickname: Nickname;
  }): Room {
    const room = new Room(
      params.id,
      params.locale,
      params.isQuickStart,
      params.option,
      params.hostId,
      defaultRule(params.option.defaultStrokesPerTurn),
    );
    room.addPlayer(params.hostId, params.hostNickname);
    return room;
  }

  static fromSnapshot(snapshot: RoomSnapshot): Room {
    const room = new Room(snapshot.id, snapshot.locale, snapshot.isQuickStart, snapshot.option, snapshot.hostId, snapshot.rule);
    room.#players.push(...snapshot.players.map((p) => ({ ...p })));
    const phase = snapshot.phase;
    room.#phase = phase.type === PhaseType.Vote ? { ...phase, votes: new Map(phase.votes) } : phase;
    room.#emptySince = snapshot.emptySince;
    room.#version = snapshot.version;
    return room;
  }

  toSnapshot(): RoomSnapshot {
    const phase = this.#phase;
    return {
      v: ROOM_SNAPSHOT_VERSION,
      id: this.id,
      locale: this.locale,
      isQuickStart: this.isQuickStart,
      option: this.option,
      rule: this.#rule,
      hostId: this.#hostId,
      players: this.#players.map((p) => ({ ...p })),
      phase: phase.type === PhaseType.Vote ? { ...phase, votes: [...phase.votes] } : phase,
      emptySince: this.#emptySince,
      version: this.#version,
    };
  }

  get hostId(): UserId {
    return this.#hostId;
  }

  get rule(): GameRule {
    return this.#rule;
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

  /** Goes up on every phase or turn change, so a timer armed for an earlier one can tell it is stale. */
  get version(): number {
    return this.#version;
  }

  /** When the current phase or turn ends on its own; null while waiting or once the game is over. */
  get deadline(): number | null {
    const phase = this.#phase;
    switch (phase.type) {
      case PhaseType.Wait:
      case PhaseType.End:
        return null;
      case PhaseType.Drawing:
        return phase.turn.deadline;
      case PhaseType.Ready:
      case PhaseType.Vote:
      case PhaseType.Answer:
        return phase.deadline;
    }
  }

  get isInGame(): boolean {
    return this.#phase.type !== PhaseType.Wait;
  }

  /** The result is out and the caller should {@link closeGame}. */
  get isOver(): boolean {
    return this.#phase.type === PhaseType.End;
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

  /** The first player into an empty room becomes its host. */
  addPlayer(userId: UserId, nickname: Nickname): RoomEvent[] {
    this.assertJoinable();
    if (this.#players.length === 0) {
      this.#hostId = userId;
    }
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

  /** Only the host of a waiting custom room; `allCategoryIds` are every category of the room's locale. */
  updateRule(userId: UserId, rule: GameRule, allCategoryIds: readonly string[]): RoomEvent[] {
    this.#phaseOf(PhaseType.Wait);
    if (this.isQuickStart) {
      throw new GameError(GameErrorCode.InvalidRequest);
    }
    if (userId !== this.#hostId) {
      throw new GameError(GameErrorCode.NotHost);
    }
    assertValidRule(rule, allCategoryIds);
    this.#rule = { strokesPerTurn: rule.strokesPerTurn, categoryIds: [...rule.categoryIds] };
    return [RULE_CHANGED];
  }

  /** Throws unless the user may start a game now; checked before the caller draws roles and keyword. */
  assertCanStart(userId: UserId): void {
    this.#phaseOf(PhaseType.Wait);
    if (userId !== this.#hostId) {
      throw new GameError(GameErrorCode.NotHost);
    }
    if (this.#players.filter((p) => p.isConnected).length < this.option.minPlayers) {
      throw new GameError(GameErrorCode.NotEnoughPlayers);
    }
  }

  /** `game.turnOrder` holds every player, disconnected ones included. */
  start(userId: UserId, game: Game, now: number): RoomEvent[] {
    this.assertCanStart(userId);
    this.#enter({ type: PhaseType.Ready, game, deadline: now + this.option.readyMs });
    return [PHASE_CHANGED];
  }

  /** `index` replaces the last stroke or appends the next one. */
  drawStroke(userId: UserId, index: number, stroke: Stroke, canvas: Canvas, now: number): RoomEvent[] {
    const phase = this.#drawerPhase(userId);
    if (now < phase.turn.drawFrom) {
      throw new GameError(GameErrorCode.InvalidPhase);
    }
    const strokes = phase.current?.strokes ?? [];
    const isReplace = index === strokes.length - 1;
    const maxStrokes = this.#rule.strokesPerTurn;
    if ((!isReplace && index !== strokes.length) || (maxStrokes !== null && index >= maxStrokes)) {
      throw new GameError(GameErrorCode.InvalidRequest);
    }
    const next = isReplace ? strokes.with(index, stroke) : [...strokes, stroke];
    this.#phase = { ...phase, current: { userId, canvas, strokes: next } };
    return [{ type: RoomEventType.StrokeUpdated, drawerId: userId, index, stroke, canvas }];
  }

  /** Drops every stroke of this turn, so drawing starts again from index 0. */
  clearSketch(userId: UserId, now: number): RoomEvent[] {
    const phase = this.#drawerPhase(userId);
    if (now < phase.turn.drawFrom) {
      throw new GameError(GameErrorCode.InvalidPhase);
    }
    this.#phase = { ...phase, current: null };
    return [{ type: RoomEventType.SketchCleared, drawerId: userId }];
  }

  endTurn(userId: UserId, now: number): RoomEvent[] {
    return this.#nextTurn(this.#drawerPhase(userId), now);
  }

  react(userId: UserId, reaction: Reaction): RoomEvent[] {
    this.#phaseOf(PhaseType.Drawing);
    return [{ type: RoomEventType.ReactionSent, userId, reaction }];
  }

  /** Voting again changes the vote, and a vote for oneself counts. Tallied only at the deadline. */
  vote(userId: UserId, targetId: UserId): RoomEvent[] {
    const phase = this.#phaseOf(PhaseType.Vote);
    if (!phase.game.turnOrder.includes(targetId)) {
      throw new GameError(GameErrorCode.InvalidRequest);
    }
    const votes = new Map(phase.votes).set(userId, targetId);
    this.#phase = { ...phase, votes };
    return [{ type: RoomEventType.VotesChanged, votes }];
  }

  typeAnswer(userId: UserId, answer: string): RoomEvent[] {
    const phase = this.#mafiaAnswerPhase(userId);
    this.#phase = { ...phase, typing: answer };
    return [{ type: RoomEventType.AnswerTyped, mafiaId: userId, answer }];
  }

  submitAnswer(userId: UserId, answer: string): RoomEvent[] {
    return this.#judgeAnswer(this.#mafiaAnswerPhase(userId), answer);
  }

  /** Everyone leaves once the result is out, so playing again means joining the room afresh. */
  closeGame(now: number): void {
    this.#phaseOf(PhaseType.End);
    this.#players.length = 0;
    this.#enter({ type: PhaseType.Wait });
    this.#updateEmptySince(now);
  }

  /** Moves on when the deadline armed at `version` passes; does nothing if the room has moved on since. */
  expire(version: number, now: number): RoomEvent[] {
    if (version !== this.#version) {
      return [];
    }
    const phase = this.#phase;
    switch (phase.type) {
      case PhaseType.Wait:
      case PhaseType.End:
        return [];
      case PhaseType.Ready: {
        const drawerId = this.#drawerAt(phase.game, 0);
        const turn = scheduleTurn(this.option, 0, 0, drawerId, now);
        this.#enter({ type: PhaseType.Drawing, game: phase.game, turn, sketches: [], current: null });
        return [PHASE_CHANGED];
      }
      case PhaseType.Drawing:
        return this.#nextTurn(phase, now);
      case PhaseType.Vote:
        return this.#tally(phase, now);
      case PhaseType.Answer:
        return this.#judgeAnswer(phase, phase.typing);
    }
  }

  /**
   * After a restart nobody is connected yet: everyone is marked away, and a running deadline
   * is pushed to at least `now + graceMs` so players have time to reconnect.
   */
  resumeAfterRestart(now: number, graceMs: number): void {
    for (const player of this.#players) {
      player.isConnected = false;
    }
    this.#emptySince = now;
    const earliest = now + graceMs;
    const phase = this.#phase;
    switch (phase.type) {
      case PhaseType.Wait:
      // The caller closes a finished game instead.
      case PhaseType.End:
        return;
      case PhaseType.Drawing:
        this.#phase = { ...phase, turn: { ...phase.turn, deadline: Math.max(phase.turn.deadline, earliest) } };
        return;
      case PhaseType.Ready:
      case PhaseType.Vote:
      case PhaseType.Answer:
        this.#phase = { ...phase, deadline: Math.max(phase.deadline, earliest) };
        return;
    }
  }

  #nextTurn(phase: PhaseOf<PhaseType.Drawing>, now: number): RoomEvent[] {
    const { game, current } = phase;
    const sketches = current === null ? phase.sketches : [...phase.sketches, current];
    const turn = (phase.turn.turn + 1) % game.turnOrder.length;
    const round = turn === 0 ? phase.turn.round + 1 : phase.turn.round;
    if (round >= this.option.rounds) {
      this.#enter({ type: PhaseType.Vote, game, sketches, votes: new Map(), deadline: now + this.option.voteMs });
      return [PHASE_CHANGED];
    }
    const next = scheduleTurn(this.option, round, turn, this.#drawerAt(game, turn), now);
    this.#enter({ type: PhaseType.Drawing, game, turn: next, sketches, current: null });
    return [{ type: RoomEventType.TurnChanged, turn: next, sketch: current }];
  }

  /** Only a caught mafia gets to guess; otherwise the mafia has already won. */
  #tally(phase: PhaseOf<PhaseType.Vote>, now: number): RoomEvent[] {
    const { game, sketches } = phase;
    const accusedId = accusedBy(phase.votes);
    if (accusedId === game.mafiaId) {
      this.#enter({ type: PhaseType.Answer, game, sketches, typing: '', deadline: now + this.option.answerMs });
      return [PHASE_CHANGED];
    }
    return this.#end(game, sketches, { mafiaId: game.mafiaId, accusedId, mafiaGuess: null, winner: Role.Mafia });
  }

  #judgeAnswer(phase: PhaseOf<PhaseType.Answer>, guess: string): RoomEvent[] {
    const { game, sketches } = phase;
    const winner = isCorrectGuess(guess, game.keyword) ? Role.Mafia : Role.Citizen;
    return this.#end(game, sketches, { mafiaId: game.mafiaId, accusedId: game.mafiaId, mafiaGuess: guess, winner });
  }

  #end(game: Game, sketches: readonly Sketch[], result: Result): RoomEvent[] {
    this.#enter({ type: PhaseType.End, game, sketches, result });
    return [PHASE_CHANGED];
  }

  #enter(phase: Phase): void {
    this.#phase = phase;
    this.#version++;
  }

  #phaseOf<T extends PhaseType>(type: T): PhaseOf<T> {
    if (this.#phase.type !== type) {
      throw new GameError(GameErrorCode.InvalidPhase);
    }
    return this.#phase as PhaseOf<T>;
  }

  #drawerPhase(userId: UserId): PhaseOf<PhaseType.Drawing> {
    const phase = this.#phaseOf(PhaseType.Drawing);
    if (phase.turn.drawerId !== userId) {
      throw new GameError(GameErrorCode.NotYourTurn);
    }
    return phase;
  }

  #mafiaAnswerPhase(userId: UserId): PhaseOf<PhaseType.Answer> {
    const phase = this.#phaseOf(PhaseType.Answer);
    if (phase.game.mafiaId !== userId) {
      throw new GameError(GameErrorCode.NotYourTurn);
    }
    return phase;
  }

  #drawerAt(game: Game, turn: number): UserId {
    const drawerId = game.turnOrder[turn];
    if (drawerId === undefined) {
      throw new Error(`no drawer for turn ${turn}`);
    }
    return drawerId;
  }

  #updateEmptySince(now: number): void {
    const anyoneConnected = this.#players.some((p) => p.isConnected);
    this.#emptySince = anyoneConnected ? null : (this.#emptySince ?? now);
  }

  #find(userId: UserId): Player | undefined {
    return this.#players.find((p) => p.userId === userId);
  }
}
