import type { UserId } from '../../../../shared/domain/user-id.js';
import type { MatchingStatus } from '../../domain/match-queue.js';

export interface MatchingPublisher {
  send(userId: UserId, status: MatchingStatus): void;
  /** Tells a user who was matched but did not accept that they are out of the queue. */
  declined(userId: UserId): void;
}
