import { describe, expect, it } from 'vitest';
import { isCorrectGuess } from '../../../../src/features/game/domain/keyword.js';
import { scheduleTurn } from '../../../../src/features/game/domain/rules/turn-timing.js';
import { accusedBy } from '../../../../src/features/game/domain/rules/vote-tally.js';
import type { UserId } from '../../../../src/shared/domain/user-id.js';
import { TEST_OPTION } from '../../../support/game.js';

const uid = (n: number) => n as UserId;
const votes = (pairs: [number, number][]) => new Map(pairs.map(([v, t]) => [uid(v), uid(t)]));

describe('scheduleTurn', () => {
  it('plays the intro and round animations before the first turn', () => {
    expect(scheduleTurn(TEST_OPTION, 0, 0, uid(1), 100)).toEqual({
      round: 0,
      turn: 0,
      drawerId: 1,
      startedAt: 100,
      drawFrom: 5_100,
      deadline: 15_100,
    });
  });

  it('plays the round animation before each later round and nothing within a round', () => {
    expect(scheduleTurn(TEST_OPTION, 1, 0, uid(1), 0).drawFrom).toBe(2_000);
    expect(scheduleTurn(TEST_OPTION, 1, 2, uid(1), 0)).toMatchObject({ drawFrom: 0, deadline: 10_000 });
  });
});

describe('accusedBy', () => {
  it('names the single most voted player', () => {
    expect(accusedBy(votes([[1, 3], [2, 3], [3, 1]]))).toBe(3);
  });

  it('names nobody on a tie or without votes', () => {
    expect(accusedBy(votes([[1, 2], [2, 1]]))).toBeNull();
    expect(accusedBy(votes([[1, 2], [2, 1], [3, 1], [4, 2], [5, 3]]))).toBeNull();
    expect(accusedBy(votes([]))).toBeNull();
  });

  it('a later higher count beats an earlier tie', () => {
    expect(accusedBy(votes([[1, 2], [2, 3], [3, 4], [4, 4]]))).toBe(4);
  });
});

describe('isCorrectGuess', () => {
  it('ignores whitespace, case and Unicode composition', () => {
    expect(isCorrectGuess(' Ice  cream ', 'icecream')).toBe(true);
    expect(isCorrectGuess('도시'.normalize('NFD'), '도시')).toBe(true);
    expect(isCorrectGuess('바다', '도시')).toBe(false);
    expect(isCorrectGuess('', '도시')).toBe(false);
  });
});
