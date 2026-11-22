import type { Clock } from '../../../shared/application/ports/clock.js';
import type { Scheduler } from '../../../shared/application/ports/scheduler.js';
import type { RoomCode } from '../../../shared/domain/room-code.js';
import type { Room } from '../domain/room.js';
import { Vacancy } from '../domain/vacancy.js';
import { waitLeaveKey } from './membership.js';
import { phaseTimerKey, type PhaseTimer } from './phase-timer.js';
import type { GameRecordings } from './ports/game-recordings.js';
import type { RoomRepository } from './ports/room-repository.js';

/** Scheduler key of the timer that deletes a game nobody came back to. */
export function vacancyKey(roomId: RoomCode): string {
  return `vacancy:${roomId}`;
}

/** Deletes a room along with every timer kept for it. */
export function discardRoom(rooms: RoomRepository, scheduler: Scheduler, recordings: GameRecordings, room: Room): void {
  for (const player of room.players) {
    scheduler.cancel(waitLeaveKey(player.userId));
  }
  scheduler.cancel(phaseTimerKey(room.id));
  scheduler.cancel(vacancyKey(room.id));
  recordings.discard(room.id);
  rooms.delete(room);
}

/** Ends a game nobody is left to play: at once when most players left it, after a grace when most lost their connection. */
export class GameVacancy {
  constructor(
    private readonly rooms: RoomRepository,
    private readonly scheduler: Scheduler,
    private readonly recordings: GameRecordings,
    private readonly timer: PhaseTimer,
    private readonly clock: Clock,
    private readonly graceMs: number,
  ) {}

  /** Call after a player of the room connects or goes away. */
  settle(room: Room): void {
    switch (room.vacancy) {
      case Vacancy.Occupied:
        this.scheduler.cancel(vacancyKey(room.id));
        this.timer.sync(room);
        return;
      case Vacancy.Deserted:
        discardRoom(this.rooms, this.scheduler, this.recordings, room);
        return;
      case Vacancy.Stranded:
        this.hold(room);
        return;
    }
  }

  /** Keeps a paused game for the grace counted from when it emptied, then deletes it unless someone is back. */
  hold(room: Room): void {
    this.timer.sync(room);
    const emptySince = room.emptySince;
    if (emptySince === null) {
      return;
    }
    const roomId = room.id;
    const delayMs = Math.max(0, emptySince + this.graceMs - this.clock.now());
    this.scheduler.schedule(vacancyKey(roomId), delayMs, () => {
      const current = this.rooms.get(roomId);
      if (current !== null && current.vacancy !== Vacancy.Occupied) {
        discardRoom(this.rooms, this.scheduler, this.recordings, current);
      }
    });
  }
}
