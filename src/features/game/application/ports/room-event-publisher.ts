import type { UserId } from '../../../../shared/domain/user-id.js';
import type { RoomEvent } from '../../domain/room-event.js';
import type { Room } from '../../domain/room.js';

export interface RoomEventPublisher {
  /** Tells the room's players what happened. `except` already gets the whole room in its own reply. */
  publish(room: Room, events: readonly RoomEvent[], except?: UserId): void;
}
