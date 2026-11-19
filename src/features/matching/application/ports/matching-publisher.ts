import type { UserId } from '../../../../shared/domain/user-id.js';
import type { MatchingStatus } from '../../domain/match-queue.js';

export interface MatchingPublisher {
  send(userId: UserId, status: MatchingStatus): void;
}
