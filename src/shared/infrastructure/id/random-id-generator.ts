import { randomInt } from 'node:crypto';
import type { IdGenerator } from '../../application/ports/id-generator.js';
import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH, type RoomCode } from '../../domain/room-code.js';
import type { UserId } from '../../domain/user-id.js';

/** `crypto.randomInt` allows a range of at most 2^48. */
const USER_ID_MAX_EXCLUSIVE = 2 ** 48;

export class RandomIdGenerator implements IdGenerator {
  userId(): UserId {
    return randomInt(1, USER_ID_MAX_EXCLUSIVE) as UserId;
  }

  roomCode(): RoomCode {
    let code = '';
    for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
      code += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
    }
    return code as RoomCode;
  }
}
