import type { Clock } from '../../../../shared/application/ports/clock.js';
import type { UserId } from '../../../../shared/domain/user-id.js';
import { requireRoom } from '../membership.js';
import type { PhaseTimer } from '../phase-timer.js';
import type { RoomEventPublisher } from '../ports/room-event-publisher.js';
import type { RoomRepository } from '../ports/room-repository.js';

export class PlayAgain {
  constructor(
    private readonly rooms: RoomRepository,
    private readonly publisher: RoomEventPublisher,
    private readonly timer: PhaseTimer,
    private readonly clock: Clock,
  ) {}

  /** Any player may take the room back to waiting; the requester is connected, so the room is never empty. */
  execute(userId: UserId): void {
    const room = requireRoom(this.rooms, userId);
    const events = room.playAgain(this.clock.now());
    this.rooms.save(room);
    this.publisher.publish(room, events);
    this.timer.sync(room);
  }
}
