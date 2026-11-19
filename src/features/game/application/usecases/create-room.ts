import type { IdGenerator } from '../../../../shared/application/ports/id-generator.js';
import type { Locale } from '../../../../shared/domain/locale.js';
import type { UserId } from '../../../../shared/domain/user-id.js';
import type { GameOption } from '../../domain/game-option.js';
import type { Nickname } from '../../domain/nickname.js';
import { Room } from '../../domain/room.js';
import type { Membership } from '../membership.js';
import type { QueueMembership } from '../ports/queue-membership.js';
import type { RoomRepository } from '../ports/room-repository.js';
import { unusedRoomCode } from '../room-setup.js';

export class CreateRoom {
  constructor(
    private readonly rooms: RoomRepository,
    private readonly membership: Membership,
    private readonly queue: QueueMembership,
    private readonly ids: IdGenerator,
    private readonly option: GameOption,
  ) {}

  execute(userId: UserId, nickname: Nickname, locale: Locale): Room {
    this.membership.release(userId);
    this.queue.release(userId);
    const room = Room.create({
      id: unusedRoomCode(this.rooms, this.ids),
      locale,
      isQuickStart: false,
      option: this.option,
      hostId: userId,
      hostNickname: nickname,
    });
    this.rooms.save(room);
    return room;
  }
}
