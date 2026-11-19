import type { UserId } from '../../../../shared/domain/user-id.js';

/** userId → roomId of the room the user is playing in. */
export interface PlayingRoomIndex {
  findRoomId(userId: UserId): string | null;
}
