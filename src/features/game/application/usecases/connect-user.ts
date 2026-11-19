import type { Clock } from '../../../../shared/application/ports/clock.js';
import type { Scheduler } from '../../../../shared/application/ports/scheduler.js';
import type { UserId } from '../../../../shared/domain/user-id.js';
import type { Room } from '../../domain/room.js';
import { waitLeaveKey } from '../membership.js';
import type { RoomEventPublisher } from '../ports/room-event-publisher.js';
import type { RoomRepository } from '../ports/room-repository.js';

export class ConnectUser {
  constructor(
    private readonly rooms: RoomRepository,
    private readonly publisher: RoomEventPublisher,
    private readonly scheduler: Scheduler,
    private readonly clock: Clock,
  ) {}

  /** Returns the user's room so the new connection can be given its whole state. */
  execute(userId: UserId): Room | null {
    const room = this.rooms.findByUser(userId);
    if (room === null) {
      return null;
    }
    this.scheduler.cancel(waitLeaveKey(userId));
    const events = room.setConnected(userId, true, this.clock.now());
    this.rooms.save(room);
    this.publisher.publish(room, events, userId);
    return room;
  }
}
