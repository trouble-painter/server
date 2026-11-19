import type { Room } from '../domain/room.js';
import type { RoomRepository } from './ports/room-repository.js';

/**
 * Takes everyone out of a room whose result has been sent. A quick-start room is only for one game
 * and is deleted; any other room waits empty for whoever plays again, until the empty-room cleanup.
 */
export function closeGame(rooms: RoomRepository, room: Room, now: number): void {
  room.closeGame(now);
  if (room.isQuickStart) {
    rooms.delete(room);
    return;
  }
  rooms.save(room);
}
