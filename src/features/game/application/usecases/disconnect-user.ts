import type { Clock } from '../../../../shared/application/ports/clock.js';
import type { Scheduler } from '../../../../shared/application/ports/scheduler.js';
import type { UserId } from '../../../../shared/domain/user-id.js';
import { waitLeaveKey, type Membership } from '../membership.js';
import type { RoomEventPublisher } from '../ports/room-event-publisher.js';
import type { RoomRepository } from '../ports/room-repository.js';

export class DisconnectUser {
  constructor(
    private readonly rooms: RoomRepository,
    private readonly membership: Membership,
    private readonly publisher: RoomEventPublisher,
    private readonly scheduler: Scheduler,
    private readonly clock: Clock,
    private readonly waitGraceMs: number,
  ) {}

  /** Players stay in a game while away; in a waiting room they are removed unless they come back in time. */
  execute(userId: UserId): void {
    const room = this.rooms.findByUser(userId);
    if (room === null) {
      return;
    }
    const events = room.setConnected(userId, false, this.clock.now());
    this.rooms.save(room);
    this.publisher.publish(room, events);
    if (!room.isInGame) {
      this.scheduler.schedule(waitLeaveKey(userId), this.waitGraceMs, () => this.expire(userId));
    }
  }

  private expire(userId: UserId): void {
    const room = this.rooms.findByUser(userId);
    if (room === null || room.isInGame || room.isConnected(userId)) {
      return;
    }
    this.membership.remove(room, userId);
  }
}
