import type { UserId } from '../../../../shared/domain/user-id.js';
import { GameError, GameErrorCode } from '../../domain/game-error.js';
import type { Membership } from '../membership.js';
import type { RoomRepository } from '../ports/room-repository.js';

export class LeaveRoom {
  constructor(
    private readonly rooms: RoomRepository,
    private readonly membership: Membership,
  ) {}

  execute(userId: UserId): void {
    const room = this.rooms.findByUser(userId);
    if (room === null) {
      throw new GameError(GameErrorCode.NotInRoom);
    }
    // TODO(M3): decide how leaving during a game works (design.md 12장).
    this.membership.remove(room, userId);
  }
}
