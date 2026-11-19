import type { UserId } from '../../../shared/domain/user-id.js';
import type { Keyword } from './keyword.js';
import type { Role } from './role.js';

export enum PhaseType {
  Wait = 'wait',
  Ready = 'ready',
  Drawing = 'drawing',
  Vote = 'vote',
  Answer = 'answer',
  End = 'end',
}

/** Fixed when a game starts. */
export interface Game {
  readonly mafiaId: UserId;
  readonly category: string;
  readonly keyword: Keyword;
  readonly turnOrder: readonly UserId[];
}

export interface Canvas {
  readonly w: number;
  readonly h: number;
}

/** Point arrays of equal length; the server relays them without interpreting them. */
export interface Stroke {
  readonly x: readonly number[];
  readonly y: readonly number[];
  readonly t: readonly number[];
}

export interface Sketch {
  readonly userId: UserId;
  readonly canvas: Canvas;
  readonly strokes: readonly Stroke[];
}

export interface Turn {
  readonly round: number;
  readonly turn: number;
  readonly drawerId: UserId;
  readonly startedAt: number;
  /** Drawing opens here, after the round's animations. */
  readonly drawFrom: number;
  readonly deadline: number;
}

export interface Result {
  readonly mafiaId: UserId;
  /** Null when the vote named nobody. */
  readonly accusedId: UserId | null;
  readonly mafiaGuess: string | null;
  readonly winner: Role;
}

export type Phase =
  | { readonly type: PhaseType.Wait }
  | { readonly type: PhaseType.Ready; readonly game: Game; readonly deadline: number }
  | {
      readonly type: PhaseType.Drawing;
      readonly game: Game;
      readonly turn: Turn;
      readonly sketches: readonly Sketch[];
      /** What the drawer has drawn so far this turn. */
      readonly current: Sketch | null;
    }
  | {
      readonly type: PhaseType.Vote;
      readonly game: Game;
      readonly sketches: readonly Sketch[];
      /** Voter → target. */
      readonly votes: ReadonlyMap<UserId, UserId>;
      readonly deadline: number;
    }
  | {
      readonly type: PhaseType.Answer;
      readonly game: Game;
      readonly sketches: readonly Sketch[];
      readonly typing: string;
      readonly deadline: number;
    }
  | {
      readonly type: PhaseType.End;
      readonly game: Game;
      readonly sketches: readonly Sketch[];
      readonly result: Result;
      readonly deadline: number;
    };
