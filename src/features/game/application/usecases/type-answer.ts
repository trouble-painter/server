import type { UserId } from '../../../../shared/domain/user-id.js';
import { requireRoom } from '../membership.js';
import type { RoomEventPublisher } from '../ports/room-event-publisher.js';
import type { RoomRepository } from '../ports/room-repository.js';

export class TypeAnswer {
  constructor(
    private readonly rooms: RoomRepository,
    private readonly publisher: RoomEventPublisher,
  ) {}

  /** Not saved: only the submitted answer is kept across a restart (design.md 6.1). */
  execute(userId: UserId, answer: string): void {
    const room = requireRoom(this.rooms, userId);
    this.publisher.publish(room, room.typeAnswer(userId, answer));
  }
}
