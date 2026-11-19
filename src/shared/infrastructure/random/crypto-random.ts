import { randomInt } from 'node:crypto';
import type { Random } from '../../application/ports/random.js';

export class CryptoRandom implements Random {
  pick<T>(items: readonly T[]): T {
    if (items.length === 0) {
      throw new Error('cannot pick from an empty array');
    }
    return items[randomInt(items.length)] as T;
  }

  /** Fisher–Yates. */
  shuffle<T>(items: readonly T[]): T[] {
    const result = [...items];
    for (let i = result.length - 1; i > 0; i--) {
      const j = randomInt(i + 1);
      [result[i], result[j]] = [result[j] as T, result[i] as T];
    }
    return result;
  }
}
