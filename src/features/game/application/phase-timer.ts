import type { Clock } from '../../../shared/application/ports/clock.js';
import type { Scheduler } from '../../../shared/application/ports/scheduler.js';
import type { RoomCode } from '../../../shared/domain/room-code.js';
import type { Room } from '../domain/room.js';
import type { RoomEventPublisher } from './ports/room-event-publisher.js';
import type { RoomRepository } from './ports/room-repository.js';

/** Scheduler key of the timer that ends a room's current phase or turn. */
export function phaseTimerKey(roomId: RoomCode): string {
  return `phase:${roomId}`;
}

/** Keeps one timer per room on the room's deadline and moves the game on when it passes. */
export class PhaseTimer {
  constructor(
    private readonly rooms: RoomRepository,
    private readonly publisher: RoomEventPublisher,
    private readonly scheduler: Scheduler,
    private readonly clock: Clock,
  ) {}

  /** Call after anything that may change the phase or turn. */
  sync(room: Room): void {
    const key = phaseTimerKey(room.id);
    const deadline = room.deadline;
    if (deadline === null) {
      this.scheduler.cancel(key);
      return;
    }
    const version = room.version;
    const delayMs = Math.max(0, deadline - this.clock.now());
    this.scheduler.schedule(key, delayMs, () => this.expire(room.id, version));
  }

  private expire(roomId: RoomCode, version: number): void {
    const room = this.rooms.get(roomId);
    if (room === null) {
      return;
    }
    const events = room.expire(version, this.clock.now());
    if (events.length === 0) {
      return;
    }
    if (room.isEmpty) {
      this.rooms.delete(room);
      return;
    }
    this.rooms.save(room);
    this.publisher.publish(room, events);
    this.sync(room);
  }
}
