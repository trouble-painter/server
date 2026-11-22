import { beforeEach, describe, expect, it } from 'vitest';
import { GameStartPush } from '../../../../src/features/game/application/game-start-push.js';
import { GameVacancy, vacancyKey } from '../../../../src/features/game/application/game-vacancy.js';
import { Membership } from '../../../../src/features/game/application/membership.js';
import { phaseTimerKey, PhaseTimer } from '../../../../src/features/game/application/phase-timer.js';
import type { RoomEventPublisher } from '../../../../src/features/game/application/ports/room-event-publisher.js';
import { CleanupRooms } from '../../../../src/features/game/application/usecases/cleanup-rooms.js';
import { ConnectUser } from '../../../../src/features/game/application/usecases/connect-user.js';
import { CreateRoom } from '../../../../src/features/game/application/usecases/create-room.js';
import { DisconnectUser } from '../../../../src/features/game/application/usecases/disconnect-user.js';
import { EndTurn } from '../../../../src/features/game/application/usecases/end-turn.js';
import { JoinRoom } from '../../../../src/features/game/application/usecases/join-room.js';
import { LeaveRoom } from '../../../../src/features/game/application/usecases/leave-room.js';
import { React } from '../../../../src/features/game/application/usecases/react.js';
import { SetReady } from '../../../../src/features/game/application/usecases/set-ready.js';
import { StartGame } from '../../../../src/features/game/application/usecases/start-game.js';
import { UpdateRule } from '../../../../src/features/game/application/usecases/update-rule.js';
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
const VACANCY_GRACE_MS = 30_000;
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
  roomCode: () => 'AAAA' as RoomCode,
};

