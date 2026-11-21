import { beforeEach, describe, expect, it } from 'vitest';
import { Membership, waitLeaveKey } from '../../../../src/features/game/application/membership.js';
import type { RoomEventPublisher } from '../../../../src/features/game/application/ports/room-event-publisher.js';
import { CleanupRooms } from '../../../../src/features/game/application/usecases/cleanup-rooms.js';
import { ConnectUser } from '../../../../src/features/game/application/usecases/connect-user.js';
import { CreateRoom } from '../../../../src/features/game/application/usecases/create-room.js';
import { DisconnectUser } from '../../../../src/features/game/application/usecases/disconnect-user.js';
import { JoinRoom } from '../../../../src/features/game/application/usecases/join-room.js';
import { LeaveRoom } from '../../../../src/features/game/application/usecases/leave-room.js';
import { GameErrorCode } from '../../../../src/features/game/domain/game-error.js';
import type { Nickname } from '../../../../src/features/game/domain/nickname.js';
import type { Room } from '../../../../src/features/game/domain/room.js';
import { MemoryRoomRepository } from '../../../../src/features/game/infrastructure/memory/memory-room-repository.js';
import type { IdGenerator } from '../../../../src/shared/application/ports/id-generator.js';
import { Locale } from '../../../../src/shared/domain/locale.js';
import type { RoomCode } from '../../../../src/shared/domain/room-code.js';
import type { UserId } from '../../../../src/shared/domain/user-id.js';
import { FakeClock, FakeScheduler, RecordingQueue } from '../../../support/fakes.js';
import { TEST_OPTION } from '../../../support/game.js';

const NICK = 'nick' as Nickname;
const GRACE_MS = 30_000;
const TTL_MS = 600_000;
const A = 1 as UserId;
const B = 2 as UserId;
const C = 3 as UserId;

class RecordingPublisher implements RoomEventPublisher {
  readonly published: { roomId: RoomCode; except?: UserId }[] = [];

  publish(room: Room, _events: readonly unknown[], except?: UserId): void {
    this.published.push({ roomId: room.id, except });
  }
}

/** Hands out the given codes in order. */
class QueuedIds implements IdGenerator {
  constructor(private readonly codes: string[]) {}

  userId(): UserId {
    throw new Error('unused');
  }

  roomCode(): RoomCode {
    return this.codes.shift() as RoomCode;
  }
}

