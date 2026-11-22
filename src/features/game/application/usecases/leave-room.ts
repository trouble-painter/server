import type { Clock } from '../../../../shared/application/ports/clock.js';
import type { UserId } from '../../../../shared/domain/user-id.js';
import type { GameVacancy } from '../game-vacancy.js';
import { requireRoom, type Membership } from '../membership.js';
import type { RoomEventPublisher } from '../ports/room-event-publisher.js';
import type { RoomRepository } from '../ports/room-repository.js';

export class LeaveRoom {
  constructor(
    private readonly rooms: RoomRepository,
    private readonly membership: Membership,
    private readonly publisher: RoomEventPublisher,
    private readonly vacancy: GameVacancy,
    private readonly clock: Clock,
  ) {}

  /**
   * During a game the user stays a player and is treated as disconnected until the game is over,
   * unless the game is left with nobody to play it.
   */
  execute(userId: UserId): void {
    const room = requireRoom(this.rooms, userId);
    if (!room.isInGame) {
      this.membership.remove(room, userId);
      return;
    }
    const events = room.leaveGame(userId, this.clock.now());
    this.rooms.save(room);
    this.publisher.publish(room, events);
    this.vacancy.settle(room);
  }
}
