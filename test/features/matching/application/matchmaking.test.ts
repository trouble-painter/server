import { beforeEach, describe, expect, it } from 'vitest';
import { GameError, GameErrorCode } from '../../../../src/features/game/domain/game-error.js';
import type { Nickname } from '../../../../src/features/game/domain/nickname.js';
import {
  matchDeadlineKey,
  Matchmaking,
  pushKey,
  queueLeaveKey,
  readyKey,
} from '../../../../src/features/matching/application/matchmaking.js';
import type { MatchingStatus } from '../../../../src/features/matching/domain/match-queue.js';
import { Locale } from '../../../../src/shared/domain/locale.js';
import type { UserId } from '../../../../src/shared/domain/user-id.js';
import { FakeClock, FakeScheduler } from '../../../support/fakes.js';

const RULE = { min: 3, target: 6, waitMs: 10_000, acceptMs: 5_000 };
const PUSH = { waitMs: 5_000, cooldownMs: 300_000 };
const GRACE_MS = 10_000;
const uid = (n: number) => n as UserId;
const nick = (n: number) => `P${n}` as Nickname;
const IN_GAME = uid(99);
/** The first queue the tests open. */
const Q1 = 'ko:1';
const Q2 = 'ko:2';

describe('Matchmaking', () => {
  let scheduler: FakeScheduler;
  let clock: FakeClock;
  let sent: [UserId, MatchingStatus][];
  let started: [Locale, UserId[]][];
  let pushed: [Locale, Nickname][];
  let declined: UserId[];
  let matchFound: [Locale, UserId[]][];
  let released: UserId[];
  let matchmaking: Matchmaking;

  beforeEach(() => {
    scheduler = new FakeScheduler();
    clock = new FakeClock();
    sent = [];
    started = [];
    pushed = [];
    declined = [];
    matchFound = [];
    released = [];
    matchmaking = new Matchmaking(
      RULE,
      PUSH,
      GRACE_MS,
      {
        release: (userId) => {
          if (userId === IN_GAME) {
            throw new GameError(GameErrorCode.AlreadyInGame);
          }
          released.push(userId);
        },
      },
      { start: (locale, players) => started.push([locale, players.map((p) => p.userId)]) },
      { send: (userId, status) => sent.push([userId, status]), declined: (userId) => declined.push(userId) },
      { notifyQuickStart: (locale, nickname) => pushed.push([locale, nickname]) },
      { notifyMatchFound: (locale, userIds) => matchFound.push([locale, [...userIds]]) },
      scheduler,
      clock,
    );
  });

  function join(...numbers: number[]): MatchingStatus[] {
    return numbers.map((n) => matchmaking.join(uid(n), nick(n), Locale.Ko));
  }

  it('replies with the count and tells the others', () => {
    const [first, second] = join(1, 2);
    expect(first).toEqual({ locale: Locale.Ko, waitingCount: 1, startsAt: null, minCount: RULE.min, waitMs: RULE.waitMs, ready: null });
    expect(second).toEqual({ locale: Locale.Ko, waitingCount: 2, startsAt: null, minCount: RULE.min, waitMs: RULE.waitMs, ready: null });
    expect(sent).toEqual([[uid(1), { locale: Locale.Ko, waitingCount: 2, startsAt: null, minCount: RULE.min, waitMs: RULE.waitMs, ready: null }]]);
    expect(released).toEqual([uid(1), uid(2)]);
  });

  it('refuses a user in a game and leaves the queue alone', () => {
    expect(() => matchmaking.join(IN_GAME, nick(99), Locale.Ko)).toThrow(GameError);
    expect(matchmaking.connect(IN_GAME)).toBeNull();
  });

  it('tells everyone when the game starts once min players wait', () => {
    const [, , third] = join(1, 2, 3);
    const startsAt = clock.time + RULE.waitMs;
    expect(third).toEqual({ locale: Locale.Ko, waitingCount: 3, startsAt, minCount: RULE.min, waitMs: RULE.waitMs, ready: null });
    expect(sent.slice(-2)).toEqual([1, 2].map((n) => [uid(n), { locale: Locale.Ko, waitingCount: 3, startsAt, minCount: RULE.min, waitMs: RULE.waitMs, ready: null }]));
  });

  /** Everyone's `ready` as last sent to them. */
  const readyOf = (n: number) => sent.findLast(([id]) => id === uid(n))?.[1].ready;

  it('starts the accept step, not the game, when the deadline passes', () => {
    join(1, 2, 3);
    expect(scheduler.tasks.get(matchDeadlineKey(Q1))?.delayMs).toBe(RULE.waitMs);
    clock.time += RULE.waitMs;
    scheduler.fire(matchDeadlineKey(Q1));
    expect(started).toEqual([]);
    expect(matchFound).toEqual([[Locale.Ko, [1, 2, 3].map(uid)]]);
    expect(scheduler.tasks.get(readyKey(Q1))?.delayMs).toBe(RULE.acceptMs);
    const ready = { endsAt: clock.time + RULE.acceptMs, acceptMs: RULE.acceptMs, isAccepted: false };
    for (const n of [1, 2, 3]) {
      expect(readyOf(n)).toEqual(ready);
    }
  });

  it('starts the accept step at once for target players and answers the last with it', () => {
    const replies = join(1, 2, 3, 4, 5, 6);
    expect(replies[5]?.ready).toEqual({ endsAt: clock.time + RULE.acceptMs, acceptMs: RULE.acceptMs, isAccepted: false });
    expect(started).toEqual([]);
    expect(scheduler.tasks.has(matchDeadlineKey(Q1))).toBe(false);
  });

  function matchThree(): void {
    join(1, 2, 3);
    clock.time += RULE.waitMs;
    scheduler.fire(matchDeadlineKey(Q1));
  }

  it('starts the game as soon as everyone accepted', () => {
    matchThree();
    expect(matchmaking.accept(uid(1))?.ready?.isAccepted).toBe(true);
    expect(matchmaking.accept(uid(2))?.ready?.isAccepted).toBe(true);
    expect(started).toEqual([]);
    expect(matchmaking.accept(uid(3))).toBeNull();
    expect(started).toEqual([[Locale.Ko, [1, 2, 3].map(uid)]]);
    expect(scheduler.tasks.has(readyKey(Q1))).toBe(false);
    expect(declined).toEqual([]);
    expect(matchmaking.connect(uid(1))).toBeNull();
  });

  it('starts with those who accepted when at least min did, and sends the rest home', () => {
    join(1, 2, 3, 4);
    clock.time += RULE.waitMs;
    scheduler.fire(matchDeadlineKey(Q1));
    for (const n of [1, 2, 3]) {
      matchmaking.accept(uid(n));
    }
    expect(started).toEqual([]);
    clock.time += RULE.acceptMs;
    scheduler.fire(readyKey(Q1));
    expect(started).toEqual([[Locale.Ko, [1, 2, 3].map(uid)]]);
    expect(declined).toEqual([uid(4)]);
    expect(matchmaking.connect(uid(4))).toBeNull();
  });

  it('requeues those who accepted and sends home those who did not when fewer than min accepted', () => {
    matchThree();
    matchmaking.accept(uid(1));
    matchmaking.accept(uid(2));
    clock.time += RULE.acceptMs;
    scheduler.fire(readyKey(Q1));
    expect(started).toEqual([]);
    expect(declined).toEqual([uid(3)]);
    expect(matchmaking.connect(uid(3))).toBeNull();
    expect(sent.at(-1)).toEqual([uid(2), { locale: Locale.Ko, waitingCount: 2, startsAt: null, minCount: RULE.min, waitMs: RULE.waitMs, ready: null }]);
    expect(matchmaking.connect(uid(1))).toMatchObject({ waitingCount: 2, ready: null });
  });

  it('matches the requeued with newcomers again', () => {
    matchThree();
    matchmaking.accept(uid(1));
    matchmaking.accept(uid(2));
    clock.time += RULE.acceptMs;
    scheduler.fire(readyKey(Q1));
    join(4);
    // 1, 2 and 4 wait now: the countdown runs again.
    expect(scheduler.tasks.get(matchDeadlineKey(Q1))?.delayMs).toBe(RULE.waitMs);
    clock.time += RULE.waitMs;
    scheduler.fire(matchDeadlineKey(Q1));
    expect(matchFound.at(-1)).toEqual([Locale.Ko, [1, 2, 4].map(uid)]);
  });

  it('puts a newcomer into a new queue while another runs its accept step, with its own count', () => {
    matchThree();
    const reply = join(4)[0];
    expect(reply).toMatchObject({ waitingCount: 1, startsAt: null, ready: null });
    expect(readyOf(1)).not.toBeNull();
    expect(scheduler.tasks.has(readyKey(Q1))).toBe(true);
  });

  it('fills the oldest queue first and opens a new one only when it is full', () => {
    join(1, 2, 3, 4, 5);
    expect(join(6)[0]?.ready).not.toBeNull();
    const [seventh, eighth, ninth] = join(7, 8, 9);
    expect(seventh).toMatchObject({ waitingCount: 1, ready: null });
    expect(eighth).toMatchObject({ waitingCount: 2, ready: null });
    expect(ninth).toMatchObject({ waitingCount: 3, startsAt: clock.time + RULE.waitMs, ready: null });
    // The second queue counts down on its own while the first runs its accept step.
    expect(scheduler.tasks.has(readyKey(Q1))).toBe(true);
    expect(scheduler.tasks.get(matchDeadlineKey(Q2))?.delayMs).toBe(RULE.waitMs);
  });

  it('runs a second queue through its accept step and game while the first still accepts', () => {
    join(1, 2, 3, 4, 5, 6);
    join(7, 8, 9);
    clock.time += RULE.waitMs;
    scheduler.fire(matchDeadlineKey(Q2));
    expect(matchFound.at(-1)).toEqual([Locale.Ko, [7, 8, 9].map(uid)]);
    for (const n of [7, 8, 9]) {
      matchmaking.accept(uid(n));
    }
    expect(started).toEqual([[Locale.Ko, [7, 8, 9].map(uid)]]);
    expect(readyOf(1)).not.toBeNull();
    expect(scheduler.tasks.has(readyKey(Q1))).toBe(true);
  });

  it('refills an older queue after a call-off from the newer queue, longest waiters first', () => {
    join(1, 2, 3, 4, 5, 6);
    clock.time += 1_000;
    join(7);
    clock.time += 1_000;
    join(8);
    for (const n of [3, 4, 5, 6]) {
      matchmaking.release(uid(n));
    }
    // Queue 1 fell to 1 and 2, waits again and takes 7 and 8 from queue 2, which is gone.
    expect(scheduler.tasks.has(readyKey(Q1))).toBe(false);
    expect(scheduler.tasks.get(matchDeadlineKey(Q1))?.delayMs).toBe(RULE.waitMs);
    expect(scheduler.tasks.has(matchDeadlineKey(Q2))).toBe(false);
    expect(matchmaking.connect(uid(1))).toMatchObject({ waitingCount: 4, ready: null });
    expect(matchmaking.connect(uid(8))).toMatchObject({ waitingCount: 4, ready: null });
  });

  it('keeps the countdown that already ran when players move into an older queue', () => {
    join(1, 2, 3, 4, 5, 6);
    join(7, 8, 9);
    clock.time += 6_000;
    for (const n of [3, 4, 5, 6]) {
      matchmaking.release(uid(n));
    }
    // 1 and 2 wait again and take 7, 8 and 9, whose countdown has 4 seconds left.
    expect(scheduler.tasks.get(matchDeadlineKey(Q1))?.delayMs).toBe(RULE.waitMs - 6_000);
    expect(scheduler.tasks.has(matchDeadlineKey(Q2))).toBe(false);
  });

  it('does not restart the countdown of an older queue when others join or move in', () => {
    join(1, 2, 3);
    clock.time += 4_000;
    join(4);
    expect(scheduler.tasks.get(matchDeadlineKey(Q1))?.delayMs).toBe(RULE.waitMs - 4_000);
  });

  it('runs a queue per locale and never mixes their players', () => {
    join(1, 2, 3, 4, 5, 6);
    const en = [7, 8, 9].map((n) => matchmaking.join(uid(n), nick(n), Locale.En));
    expect(en[2]).toMatchObject({ locale: Locale.En, waitingCount: 3, ready: null });
    // The Korean queue is in its accept step and the English one counts down on its own.
    expect(readyOf(1)).not.toBeNull();
    expect(scheduler.tasks.get(matchDeadlineKey('en:2'))?.delayMs).toBe(RULE.waitMs);
    // Korean players leaving open places that English players must not fill.
    for (const n of [3, 4, 5, 6]) {
      matchmaking.release(uid(n));
    }
    expect(matchmaking.connect(uid(1))).toMatchObject({ locale: Locale.Ko, waitingCount: 2 });
    expect(matchmaking.connect(uid(7))).toMatchObject({ locale: Locale.En, waitingCount: 3 });
    clock.time += RULE.waitMs;
    scheduler.fire(matchDeadlineKey('en:2'));
    expect(matchFound.at(-1)).toEqual([Locale.En, [7, 8, 9].map(uid)]);
  });

  it('keeps a rejoining member in their own queue', () => {
    join(1, 2, 3, 4, 5, 6);
    join(7);
    matchmaking.join(uid(1), nick(1), Locale.Ko);
    expect(matchmaking.connect(uid(1))?.ready).not.toBeNull();
    expect(matchmaking.connect(uid(7))).toMatchObject({ waitingCount: 1 });
  });

  it('calls the step off and sends everyone back to waiting when fewer than min stay', () => {
    matchThree();
    matchmaking.accept(uid(1));
    matchmaking.release(uid(3));
    expect(started).toEqual([]);
    expect(declined).toEqual([]);
    expect(scheduler.tasks.has(readyKey(Q1))).toBe(false);
    expect(matchmaking.connect(uid(1))).toMatchObject({ waitingCount: 2, startsAt: null, ready: null });
    expect(matchmaking.connect(uid(2))).toMatchObject({ waitingCount: 2, ready: null });
    expect(sent).toContainEqual([uid(2), { locale: Locale.Ko, waitingCount: 2, startsAt: null, minCount: RULE.min, waitMs: RULE.waitMs, ready: null }]);
  });

  it('calls the step off when a member disconnects and fewer than min stay', () => {
    matchThree();
    matchmaking.disconnect(uid(3));
    expect(scheduler.tasks.has(readyKey(Q1))).toBe(false);
    expect(matchmaking.connect(uid(1))).toMatchObject({ waitingCount: 2, ready: null });
  });

  it('keeps the step going when at least min stay', () => {
    join(1, 2, 3, 4);
    clock.time += RULE.waitMs;
    scheduler.fire(matchDeadlineKey(Q1));
    matchmaking.release(uid(4));
    expect(scheduler.tasks.has(readyKey(Q1))).toBe(true);
    expect(matchmaking.connect(uid(1))?.ready).not.toBeNull();
  });

  it('declines a disconnected user at the end of the step', () => {
    join(1, 2, 3, 4);
    clock.time += RULE.waitMs;
    scheduler.fire(matchDeadlineKey(Q1));
    matchmaking.accept(uid(1));
    matchmaking.accept(uid(2));
    matchmaking.accept(uid(3));
    matchmaking.disconnect(uid(4));
    clock.time += RULE.acceptMs;
    scheduler.fire(readyKey(Q1));
    expect(declined).toEqual([uid(4)]);
    expect(started).toEqual([[Locale.Ko, [1, 2, 3].map(uid)]]);
  });

  it('ignores an accept from a user who is not queued', () => {
    expect(matchmaking.accept(uid(1))).toBeNull();
  });

  it('shows a user back during the step their step on HELLO', () => {
    join(1, 2, 3, 4);
    clock.time += RULE.waitMs;
    scheduler.fire(matchDeadlineKey(Q1));
    matchmaking.disconnect(uid(1));
    expect(matchmaking.connect(uid(1))?.ready).toEqual({ endsAt: clock.time + RULE.acceptMs, acceptMs: RULE.acceptMs, isAccepted: false });
  });

  it('moves a user to the queue of the locale they join', () => {
    join(1, 2);
    matchmaking.join(uid(1), nick(1), Locale.En);
    expect(sent.at(-1)).toEqual([uid(2), { locale: Locale.Ko, waitingCount: 1, startsAt: null, minCount: RULE.min, waitMs: RULE.waitMs, ready: null }]);
    expect(matchmaking.connect(uid(1))).toEqual({ locale: Locale.En, waitingCount: 1, startsAt: null, minCount: RULE.min, waitMs: RULE.waitMs, ready: null });
  });

  it('release takes the user out and is harmless when they are not queued', () => {
    join(1, 2);
    matchmaking.release(uid(1));
    expect(sent.at(-1)).toEqual([uid(2), { locale: Locale.Ko, waitingCount: 1, startsAt: null, minCount: RULE.min, waitMs: RULE.waitMs, ready: null }]);
    expect(() => matchmaking.release(uid(1))).not.toThrow();
  });

  it('drops a user who stays disconnected past the grace period', () => {
    join(1, 2, 3);
    matchmaking.disconnect(uid(3));
    expect(sent.at(-1)).toEqual([uid(2), { locale: Locale.Ko, waitingCount: 2, startsAt: null, minCount: RULE.min, waitMs: RULE.waitMs, ready: null }]);
    expect(scheduler.tasks.has(matchDeadlineKey(Q1))).toBe(false);
    scheduler.fire(queueLeaveKey(uid(3)));
    expect(matchmaking.connect(uid(3))).toBeNull();
  });

  it('a user back in time keeps their place and the match is retried after HELLO', () => {
    join(1, 2, 3);
    matchmaking.disconnect(uid(1));
    expect(matchmaking.connect(uid(1))).toEqual({ locale: Locale.Ko, waitingCount: 3, startsAt: null, minCount: RULE.min, waitMs: RULE.waitMs, ready: null });
    expect(scheduler.tasks.has(queueLeaveKey(uid(1)))).toBe(false);
    expect(scheduler.tasks.get(matchDeadlineKey(Q1))?.delayMs).toBe(0);
    scheduler.fire(matchDeadlineKey(Q1));
    expect(scheduler.tasks.get(matchDeadlineKey(Q1))?.delayMs).toBe(RULE.waitMs);
    // The start time set by the retry reaches everyone waiting.
    const startsAt = clock.time + RULE.waitMs;
    expect(sent.slice(-3)).toEqual([1, 2, 3].map((n) => [uid(n), { locale: Locale.Ko, waitingCount: 3, startsAt, minCount: RULE.min, waitMs: RULE.waitMs, ready: null }]));
  });

  it('pushes with the longest waiter after the wait, then not again within the cooldown', () => {
    join(1);
    expect(scheduler.tasks.get(pushKey(Locale.Ko))?.delayMs).toBe(PUSH.waitMs);
    clock.time += 1_000;
    join(2);
    clock.time += PUSH.waitMs - 1_000;
    scheduler.fire(pushKey(Locale.Ko));
    expect(pushed).toEqual([[Locale.Ko, nick(1)]]);
    expect(scheduler.tasks.get(pushKey(Locale.Ko))?.delayMs).toBe(PUSH.cooldownMs);
  });

  it('does not push once nobody is waiting', () => {
    join(1);
    matchmaking.release(uid(1));
    expect(scheduler.tasks.has(pushKey(Locale.Ko))).toBe(false);
  });
});
