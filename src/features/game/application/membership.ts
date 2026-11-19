import type { Clock } from '../../../shared/application/ports/clock.js';
import type { Scheduler } from '../../../shared/application/ports/scheduler.js';
import type { UserId } from '../../../shared/domain/user-id.js';
import { GameError, GameErrorCode } from '../domain/game-error.js';
import type { Room } from '../domain/room.js';
import type { RoomEventPublisher } from './ports/room-event-publisher.js';
import type { RoomRepository } from './ports/room-repository.js';

/** Scheduler key of the timer that removes a player who disconnected from a waiting room. */
export function waitLeaveKey(userId: UserId): string {
  return `wait-leave:${userId}`;
}

/** The user's room; throws when they are in none. */
export function requireRoom(rooms: RoomRepository, userId: UserId): Room {
  const room = rooms.findByUser(userId);
  if (room === null) {
    throw new GameError(GameErrorCode.NotInRoom);
  }
  return room;
}

/** Leaving rooms, shared by the use cases that take a user out of one. */
export class Membership {
  constructor(
    private readonly rooms: RoomRepository,
    private readonly publisher: RoomEventPublisher,
    private readonly scheduler: Scheduler,
    private readonly clock: Clock,
  ) {}

  /** Deletes the room once its last player is gone. */
  remove(room: Room, userId: UserId): void {
    this.scheduler.cancel(waitLeaveKey(userId));
    const events = room.removePlayer(userId, this.clock.now());
    if (room.isEmpty) {
      this.rooms.delete(room);
      return;
    }
    this.rooms.save(room);
    this.publisher.publish(room, events);
  }

  /** Frees the user to enter another room: leaves a waiting room, refuses during a game. */
  release(userId: UserId): void {
    const room = this.rooms.findByUser(userId);
    if (room === null) {
      return;
    }
    if (room.isInGame) {
      throw new GameError(GameErrorCode.AlreadyInGame);
    }
    this.remove(room, userId);
  }
}
