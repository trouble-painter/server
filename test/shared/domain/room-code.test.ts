import { describe, expect, it } from 'vitest';
import { toRoomCode } from '../../../src/shared/domain/room-code.js';

describe('toRoomCode', () => {
  it('accepts four characters from the alphabet', () => {
    expect(toRoomCode('K7Q2')).toBe('K7Q2');
  });

  it('rejects look-alikes, lowercase, and other lengths', () => {
    for (const value of ['K7Q0', 'K7QO', 'K7Q1', 'K7QI', 'k7q2', 'K7Q', 'K7Q2Z', '']) {
      expect(toRoomCode(value)).toBeNull();
    }
  });
});
