import type { RoomCode } from '../../../../shared/domain/room-code.js';

/** Whatever is kept in memory for a game while it is played. */
export interface GameRecordings {
  /** The room is gone for good, so its unfinished game will never be saved. */
  discard(roomId: RoomCode): void;
}
