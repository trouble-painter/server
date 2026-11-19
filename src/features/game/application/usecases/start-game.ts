import type { Clock } from '../../../../shared/application/ports/clock.js';
import type { Random } from '../../../../shared/application/ports/random.js';
import type { UserId } from '../../../../shared/domain/user-id.js';
import { requireRoom } from '../membership.js';
import type { PhaseTimer } from '../phase-timer.js';
import type { KeywordRepository } from '../ports/keyword-repository.js';
import type { RoomEventPublisher } from '../ports/room-event-publisher.js';
import type { RoomRepository } from '../ports/room-repository.js';
import { drawGame } from '../room-setup.js';

export class StartGame {
  constructor(
    private readonly rooms: RoomRepository,
    private readonly publisher: RoomEventPublisher,
    private readonly timer: PhaseTimer,
    private readonly keywords: KeywordRepository,
    private readonly random: Random,
    private readonly clock: Clock,
  ) {}

  /** Everyone, the host included, gets the new phase as a ROOM of their own. */
  execute(userId: UserId): void {
    const room = requireRoom(this.rooms, userId);
    room.assertCanStart(userId);
    const events = room.start(userId, drawGame(room, this.keywords, this.random), this.clock.now());
    this.rooms.save(room);
    this.publisher.publish(room, events);
    this.timer.sync(room);
  }
}
