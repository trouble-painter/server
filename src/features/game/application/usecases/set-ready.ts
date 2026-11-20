import type { UserId } from '../../../../shared/domain/user-id.js';
import { requireRoom } from '../membership.js';
import type { RoomEventPublisher } from '../ports/room-event-publisher.js';
import type { RoomRepository } from '../ports/room-repository.js';

export class SetReady {
  constructor(
    private readonly rooms: RoomRepository,
    private readonly publisher: RoomEventPublisher,
  ) {}

  /** Everyone, the requester included, gets the new players as a PLAYERS of their own. */
  execute(userId: UserId, isReady: boolean): void {
    const room = requireRoom(this.rooms, userId);
    const events = room.setReady(userId, isReady);
    this.rooms.save(room);
    this.publisher.publish(room, events);
  }
}
