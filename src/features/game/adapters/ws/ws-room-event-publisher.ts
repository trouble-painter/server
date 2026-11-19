import type { ServerMessage } from '../../../../shared/adapters/ws/protocol.js';
import type { SessionGateway } from '../../../../shared/adapters/ws/session-gateway.js';
import type { UserId } from '../../../../shared/domain/user-id.js';
import type { RoomEventPublisher } from '../../application/ports/room-event-publisher.js';
import { RoomEventType, type RoomEvent } from '../../domain/room-event.js';
import type { Room } from '../../domain/room.js';
import { playersMessage } from './room-presenter.js';

export class WsRoomEventPublisher implements RoomEventPublisher {
  constructor(private readonly sessions: SessionGateway) {}

  publish(room: Room, events: readonly RoomEvent[], except?: UserId): void {
    for (const event of events) {
      const message = present(room, event);
      for (const player of room.players) {
        if (player.userId !== except) {
          this.sessions.send(player.userId, message);
        }
      }
    }
  }
}

function present(room: Room, event: RoomEvent): ServerMessage {
  switch (event.type) {
    case RoomEventType.PlayersChanged:
      return playersMessage(room);
  }
}
