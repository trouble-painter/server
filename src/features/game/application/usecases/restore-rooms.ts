import type { Clock } from '../../../../shared/application/ports/clock.js';
import type { Membership } from '../membership.js';
import type { PhaseTimer } from '../phase-timer.js';
import type { RoomRepository } from '../ports/room-repository.js';

/** Run once at boot, after the repository has loaded the saved rooms. */
export class RestoreRooms {
  constructor(
    private readonly rooms: RoomRepository,
    private readonly membership: Membership,
    private readonly timer: PhaseTimer,
    private readonly clock: Clock,
    private readonly restoreGraceMs: number,
    private readonly waitGraceMs: number,
  ) {}

  /** Everyone starts out disconnected: games wait for them, waiting rooms let them go if they don't come back. */
  execute(): void {
    const now = this.clock.now();
    for (const room of this.rooms.all()) {
      room.resumeAfterRestart(now, this.restoreGraceMs);
      this.rooms.save(room);
      this.timer.sync(room);
      if (!room.isInGame) {
        for (const player of room.players) {
          this.membership.leaveWaitingLater(player.userId, this.waitGraceMs);
        }
      }
    }
  }
}
