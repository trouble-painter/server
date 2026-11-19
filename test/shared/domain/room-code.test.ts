import { describe, expect, it } from 'vitest';
import { toRoomCode } from '../../../src/shared/domain/room-code.js';

describe('toRoomCode', () => {
  it('accepts six characters from the alphabet', () => {
    expect(toRoomCode('K7Q2ZP')).toBe('K7Q2ZP');
  });

  it('rejects look-alikes, lowercase, and other lengths', () => {
    for (const value of ['K7Q2Z0', 'K7Q2ZO', 'K7Q2Z1', 'K7Q2ZI', 'k7q2zp', 'K7Q2Z', 'K7Q2ZPP', '']) {
      expect(toRoomCode(value)).toBeNull();
    }
  });
});
