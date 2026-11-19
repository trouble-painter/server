import type { UserId } from '../../../../shared/domain/user-id.js';
import type { MatchingStatus } from '../../../matching/domain/match-queue.js';

/** The quick-start side of "one room or one queue per user", and of a user's connection. */
export interface QueueMembership {
  /** Takes the user out of the queue; does nothing when they are not in it. */
  release(userId: UserId): void;
  /** The user's queue status for HELLO; null when they are not queued. */
  connect(userId: UserId): MatchingStatus | null;
  disconnect(userId: UserId): void;
}
