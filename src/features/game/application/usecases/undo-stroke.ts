import type { Clock } from '../../../../shared/application/ports/clock.js';
import type { UserId } from '../../../../shared/domain/user-id.js';
import { requireRoom } from '../membership.js';
import type { RoomEventPublisher } from '../ports/room-event-publisher.js';
import type { RoomRepository } from '../ports/room-repository.js';

export class UndoStroke {
  constructor(
    private readonly rooms: RoomRepository,
    private readonly publisher: RoomEventPublisher,
    private readonly clock: Clock,
  ) {}

  /** Not saved, like a stroke (design.md 6.1). */
  execute(userId: UserId): void {
    const room = requireRoom(this.rooms, userId);
    this.publisher.publish(room, room.undoStroke(userId, this.clock.now()));
  }
}