describe('room use cases', () => {
  let rooms: MemoryRoomRepository;
  let publisher: RecordingPublisher;
  let scheduler: FakeScheduler;
  let clock: FakeClock;
  let createRoom: CreateRoom;
  let joinRoom: JoinRoom;
  let leaveRoom: LeaveRoom;
  let connectUser: ConnectUser;
  let disconnectUser: DisconnectUser;
  let cleanupRooms: CleanupRooms;
  let queue: RecordingQueue;

  beforeEach(() => {
    rooms = new MemoryRoomRepository();
    publisher = new RecordingPublisher();
    scheduler = new FakeScheduler();
    clock = new FakeClock();
    const membership = new Membership(rooms, publisher, scheduler, clock);
    queue = new RecordingQueue();
    createRoom = new CreateRoom(rooms, membership, queue, new QueuedIds(['AAAA', 'AAAA', 'BBBB', 'CCCC']), TEST_OPTION);
    joinRoom = new JoinRoom(rooms, membership, queue, publisher);
    leaveRoom = new LeaveRoom(rooms, membership, publisher, clock);
    connectUser = new ConnectUser(rooms, publisher, scheduler, clock);
    disconnectUser = new DisconnectUser(rooms, membership, publisher, clock, GRACE_MS);
    cleanupRooms = new CleanupRooms(rooms, scheduler, clock, TTL_MS);
  });

  function errorCode(run: () => unknown): GameErrorCode | undefined {
    try {
      run();
    } catch (error) {
      return (error as { code?: GameErrorCode }).code;
    }
    return undefined;
  }

  it('skips a room code that is already taken', () => {
    expect(createRoom.execute(A, NICK, Locale.Ko).id).toBe('AAAA');
    expect(createRoom.execute(B, NICK, Locale.Ko).id).toBe('BBBB');
  });

  it('creating a room takes the user out of their waiting room', () => {
    const first = createRoom.execute(A, NICK, Locale.Ko);
    joinRoom.execute(B, first.id, NICK);
    const second = createRoom.execute(B, NICK, Locale.En);
    expect(first.players.map((p) => p.userId)).toEqual([A]);
    expect(rooms.findByUser(B)).toBe(second);
  });

  it('creating or joining a room takes the user out of the quick-start queue', () => {
    const room = createRoom.execute(A, NICK, Locale.Ko);
    joinRoom.execute(B, room.id, NICK);
    expect(queue.released).toEqual([A, B]);
  });

  it('joining tells everyone else and is idempotent for a member', () => {
    const room = createRoom.execute(A, NICK, Locale.Ko);
    publisher.published.length = 0;
    joinRoom.execute(B, room.id, NICK);
    expect(publisher.published).toEqual([{ roomId: room.id, except: B }]);
    expect(joinRoom.execute(B, room.id, NICK)).toBe(room);
    expect(room.players).toHaveLength(2);
  });

  it('a refused join keeps the user in their current room', () => {
    const own = createRoom.execute(A, NICK, Locale.Ko);
    expect(errorCode(() => joinRoom.execute(A, 'ZZZZ', NICK))).toBe(GameErrorCode.RoomNotFound);
    expect(errorCode(() => joinRoom.execute(A, 'not a code', NICK))).toBe(GameErrorCode.RoomNotFound);
    expect(rooms.findByUser(A)).toBe(own);
  });

  it('leaving deletes the room with its last player and unindexes the user', () => {
    const room = createRoom.execute(A, NICK, Locale.Ko);
    leaveRoom.execute(A);
    expect(rooms.get(room.id)).toBeNull();
    expect(rooms.findByUser(A)).toBeNull();
    expect(errorCode(() => leaveRoom.execute(A))).toBe(GameErrorCode.NotInRoom);
  });

  it('removes a player who stays disconnected from a waiting room past the grace period', () => {
    const room = createRoom.execute(A, NICK, Locale.Ko);
    joinRoom.execute(B, room.id, NICK);
    disconnectUser.execute(A);
    expect(room.isConnected(A)).toBe(false);
    expect(scheduler.tasks.get(waitLeaveKey(A))?.delayMs).toBe(GRACE_MS);
    scheduler.fire(waitLeaveKey(A));
    expect(room.players.map((p) => p.userId)).toEqual([B]);
    expect(room.hostId).toBe(B);
    expect(rooms.findByUser(A)).toBeNull();
  });

  it('keeps a player who reconnects within the grace period', () => {
    const room = createRoom.execute(A, NICK, Locale.Ko);
    disconnectUser.execute(A);
    expect(connectUser.execute(A)).toBe(room);
    expect(scheduler.tasks.has(waitLeaveKey(A))).toBe(false);
    expect(room.isConnected(A)).toBe(true);
  });

  it('connecting without a room returns null', () => {
    expect(connectUser.execute(C)).toBeNull();
  });

  it('cleans up rooms nobody has been connected to for the TTL', () => {
    const stale = createRoom.execute(A, NICK, Locale.Ko);
    const live = createRoom.execute(B, NICK, Locale.Ko);
    disconnectUser.execute(A);
    clock.time += TTL_MS - 1;
    cleanupRooms.execute();
    expect(rooms.get(stale.id)).toBe(stale);
    clock.time += 1;
    cleanupRooms.execute();
    expect(rooms.get(stale.id)).toBeNull();
    expect(rooms.findByUser(A)).toBeNull();
    expect(scheduler.tasks.has(waitLeaveKey(A))).toBe(false);
    expect(rooms.get(live.id)).toBe(live);
  });
});
