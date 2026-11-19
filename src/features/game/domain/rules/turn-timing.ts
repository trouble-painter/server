import type { UserId } from '../../../../shared/domain/user-id.js';
import type { GameOption } from '../game-option.js';
import type { Turn } from '../phase.js';

/** The first turn plays the intro and round animations, each round's first turn the round animation. */
export function scheduleTurn(option: GameOption, round: number, turn: number, drawerId: UserId, startedAt: number): Turn {
  const animationMs =
    round === 0 && turn === 0
      ? option.introAnimationMs + option.roundAnimationMs
      : turn === 0
        ? option.roundAnimationMs
        : 0;
  const drawFrom = startedAt + animationMs;
  return { round, turn, drawerId, startedAt, drawFrom, deadline: drawFrom + option.turnMs };
}
