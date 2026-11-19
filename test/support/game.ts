import type { KeywordRepository } from '../../src/features/game/application/ports/keyword-repository.js';
import { PLAYER_COUNT, type GameOption } from '../../src/features/game/domain/game-option.js';
import type { KeywordCategory } from '../../src/features/game/domain/keyword.js';
import type { Limits } from '../../src/features/game/domain/limits.js';
import type { Random } from '../../src/shared/application/ports/random.js';

export const KEYWORDS_FIXTURE_DIR = 'test/fixtures/keywords';

export const TEST_OPTION: GameOption = {
  ...PLAYER_COUNT,
  readyMs: 5_000,
  introAnimationMs: 3_000,
  roundAnimationMs: 2_000,
  rounds: 2,
  turnMs: 10_000,
  strokesPerTurn: 2,
  voteMs: 30_000,
  answerMs: 20_000,
  endMs: 15_000,
};

export const TEST_LIMITS: Limits = {
  drawThrottleMs: 50,
  reactionThrottleMs: 500,
  maxStrokePoints: 4,
  maxAnswerLength: 20,
};

/** Picks the element at the next queued index (0 once the queue runs out) and keeps the order on shuffle. */
export class FakeRandom implements Random {
  constructor(private readonly pickIndexes: number[] = []) {}

  pick<T>(items: readonly T[]): T {
    return items[this.pickIndexes.shift() ?? 0] as T;
  }

  shuffle<T>(items: readonly T[]): T[] {
    return [...items];
  }
}

export class FixedKeywords implements KeywordRepository {
  constructor(private readonly list: readonly KeywordCategory[] = [{ category: '장소', keywords: [{ word: '도시', synonyms: [] }, { word: '바다', synonyms: [] }] }]) {}

  categories(): readonly KeywordCategory[] {
    return this.list;
  }
}
