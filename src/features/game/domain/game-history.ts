import type { Locale } from '../../../shared/domain/locale.js';
import type { RoomCode } from '../../../shared/domain/room-code.js';
import type { UserId } from '../../../shared/domain/user-id.js';
import type { GameOption } from './game-option.js';
import type { GameRule } from './game-rule.js';
import type { Nickname } from './nickname.js';
import type { Canvas, Game, PhaseType, Result, Stroke } from './phase.js';
import type { PlayerColor } from './player-color.js';
import type { Reaction } from './reaction.js';
import type { Role } from './role.js';

export enum HistoryEventType {
  Turn = 'turn',
  Stroke = 'stroke',
  StrokeUndone = 'strokeUndone',
  SketchCleared = 'sketchCleared',
  Reaction = 'reaction',
  Votes = 'votes',
  Answer = 'answer',
  Phase = 'phase',
  Result = 'result',
}

/**
 * One thing that happened in a game. Every time (`at`, `endAt`, `drawFromAt`, `deadlineAt`) is
 * milliseconds since the game started, on the server's clock, so a replay needs no wall clock.
 */
export type HistoryEvent =
  | {
      readonly type: HistoryEventType.Turn;
      readonly at: number;
      readonly round: number;
      readonly turn: number;
      readonly drawerId: UserId;
      /** Drawing opens here, after the round's animations. */
      readonly drawFromAt: number;
      readonly deadlineAt: number;
    }
  /**
   * The last version of one stroke. `at` is when its first points arrived and `endAt` when its last
   * did, so `endAt - at` is how long drawing it took, whatever `stroke.t` kept after the app
   * dropped points. A later stroke with the same `index` replaces this one (after an undo, or a
   * stroke that was split by another event).
   */
  | {
      readonly type: HistoryEventType.Stroke;
      readonly at: number;
      readonly endAt: number;
      readonly drawerId: UserId;
      readonly index: number;
      readonly stroke: Stroke;
      readonly canvas: Canvas;
    }
  | { readonly type: HistoryEventType.StrokeUndone; readonly at: number; readonly drawerId: UserId }
  | { readonly type: HistoryEventType.SketchCleared; readonly at: number; readonly drawerId: UserId }
  | { readonly type: HistoryEventType.Reaction; readonly at: number; readonly userId: UserId; readonly reaction: Reaction }
  /** Everyone's current vote as `[voter, target]` pairs. */
  | { readonly type: HistoryEventType.Votes; readonly at: number; readonly votes: readonly (readonly [UserId, UserId])[] }
  | { readonly type: HistoryEventType.Answer; readonly at: number; readonly mafiaId: UserId; readonly answer: string }
  /** The game moved on to voting or to the mafia's guess. */
  | {
      readonly type: HistoryEventType.Phase;
      readonly at: number;
      readonly phase: PhaseType.Vote | PhaseType.Answer;
      readonly deadlineAt: number;
    }
  | { readonly type: HistoryEventType.Result; readonly at: number; readonly result: Result };

export interface GameHistoryPlayer {
  readonly userId: UserId;
  readonly nickname: Nickname;
  readonly color: PlayerColor;
  /** Sent LEAVE_ROOM at some point during the game, so did not play it through; a lost connection does not count. */
  readonly hasLeft: boolean;
}

/** What the game was played with; fixed when it starts. */
export interface GameMeta {
  readonly locale: Locale;
  readonly isQuickStart: boolean;
  readonly option: GameOption;
  readonly rule: GameRule;
  readonly players: readonly GameHistoryPlayer[];
  readonly game: Game;
}

/** A finished game, ready to be saved. `events` are in the order they happened. */
export interface GameRecord {
  readonly roomId: RoomCode;
  readonly startedAt: number;
  readonly endedAt: number;
  readonly winner: Role;
  readonly meta: GameMeta;
  readonly events: readonly HistoryEvent[];
}
