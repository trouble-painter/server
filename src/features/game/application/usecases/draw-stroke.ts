import type { Clock } from '../../../../shared/application/ports/clock.js';
import type { UserId } from '../../../../shared/domain/user-id.js';
import type { StrokePiece } from '../../domain/phase.js';
import { requireRoom } from '../membership.js';
import type { RoomEventPublisher } from '../ports/room-event-publisher.js';
import type { RoomRepository } from '../ports/room-repository.js';

export class DrawStroke {
  constructor(
    private readonly rooms: RoomRepository,
    private readonly publisher: RoomEventPublisher,
    private readonly clock: Clock,
    private readonly maxStrokePoints: number,
  ) {}

  /** Not saved: a stroke in progress is not worth keeping across a restart (design.md 6.1). */
  execute(userId: UserId, piece: StrokePiece): void {
    const room = requireRoom(this.rooms, userId);
    this.publisher.publish(room, room.drawStroke(userId, piece, this.maxStrokePoints, this.clock.now()));
  }
}
