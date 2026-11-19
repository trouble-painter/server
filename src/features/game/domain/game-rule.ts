import { GameError, GameErrorCode } from './game-error.js';

/** The most strokes a host can allow per turn short of no limit. */
export const MAX_STROKES_PER_TURN = 5;

/** What the host of a custom room may change while waiting. */
export interface GameRule {
  /** null means no limit. */
  readonly strokesPerTurn: number | null;
  /** The categories the keyword is drawn from; empty means all of them. */
  readonly categoryIds: readonly string[];
}

export function defaultRule(strokesPerTurn: number): GameRule {
  return { strokesPerTurn, categoryIds: [] };
}

/** Throws unless the stroke count is in range and every category is one of `allCategoryIds`, without repeats. */
export function assertValidRule(rule: GameRule, allCategoryIds: readonly string[]): void {
  const strokes = rule.strokesPerTurn;
  const isStrokesValid = strokes === null || (Number.isInteger(strokes) && strokes >= 1 && strokes <= MAX_STROKES_PER_TURN);
  const isCategoriesValid =
    new Set(rule.categoryIds).size === rule.categoryIds.length && rule.categoryIds.every((id) => allCategoryIds.includes(id));
  if (!isStrokesValid || !isCategoriesValid) {
    throw new GameError(GameErrorCode.InvalidRequest);
  }
}
