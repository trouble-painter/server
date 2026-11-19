import { beforeEach, describe, expect, it } from 'vitest';
import { Membership } from '../../../../src/features/game/application/membership.js';
import { phaseTimerKey, PhaseTimer } from '../../../../src/features/game/application/phase-timer.js';
import type { RoomEventPublisher } from '../../../../src/features/game/application/ports/room-event-publisher.js';
import { CleanupRooms } from '../../../../src/features/game/application/usecases/cleanup-rooms.js';
import { CreateRoom } from '../../../../src/features/game/application/usecases/create-room.js';
import { EndTurn } from '../../../../src/features/game/application/usecases/end-turn.js';
import { JoinRoom } from '../../../../src/features/game/application/usecases/join-room.js';
import { LeaveRoom } from '../../../../src/features/game/application/usecases/leave-room.js';
import { PlayAgain } from '../../../../src/features/game/application/usecases/play-again.js';
import { React } from '../../../../src/features/game/application/usecases/react.js';
import { StartGame } from '../../../../src/features/game/application/usecases/start-game.js';
import { StartQuickStartGame } from '../../../../src/features/game/application/usecases/start-quick-start-game.js';
import { GameErrorCode } from '../../../../src/features/game/domain/game-error.js';
import type { Nickname } from '../../../../src/features/game/domain/nickname.js';
import { PhaseType } from '../../../../src/features/game/domain/phase.js';
import { Reaction } from '../../../../src/features/game/domain/reaction.js';
import { RoomEventType, type RoomEvent } from '../../../../src/features/game/domain/room-event.js';
import type { Room } from '../../../../src/features/game/domain/room.js';
import { MemoryRoomRepository } from '../../../../src/features/game/infrastructure/memory/memory-room-repository.js';
import type { IdGenerator } from '../../../../src/shared/application/ports/id-generator.js';
import { Locale } from '../../../../src/shared/domain/locale.js';
import type { RoomCode } from '../../../../src/shared/domain/room-code.js';
import type { UserId } from '../../../../src/shared/domain/user-id.js';
import { FakeClock, FakeScheduler, RecordingQueue } from '../../../support/fakes.js';
import { FakeRandom, FixedKeywords, TEST_OPTION } from '../../../support/game.js';

const NICK = 'nick' as Nickname;
const [A, B, C] = [1, 2, 3] as UserId[] as [UserId, UserId, UserId];

class RecordingPublisher implements RoomEventPublisher {
  readonly events: RoomEventType[] = [];

  publish(_room: Room, events: readonly RoomEvent[]): void {
    this.events.push(...events.map((e) => e.type));
  }
}

const ONE_CODE: IdGenerator = {
  userId: () => {
    throw new Error('unused');
  },
  roomCode: () => 'AAAAAA' as RoomCode,
};

