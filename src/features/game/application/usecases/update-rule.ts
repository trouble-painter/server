import type { UserId } from '../../../../shared/domain/user-id.js';
import type { GameRule } from '../../domain/game-rule.js';
import { requireRoom } from '../membership.js';
import type { KeywordRepository } from '../ports/keyword-repository.js';
import type { RoomEventPublisher } from '../ports/room-event-publisher.js';
import type { RoomRepository } from '../ports/room-repository.js';

export class UpdateRule {
  constructor(
    private readonly rooms: RoomRepository,
    private readonly publisher: RoomEventPublisher,
    private readonly keywords: KeywordRepository,
  ) {}

  /** Everyone, the host included, gets the new rule as a ROOM of their own. */
  execute(userId: UserId, rule: GameRule): void {
    const room = requireRoom(this.rooms, userId);
    const allCategoryIds = this.keywords.categories(room.locale).map((c) => c.id);
    const events = room.updateRule(userId, rule, allCategoryIds);
    this.rooms.save(room);
    this.publisher.publish(room, events);
  }
}
