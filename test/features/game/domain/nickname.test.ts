import { describe, expect, it } from 'vitest';
import { toNickname } from '../../../../src/features/game/domain/nickname.js';

describe('toNickname', () => {
  it('trims and accepts 1 to 7 characters', () => {
    expect(toNickname('  아보카도 ')).toBe('아보카도');
    expect(toNickname('가나다라마바사')).toBe('가나다라마바사');
  });

  it('rejects blank and longer than 7 characters', () => {
    expect(toNickname('   ')).toBeNull();
    expect(toNickname('가나다라마바사아')).toBeNull();
  });

  it('counts an emoji sequence as one character, like the app', () => {
    expect(toNickname('👨‍👩‍👧‍👦'.repeat(7))).not.toBeNull();
  });
});
