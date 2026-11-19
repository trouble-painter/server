import { toRoomCode } from '../../../../shared/domain/room-code.js';
import type { UserId } from '../../../../shared/domain/user-id.js';
import { GameError, GameErrorCode } from '../../domain/game-error.js';
import type { Nickname } from '../../domain/nickname.js';
import type { Room } from '../../domain/room.js';
import type { Membership } from '../membership.js';
import type { QueueMembership } from '../ports/queue-membership.js';
import type { RoomEventPublisher } from '../ports/room-event-publisher.js';
import type { RoomRepository } from '../ports/room-repository.js';

export class JoinRoom {
  constructor(
    private readonly rooms: RoomRepository,
    private readonly membership: Membership,
    private readonly queue: QueueMembership,
    private readonly publisher: RoomEventPublisher,
  ) {}

  /** A code that is not well formed is just a room that does not exist. */
  execute(userId: UserId, roomCode: string, nickname: Nickname): Room {
    const id = toRoomCode(roomCode);
    const room = id === null ? null : this.rooms.get(id);
    if (room === null) {
      throw new GameError(GameErrorCode.RoomNotFound);
    }
    if (room.hasPlayer(userId)) {
      return room;
    }
    // Check before leaving the current room so a refused join keeps the user where they were.
    room.assertJoinable();
    this.membership.release(userId);
    this.queue.release(userId);
    const events = room.addPlayer(userId, nickname);
    this.rooms.save(room);
    this.publisher.publish(room, events, userId);
    return room;
  }
}
