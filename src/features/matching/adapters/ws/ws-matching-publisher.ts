import { IdleReason } from '../../../../shared/adapters/ws/protocol.js';
import type { SessionGateway } from '../../../../shared/adapters/ws/session-gateway.js';
import type { UserId } from '../../../../shared/domain/user-id.js';
import type { MatchingPublisher } from '../../application/ports/matching-publisher.js';
import type { MatchingStatus } from '../../domain/match-queue.js';
import { idleMessage } from '../../../game/adapters/ws/room-presenter.js';
import { matchingMessage } from './matching-presenter.js';

export class WsMatchingPublisher implements MatchingPublisher {
  constructor(private readonly sessions: SessionGateway) {}

  send(userId: UserId, status: MatchingStatus): void {
    this.sessions.send(userId, matchingMessage(status));
  }

  declined(userId: UserId): void {
    this.sessions.send(userId, idleMessage(IdleReason.MatchDeclined));
  }
}
