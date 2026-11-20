import type { UserId } from '../../../../shared/domain/user-id.js';
import { requireRoom, type Membership } from '../membership.js';
import type { KickedNotifier } from '../ports/kicked-notifier.js';
import type { RoomRepository } from '../ports/room-repository.js';

export class KickPlayer {
  constructor(
    private readonly rooms: RoomRepository,
    private readonly membership: Membership,
    private readonly kicked: KickedNotifier,
  ) {}

  /** The others get the new players as a PLAYERS; the kicked player gets an IDLE. */
  execute(userId: UserId, targetId: UserId): void {
    const room = requireRoom(this.rooms, userId);
    room.assertCanKick(userId, targetId);
    this.membership.remove(room, targetId);
    this.kicked.notify(targetId);
  }
}
