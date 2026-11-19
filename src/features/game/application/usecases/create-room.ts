import type { IdGenerator } from '../../../../shared/application/ports/id-generator.js';
import type { Locale } from '../../../../shared/domain/locale.js';
import type { RoomCode } from '../../../../shared/domain/room-code.js';
import type { UserId } from '../../../../shared/domain/user-id.js';
import type { GameOption } from '../../domain/game-option.js';
import type { Nickname } from '../../domain/nickname.js';
import { Room } from '../../domain/room.js';
import type { Membership } from '../membership.js';
import type { RoomRepository } from '../ports/room-repository.js';

export class CreateRoom {
  constructor(
    private readonly rooms: RoomRepository,
    private readonly membership: Membership,
    private readonly ids: IdGenerator,
    private readonly option: GameOption,
  ) {}

  execute(userId: UserId, nickname: Nickname, locale: Locale): Room {
    this.membership.release(userId);
    const room = Room.create({
      id: this.unusedCode(),
      locale,
      isQuickStart: false,
      option: this.option,
      hostId: userId,
      hostNickname: nickname,
    });
    this.rooms.save(room);
    return room;
  }

  private unusedCode(): RoomCode {
    let code: RoomCode;
    do {
      code = this.ids.roomCode();
    } while (this.rooms.get(code) !== null);
    return code;
  }
}
