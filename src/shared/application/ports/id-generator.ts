import type { RoomCode } from '../../domain/room-code.js';
import type { UserId } from '../../domain/user-id.js';

export interface IdGenerator {
  userId(): UserId;
  /** May collide with an existing room; the caller checks. */
  roomCode(): RoomCode;
}
