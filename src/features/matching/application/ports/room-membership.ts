import type { UserId } from '../../../../shared/domain/user-id.js';

/** The game side of "one room or one queue per user". */
export interface RoomMembership {
  /** Leaves a waiting room; throws when the user is in a game. */
  release(userId: UserId): void;
}
