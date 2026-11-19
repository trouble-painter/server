import { PLAYER_COLORS } from './player-color.js';

/** Fixed by the rules rather than configured: every player needs a distinct color. */
export const PLAYER_COUNT = {
  minPlayers: 3,
  maxPlayers: PLAYER_COLORS.length,
} as const;

/** All durations are milliseconds. */
export interface GameOption {
  readonly minPlayers: number;
  readonly maxPlayers: number;
  readonly readyMs: number;
  readonly introAnimationMs: number;
  readonly roundAnimationMs: number;
  readonly rounds: number;
  readonly turnMs: number;
  /** What a new room's rule starts with and what a host resets it to. */
  readonly defaultStrokesPerTurn: number;
  readonly voteMs: number;
  readonly answerMs: number;
}
