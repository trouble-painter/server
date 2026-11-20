import { IdleReason } from '../../../../shared/adapters/ws/protocol.js';
import type { SessionGateway } from '../../../../shared/adapters/ws/session-gateway.js';
import type { UserId } from '../../../../shared/domain/user-id.js';
import type { KickedNotifier } from '../../application/ports/kicked-notifier.js';
import { idleMessage } from './room-presenter.js';

export class WsKickedNotifier implements KickedNotifier {
  constructor(private readonly sessions: SessionGateway) {}

  notify(userId: UserId): void {
    this.sessions.send(userId, idleMessage(IdleReason.Kicked));
  }
}
