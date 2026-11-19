import type { Clock } from '../../../../shared/application/ports/clock.js';
import type { Scheduler } from '../../../../shared/application/ports/scheduler.js';
import { waitLeaveKey } from '../membership.js';
import { phaseTimerKey } from '../phase-timer.js';
import type { RoomRepository } from '../ports/room-repository.js';

export class CleanupRooms {
  constructor(
    private readonly rooms: RoomRepository,
    private readonly scheduler: Scheduler,
    private readonly clock: Clock,
    private readonly emptyRoomTtlMs: number,
  ) {}

  /** Deletes rooms nobody has been connected to for the TTL. */
  execute(): void {
    const now = this.clock.now();
    for (const room of this.rooms.all()) {
      if (room.emptySince === null || now - room.emptySince < this.emptyRoomTtlMs) {
        continue;
      }
      for (const player of room.players) {
        this.scheduler.cancel(waitLeaveKey(player.userId));
      }
      this.scheduler.cancel(phaseTimerKey(room.id));
      this.rooms.delete(room);
    }
  }
}
