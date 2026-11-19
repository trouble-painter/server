import type { Clock } from '../../../../shared/application/ports/clock.js';
import type { UserId } from '../../../../shared/domain/user-id.js';
import { closeGame } from '../game-end.js';
import { requireRoom } from '../membership.js';
import type { PhaseTimer } from '../phase-timer.js';
import type { RoomEventPublisher } from '../ports/room-event-publisher.js';
import type { RoomRepository } from '../ports/room-repository.js';

export class SubmitAnswer {
  constructor(
    private readonly rooms: RoomRepository,
    private readonly publisher: RoomEventPublisher,
    private readonly timer: PhaseTimer,
    private readonly clock: Clock,
  ) {}

  execute(userId: UserId, answer: string): void {
    const room = requireRoom(this.rooms, userId);
    const events = room.submitAnswer(userId, answer);
    this.rooms.save(room);
    this.publisher.publish(room, events);
    closeGame(this.rooms, room, this.clock.now());
    this.timer.sync(room);
  }
}
