import type { SessionGateway } from '../../../../shared/adapters/ws/session-gateway.js';
import type { UserId } from '../../../../shared/domain/user-id.js';
import type { MatchingPublisher } from '../../application/ports/matching-publisher.js';
import type { MatchingStatus } from '../../domain/match-queue.js';
import { matchingMessage } from './matching-presenter.js';

export class WsMatchingPublisher implements MatchingPublisher {
  constructor(private readonly sessions: SessionGateway) {}

  send(userId: UserId, status: MatchingStatus): void {
    this.sessions.send(userId, matchingMessage(status));
  }
}