describe('game use cases', () => {
  let rooms: MemoryRoomRepository;
  let publisher: RecordingPublisher;
  let scheduler: FakeScheduler;
  let clock: FakeClock;
  let membership: Membership;
  let timer: PhaseTimer;
  let vacancy: GameVacancy;
  let recordings: { discarded: RoomCode[]; discard(roomId: RoomCode): void };
  let pushed: [Locale, readonly string[]][];
  let push: GameStartPush;
  let room: Room;

  beforeEach(() => {
    rooms = new MemoryRoomRepository();
    publisher = new RecordingPublisher();
    scheduler = new FakeScheduler();
    clock = new FakeClock();
    membership = new Membership(rooms, publisher, scheduler, clock);
    timer = new PhaseTimer(rooms, publisher, scheduler, clock);
    recordings = { discarded: [], discard(roomId) { this.discarded.push(roomId); } };
    vacancy = new GameVacancy(rooms, scheduler, recordings, timer, clock, VACANCY_GRACE_MS);
    pushed = [];
    push = new GameStartPush({ notifyGameStarted: (locale, tokens) => pushed.push([locale, tokens]), notifyMatchFound: () => {} });
    room = new CreateRoom(rooms, membership, new RecordingQueue(), ONE_CODE, TEST_OPTION).execute(A, NICK, Locale.Ko);
    const join = new JoinRoom(rooms, membership, new RecordingQueue(), publisher);
    join.execute(B, room.id, NICK);
    join.execute(C, room.id, NICK);
    new SetReady(rooms, publisher).execute(B, true);
    new SetReady(rooms, publisher).execute(C, true);
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
    new StartGame(rooms, publisher, timer, new FixedKeywords(), random, clock, push).execute(A);
  }

  function leave(userId: UserId): void {
    new LeaveRoom(rooms, membership, publisher, vacancy, clock).execute(userId);
  }

  function disconnect(userId: UserId): void {
    new DisconnectUser(rooms, membership, publisher, vacancy, clock, VACANCY_GRACE_MS).execute(userId);
  }

  function connect(userId: UserId): Room | null {
    return new ConnectUser(rooms, publisher, scheduler, vacancy, clock).execute(userId);
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
      game: { mafiaId: C, category: '장소', keyword: { word: '바다', synonyms: [] }, turnOrder: [A, B, C] },
    });
    expect(publisher.events).toEqual([RoomEventType.PhaseChanged]);
    expect(scheduler.tasks.get(phaseTimerKey(room.id))?.delayMs).toBe(TEST_OPTION.readyMs);
  });

  it('draws the category only from those the rule names, and tells everyone about a new rule', () => {
    const keywords = new FixedKeywords([
      { id: 'animal', category: '동물', keywords: [{ word: '고양이', synonyms: [] }] },
      { id: 'food', category: '음식', keywords: [{ word: '피자', synonyms: [] }] },
    ]);
    new UpdateRule(rooms, publisher, keywords).execute(A, { strokesPerTurn: 3, categoryIds: ['food'], keywordLocale: Locale.Ko });
    expect(room.rule).toEqual({ strokesPerTurn: 3, categoryIds: ['food'], keywordLocale: Locale.Ko });
    expect(publisher.events).toEqual([RoomEventType.RuleChanged]);
    expect(errorCode(() => new UpdateRule(rooms, publisher, keywords).execute(B, room.rule))).toBe(GameErrorCode.NotHost);
    expect(room.players.map((p) => p.isReady)).toEqual([false, false, false]);
    new SetReady(rooms, publisher).execute(B, true);
    new SetReady(rooms, publisher).execute(C, true);

    new StartGame(rooms, publisher, timer, keywords, new FakeRandom(), clock, push).execute(A);
    expect(room.phase).toMatchObject({ game: { category: '음식' } });
  });

  it('readying up tells everyone, and the host starts only once every other player is ready', () => {
    const setReady = new SetReady(rooms, publisher);
    setReady.execute(C, false);
    expect(publisher.events).toEqual([RoomEventType.PlayersChanged]);
    expect(room.players.map((p) => p.isReady)).toEqual([false, true, false]);
    expect(errorCode(() => start())).toBe(GameErrorCode.NotAllReady);
    expect(room.phase.type).toBe(PhaseType.Wait);

    setReady.execute(C, true);
    start();
    expect(room.phase.type).toBe(PhaseType.Ready);
    expect(errorCode(() => setReady.execute(B, false))).toBe(GameErrorCode.InvalidPhase);
  });

  it('the host cannot ready up, and nobody outside a room can', () => {
    const setReady = new SetReady(rooms, publisher);
    expect(errorCode(() => setReady.execute(A, true))).toBe(GameErrorCode.InvalidRequest);
    expect(errorCode(() => setReady.execute(99 as UserId, true))).toBe(GameErrorCode.NotInRoom);
  });

  it('refuses to start for a non-host or outside a room', () => {
    const startGame = new StartGame(rooms, publisher, timer, new FixedKeywords(), new FakeRandom(), clock, push);
    push.register(A, 'token-a');
    expect(errorCode(() => startGame.execute(B))).toBe(GameErrorCode.NotHost);
    expect(errorCode(() => startGame.execute(99 as UserId))).toBe(GameErrorCode.NotInRoom);
    expect(scheduler.tasks.size).toBe(0);
    expect(pushed).toEqual([]);
  });

  it('a started game pushes to every player with a token but the host who started it', () => {
    push.register(A, 'token-a');
    push.register(B, 'token-b');
    start();
    expect(pushed).toEqual([[Locale.Ko, ['token-b']]]);
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
    leave(B);
    expect(room.players.map((p) => [p.userId, p.isConnected])).toEqual([
      [A, true],
      [B, false],
      [C, true],
    ]);
    expect(rooms.findByUser(B)).toBe(room);
    expect(publisher.events).toEqual([RoomEventType.PhaseChanged, RoomEventType.PlayersChanged]);
  });

  it('deletes a game at once when everyone is away and most of them left', () => {
    start();
    disconnect(A);
    leave(B);
    expect(rooms.get(room.id)).toBe(room);
    leave(C);
    expect(rooms.get(room.id)).toBeNull();
    expect(rooms.findByUser(A)).toBeNull();
    expect(scheduler.tasks.size).toBe(0);
    expect(recordings.discarded).toEqual([room.id]);
    expect(connect(A)).toBeNull();
  });

  it('a lost connection that leaves only leavers behind also deletes the game', () => {
    start();
    leave(A);
    leave(B);
    disconnect(C);
    expect(rooms.get(room.id)).toBeNull();
  });

  it('pauses a game that most players dropped out of, and deletes it if nobody is back within the grace', () => {
    start();
    leave(A);
    disconnect(B);
    clock.time += 1_000;
    disconnect(C);
    expect(rooms.get(room.id)).toBe(room);
    expect(scheduler.tasks.has(phaseTimerKey(room.id))).toBe(false);
    expect(scheduler.tasks.get(vacancyKey(room.id))?.delayMs).toBe(VACANCY_GRACE_MS);

    // A leaver's socket closing later does not restart the grace.
    clock.time += 5_000;
    disconnect(A);
    expect(scheduler.tasks.get(vacancyKey(room.id))?.delayMs).toBe(VACANCY_GRACE_MS - 5_000);

    scheduler.fire(vacancyKey(room.id));
    expect(rooms.get(room.id)).toBeNull();
    expect(rooms.findByUser(B)).toBeNull();
    expect(recordings.discarded).toEqual([room.id]);
  });

  it('the first one back resumes the paused game with the time it had left', () => {
    start();
    fireDeadline();
    clock.time += 4_000;
    const left = room.deadline! - clock.time;
    for (const userId of [A, B, C]) {
      disconnect(userId);
    }
    clock.time += 20_000;
    expect(connect(B)).toBe(room);
    expect(scheduler.tasks.has(vacancyKey(room.id))).toBe(false);
    expect(scheduler.tasks.get(phaseTimerKey(room.id))?.delayMs).toBe(left);
    expect(room.deadline! - clock.time).toBe(left);
  });

  it('after the result everyone leaves, and the empty room stays for playing again', () => {
    start();
    while (room.deadline !== null) {
      fireDeadline();
    }
    expect(publisher.events.at(-1)).toBe(RoomEventType.PhaseChanged);
    expect(room.phase.type).toBe(PhaseType.Wait);
    expect(room.isEmpty).toBe(true);
    expect(rooms.get(room.id)).toBe(room);
    expect([A, B, C].map((id) => rooms.findByUser(id))).toEqual([null, null, null]);
    expect(scheduler.tasks.has(phaseTimerKey(room.id))).toBe(false);

    new JoinRoom(rooms, membership, new RecordingQueue(), publisher).execute(B, room.id, NICK);
    expect(room.hostId).toBe(B);
    expect(rooms.findByUser(B)).toBe(room);
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
    new CleanupRooms(rooms, scheduler, recordings, clock, 600_000).execute();
    expect(rooms.get(room.id)).toBeNull();
    expect(scheduler.tasks.has(phaseTimerKey(room.id))).toBe(false);
  });

  it('a quick-start game starts at once and deletes its room once the result is out', () => {
    const quickStart = new StartQuickStartGame(
      rooms,
      publisher,
      timer,
      ids('QQQQ'),
      TEST_OPTION,
      new FixedKeywords(),
      new FakeRandom(),
      clock,
      push,
    );
    const [D, E, F] = [4, 5, 6] as UserId[] as [UserId, UserId, UserId];
    push.register(D, 'token-d');
    push.register(F, 'token-f');
    quickStart.execute(Locale.En, [D, E, F].map((userId) => ({ userId, nickname: NICK })));
    // Nobody pressed start, so everyone with a token hears it.
    expect(pushed).toEqual([[Locale.En, ['token-d', 'token-f']]]);
    const quick = rooms.findByUser(E)!;
    expect(quick).toMatchObject({ id: 'QQQQ', isQuickStart: true, hostId: D, locale: Locale.En });
    expect(quick.phase.type).toBe(PhaseType.Ready);
    expect(publisher.events).toEqual([RoomEventType.PhaseChanged]);

    while (quick.deadline !== null) {
      scheduler.fire(phaseTimerKey(quick.id));
    }
    expect(publisher.events.at(-1)).toBe(RoomEventType.PhaseChanged);
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
