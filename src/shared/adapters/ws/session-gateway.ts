import type { UserId } from '../../domain/user-id.js';
import type { ServerMessage } from './protocol.js';

export interface SessionGateway {
  /** Does nothing when the user has no open connection. */
  send(userId: UserId, message: ServerMessage): void;
}
