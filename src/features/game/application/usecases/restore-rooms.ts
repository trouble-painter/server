import type { Clock } from '../../../../shared/application/ports/clock.js';
import { closeGame } from '../game-end.js';
import type { GameVacancy } from '../game-vacancy.js';
import type { Membership } from '../membership.js';
import type { RoomRepository } from '../ports/room-repository.js';

/** Run once at boot, after the repository has loaded the saved rooms. */
export class RestoreRooms {
  constructor(
    private readonly rooms: RoomRepository,
    private readonly membership: Membership,
    private readonly vacancy: GameVacancy,
    private readonly clock: Clock,
    private readonly restoreGraceMs: number,
    private readonly waitGraceMs: number,
  ) {}

  /**
   * Everyone starts out disconnected: games pause for them for the grace however they had gone away,
   * waiting rooms let them go if they don't come back.
   */
  execute(): void {
    const now = this.clock.now();
    for (const room of this.rooms.all()) {
      // Saved between sending a result and closing the game.
      if (room.isOver) {
        closeGame(this.rooms, room, now);
        continue;
      }
      room.resumeAfterRestart(now, this.restoreGraceMs);
      this.rooms.save(room);
      if (room.isInGame) {
        this.vacancy.hold(room);
        continue;
      }
      for (const player of room.players) {
        this.membership.leaveWaitingLater(player.userId, this.waitGraceMs);
      }
    }
  }
}
