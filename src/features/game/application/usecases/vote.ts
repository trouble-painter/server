import type { UserId } from '../../../../shared/domain/user-id.js';
import { requireRoom } from '../membership.js';
import type { RoomEventPublisher } from '../ports/room-event-publisher.js';
import type { RoomRepository } from '../ports/room-repository.js';

export class Vote {
  constructor(
    private readonly rooms: RoomRepository,
    private readonly publisher: RoomEventPublisher,
  ) {}

  /** A vote never ends the phase: the phase timer tallies at the deadline. */
  execute(userId: UserId, targetId: UserId): void {
    const room = requireRoom(this.rooms, userId);
    const events = room.vote(userId, targetId);
    this.rooms.save(room);
    this.publisher.publish(room, events);
  }
}