describe('game use cases', () => {
  let rooms: MemoryRoomRepository;
  let publisher: RecordingPublisher;
  let scheduler: FakeScheduler;
  let clock: FakeClock;
  let membership: Membership;
  let timer: PhaseTimer;
  let room: Room;

  beforeEach(() => {
    rooms = new MemoryRoomRepository();
    publisher = new RecordingPublisher();
    scheduler = new FakeScheduler();
    clock = new FakeClock();
    membership = new Membership(rooms, publisher, scheduler, clock);
    timer = new PhaseTimer(rooms, publisher, scheduler, clock);
    room = new CreateRoom(rooms, membership, new RecordingQueue(), ONE_CODE, TEST_OPTION).execute(A, NICK, Locale.Ko);
    const join = new JoinRoom(rooms, membership, new RecordingQueue(), publisher);
    join.execute(B, room.id, NICK);
    join.execute(C, room.id, NICK);
    publisher.events.length = 0;
  });

  function errorCode(run: () => unknown): GameErrorCode | undefined {
    try {
      run();
    } catch (error) {
      return (error as { code?: GameErrorCode }).code;
    }
    return undefined;
  }

  function start(random = new FakeRandom()): void {
    new StartGame(rooms, publisher, timer, new FixedKeywords(), random, clock).execute(A);
  }

  /** Fires the room's phase timer after moving the clock to its deadline. */
  function fireDeadline(): void {
    clock.time = room.deadline!;
    scheduler.fire(phaseTimerKey(room.id));
  }

  it('starts with a drawn mafia, category, keyword and turn order, and arms READY', () => {
    // Picks in order: category, mafia, keyword.
    start(new FakeRandom([0, 2, 1]));
    expect(room.phase).toMatchObject({
      type: PhaseType.Ready,
      game: { mafiaId: C, category: '장소', keyword: '바다', turnOrder: [A, B, C] },
    });
    expect(publisher.events).toEqual([RoomEventType.PhaseChanged]);
    expect(scheduler.tasks.get(phaseTimerKey(room.id))?.delayMs).toBe(TEST_OPTION.readyMs);
  });

  it('refuses to start for a non-host or outside a room', () => {
    const startGame = new StartGame(rooms, publisher, timer, new FixedKeywords(), new FakeRandom(), clock);
    expect(errorCode(() => startGame.execute(B))).toBe(GameErrorCode.NotHost);
    expect(errorCode(() => startGame.execute(99 as UserId))).toBe(GameErrorCode.NotInRoom);
    expect(scheduler.tasks.size).toBe(0);
  });

  it('the timer walks the phases and re-arms for each new deadline', () => {
    start();
    fireDeadline();
    expect(room.phase.type).toBe(PhaseType.Drawing);
    expect(scheduler.tasks.get(phaseTimerKey(room.id))?.delayMs).toBe(15_000);
    fireDeadline();
    expect(publisher.events.at(-1)).toBe(RoomEventType.TurnChanged);
    expect(scheduler.tasks.get(phaseTimerKey(room.id))?.delayMs).toBe(TEST_OPTION.turnMs);
  });

  it('ending a turn early re-arms the timer for the next turn', () => {
    start();
    fireDeadline();
    clock.time += 6_000;
    new EndTurn(rooms, publisher, timer, clock).execute(A);
    const turn = room.phase.type === PhaseType.Drawing ? room.phase.turn : null;
    expect(turn).toMatchObject({ turn: 1, drawerId: B });
    expect(scheduler.tasks.get(phaseTimerKey(room.id))?.delayMs).toBe(TEST_OPTION.turnMs);
  });

  it('leaving during a game marks the player away instead of removing them', () => {
    start();
    new LeaveRoom(rooms, membership, publisher, clock).execute(B);
    expect(room.players.map((p) => [p.userId, p.isConnected])).toEqual([
      [A, true],
      [B, false],
      [C, true],
    ]);
    expect(rooms.findByUser(B)).toBe(room);
    expect(publisher.events).toEqual([RoomEventType.PhaseChanged, RoomEventType.PlayersChanged]);
  });

  it('play again disarms the timer and drops players who left', () => {
    start();
    new LeaveRoom(rooms, membership, publisher, clock).execute(B);
    while (room.phase.type !== PhaseType.End) {
      fireDeadline();
    }
    new PlayAgain(rooms, publisher, timer, clock).execute(A);
    expect(room.phase.type).toBe(PhaseType.Wait);
    expect(room.players.map((p) => p.userId)).toEqual([A, C]);
    expect(rooms.findByUser(B)).toBeNull();
    expect(scheduler.tasks.has(phaseTimerKey(room.id))).toBe(false);
  });

  it('deletes the room when the game ends with nobody connected', () => {
    start();
    for (const id of [A, B, C]) {
      room.setConnected(id, false, clock.now());
    }
    while (rooms.get(room.id) !== null) {
      fireDeadline();
    }
    expect(rooms.findByUser(A)).toBeNull();
  });

  it('throttles reactions per user without an error', () => {
    start();
    fireDeadline();
    publisher.events.length = 0;
    const react = new React(rooms, publisher, clock, 500);
    react.execute(A, Reaction.Heart);
    clock.time += 499;
    react.execute(A, Reaction.Heart);
    react.execute(B, Reaction.Heart);
    clock.time += 1;
    react.execute(A, Reaction.Heart);
    expect(publisher.events).toEqual([RoomEventType.ReactionSent, RoomEventType.ReactionSent, RoomEventType.ReactionSent]);
  });

  it('cleanup also disarms the phase timer', () => {
    start();
    for (const id of [A, B, C]) {
      room.setConnected(id, false, clock.now());
    }
    clock.time += 600_000;
    new CleanupRooms(rooms, scheduler, clock, 600_000).execute();
    expect(rooms.get(room.id)).toBeNull();
    expect(scheduler.tasks.has(phaseTimerKey(room.id))).toBe(false);
  });

  it('a quick-start game starts at once and closes its room after END', () => {
    const quickStart = new StartQuickStartGame(rooms, publisher, timer, ids('QQQQQQ'), TEST_OPTION, new FixedKeywords(), new FakeRandom(), clock);
    const [D, E, F] = [4, 5, 6] as UserId[] as [UserId, UserId, UserId];
    quickStart.execute(Locale.En, [D, E, F].map((userId) => ({ userId, nickname: NICK })));
    const quick = rooms.findByUser(E)!;
    expect(quick).toMatchObject({ id: 'QQQQQQ', isQuickStart: true, hostId: D, locale: Locale.En });
    expect(quick.phase.type).toBe(PhaseType.Ready);
    expect(publisher.events).toEqual([RoomEventType.PhaseChanged]);

    while (quick.phase.type !== PhaseType.End) {
      scheduler.fire(phaseTimerKey(quick.id));
    }
    publisher.events.length = 0;
    scheduler.fire(phaseTimerKey(quick.id));
    expect(publisher.events).toEqual([RoomEventType.RoomClosed]);
    expect(rooms.get(quick.id)).toBeNull();
    expect(rooms.findByUser(D)).toBeNull();
    expect(scheduler.tasks.has(phaseTimerKey(quick.id))).toBe(false);
  });
});

function ids(code: string): IdGenerator {
  return {
    userId: () => {
      throw new Error('unused');
    },
    roomCode: () => code as RoomCode,
  };
}
