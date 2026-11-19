import type { Clock } from '../../../../shared/application/ports/clock.js';
import type { UserId } from '../../../../shared/domain/user-id.js';
import type { Reaction } from '../../domain/reaction.js';
import { requireRoom } from '../membership.js';
import type { RoomEventPublisher } from '../ports/room-event-publisher.js';
import type { RoomRepository } from '../ports/room-repository.js';

/** Past this many users, entries older than the throttle are dropped so the map does not grow forever. */
const PRUNE_THRESHOLD = 1_000;

export class React {
  private readonly lastSentAt = new Map<UserId, number>();

  constructor(
    private readonly rooms: RoomRepository,
    private readonly publisher: RoomEventPublisher,
    private readonly clock: Clock,
    private readonly throttleMs: number,
  ) {}

  /** A reaction sooner than the throttle after the user's last one is dropped without an error. */
  execute(userId: UserId, reaction: Reaction): void {
    const room = requireRoom(this.rooms, userId);
    const now = this.clock.now();
    const last = this.lastSentAt.get(userId);
    if (last !== undefined && now - last < this.throttleMs) {
      return;
    }
    const events = room.react(userId, reaction);
    this.remember(userId, now);
    this.publisher.publish(room, events);
  }

  private remember(userId: UserId, now: number): void {
    if (this.lastSentAt.size >= PRUNE_THRESHOLD) {
      for (const [id, at] of this.lastSentAt) {
        if (now - at >= this.throttleMs) {
          this.lastSentAt.delete(id);
        }
      }
    }
    this.lastSentAt.set(userId, now);
  }
}
