import type { SessionGateway } from '../../../../shared/adapters/ws/session-gateway.js';
import type { UserId } from '../../../../shared/domain/user-id.js';
import type { KeywordRepository } from '../../application/ports/keyword-repository.js';
import type { RoomEventPublisher } from '../../application/ports/room-event-publisher.js';
import type { RoomEvent } from '../../domain/room-event.js';
import type { Room } from '../../domain/room.js';
import { eventMessage } from './room-presenter.js';

export class WsRoomEventPublisher implements RoomEventPublisher {
  constructor(
    private readonly sessions: SessionGateway,
    private readonly keywords: KeywordRepository,
  ) {}

  /** Skips players marked away: someone who left a game in progress may still hold an open connection. */
  publish(room: Room, events: readonly RoomEvent[], except?: UserId): void {
    for (const event of events) {
      for (const player of room.players) {
        if (player.userId === except || !player.isConnected) {
          continue;
        }
        const message = eventMessage(room, event, player.userId, this.keywords);
        if (message !== null) {
          this.sessions.send(player.userId, message);
        }
      }
    }
  }
}
