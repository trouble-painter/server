import type { Clock } from '../../../../shared/application/ports/clock.js';
import type { IdGenerator } from '../../../../shared/application/ports/id-generator.js';
import type { Random } from '../../../../shared/application/ports/random.js';
import type { Locale } from '../../../../shared/domain/locale.js';
import type { UserId } from '../../../../shared/domain/user-id.js';
import type { GameOption } from '../../domain/game-option.js';
import type { Nickname } from '../../domain/nickname.js';
import { Room } from '../../domain/room.js';
import type { GameStartPush } from '../game-start-push.js';
import type { PhaseTimer } from '../phase-timer.js';
import type { KeywordRepository } from '../ports/keyword-repository.js';
import type { RoomEventPublisher } from '../ports/room-event-publisher.js';
import type { RoomRepository } from '../ports/room-repository.js';
import { drawGame, unusedRoomCode } from '../room-setup.js';

export class StartQuickStartGame {
  constructor(
    private readonly rooms: RoomRepository,
    private readonly publisher: RoomEventPublisher,
    private readonly timer: PhaseTimer,
    private readonly ids: IdGenerator,
    private readonly option: GameOption,
    private readonly keywords: KeywordRepository,
    private readonly random: Random,
    private readonly clock: Clock,
    private readonly push: GameStartPush,
  ) {}

  /** The matched players are in no room; the first becomes host. Everyone gets the READY room. */
  execute(locale: Locale, players: readonly { userId: UserId; nickname: Nickname }[]): void {
    const [host, ...others] = players;
    if (host === undefined) {
      throw new Error('no players to start a quick-start game');
    }
    const room = Room.create({
      id: unusedRoomCode(this.rooms, this.ids),
      locale,
      isQuickStart: true,
      option: this.option,
      hostId: host.userId,
      hostNickname: host.nickname,
    });
    for (const player of others) {
      room.addPlayer(player.userId, player.nickname);
    }
    const events = room.start(host.userId, drawGame(room, this.keywords, this.random), this.clock.now());
    this.rooms.save(room);
    this.publisher.publish(room, events);
    this.timer.sync(room);
    this.push.notify(room);
  }
}
