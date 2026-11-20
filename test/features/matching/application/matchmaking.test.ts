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
    expect(scheduler.tasks.get(matchDeadlineKey(Locale.Ko))?.delayMs).toBe(RULE.waitMs);
    clock.time += RULE.waitMs;
    scheduler.fire(matchDeadlineKey(Locale.Ko));
    expect(started).toEqual([]);
    expect(matchFound).toEqual([[Locale.Ko, [1, 2, 3].map(uid)]]);
    expect(scheduler.tasks.get(readyKey(Locale.Ko))?.delayMs).toBe(RULE.acceptMs);
    const ready = { endsAt: clock.time + RULE.acceptMs, acceptMs: RULE.acceptMs, isAccepted: false };
    for (const n of [1, 2, 3]) {
      expect(readyOf(n)).toEqual(ready);
    }
  });

  it('starts the accept step at once for target players and answers the last with it', () => {
    const replies = join(1, 2, 3, 4, 5, 6);
    expect(replies[5]?.ready).toEqual({ endsAt: clock.time + RULE.acceptMs, acceptMs: RULE.acceptMs, isAccepted: false });
    expect(started).toEqual([]);
    expect(scheduler.tasks.has(matchDeadlineKey(Locale.Ko))).toBe(false);
  });

  function matchThree(): void {
    join(1, 2, 3);
    clock.time += RULE.waitMs;
    scheduler.fire(matchDeadlineKey(Locale.Ko));
  }

  it('starts the game as soon as everyone accepted', () => {
    matchThree();
    expect(matchmaking.accept(uid(1))?.ready?.isAccepted).toBe(true);
    expect(matchmaking.accept(uid(2))?.ready?.isAccepted).toBe(true);
    expect(started).toEqual([]);
    expect(matchmaking.accept(uid(3))).toBeNull();
    expect(started).toEqual([[Locale.Ko, [1, 2, 3].map(uid)]]);
    expect(scheduler.tasks.has(readyKey(Locale.Ko))).toBe(false);
    expect(declined).toEqual([]);
    expect(matchmaking.connect(uid(1))).toBeNull();
  });

  it('starts with those who accepted when at least min did, and sends the rest home', () => {
    join(1, 2, 3, 4);
    clock.time += RULE.waitMs;
    scheduler.fire(matchDeadlineKey(Locale.Ko));
    for (const n of [1, 2, 3]) {
      matchmaking.accept(uid(n));
    }
    expect(started).toEqual([]);
    clock.time += RULE.acceptMs;
    scheduler.fire(readyKey(Locale.Ko));
    expect(started).toEqual([[Locale.Ko, [1, 2, 3].map(uid)]]);
    expect(declined).toEqual([uid(4)]);
    expect(matchmaking.connect(uid(4))).toBeNull();
  });

  it('requeues those who accepted and sends home those who did not when fewer than min accepted', () => {
    matchThree();
    matchmaking.accept(uid(1));
    matchmaking.accept(uid(2));
    clock.time += RULE.acceptMs;
    scheduler.fire(readyKey(Locale.Ko));
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
    join(4);
    expect(readyOf(4)).toBeUndefined();
    clock.time += RULE.acceptMs;
    scheduler.fire(readyKey(Locale.Ko));
    // 1, 2 and 4 wait now: the countdown runs again.
    expect(scheduler.tasks.get(matchDeadlineKey(Locale.Ko))?.delayMs).toBe(RULE.waitMs);
    clock.time += RULE.waitMs;
    scheduler.fire(matchDeadlineKey(Locale.Ko));
    expect(matchFound.at(-1)).toEqual([Locale.Ko, [1, 2, 4].map(uid)]);
  });

  it('gives a newcomer no accept step while one runs', () => {
    matchThree();
    expect(join(4)[0]).toMatchObject({ waitingCount: 1, ready: null });
  });

  it('treats a user who leaves the step as not accepting', () => {
    matchThree();
    matchmaking.accept(uid(1));
    matchmaking.accept(uid(2));
    matchmaking.release(uid(3));
    expect(started).toEqual([]);
    expect(matchmaking.connect(uid(1))).toMatchObject({ ready: null });
    expect(declined).toEqual([]);
  });

  it('declines a disconnected user at the end of the step', () => {
    matchThree();
    matchmaking.accept(uid(1));
    matchmaking.accept(uid(2));
    matchmaking.disconnect(uid(3));
    clock.time += RULE.acceptMs;
    scheduler.fire(readyKey(Locale.Ko));
    expect(declined).toEqual([uid(3)]);
  });

  it('ignores an accept from a user who is not queued', () => {
    expect(matchmaking.accept(uid(1))).toBeNull();
  });

  it('shows a user back during the step their step on HELLO', () => {
    matchThree();
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
    expect(scheduler.tasks.has(matchDeadlineKey(Locale.Ko))).toBe(false);
    scheduler.fire(queueLeaveKey(uid(3)));
    expect(matchmaking.connect(uid(3))).toBeNull();
  });

  it('a user back in time keeps their place and the match is retried after HELLO', () => {
    join(1, 2, 3);
    matchmaking.disconnect(uid(1));
    expect(matchmaking.connect(uid(1))).toEqual({ locale: Locale.Ko, waitingCount: 3, startsAt: null, minCount: RULE.min, waitMs: RULE.waitMs, ready: null });
    expect(scheduler.tasks.has(queueLeaveKey(uid(1)))).toBe(false);
    expect(scheduler.tasks.get(matchDeadlineKey(Locale.Ko))?.delayMs).toBe(0);
    scheduler.fire(matchDeadlineKey(Locale.Ko));
    expect(scheduler.tasks.get(matchDeadlineKey(Locale.Ko))?.delayMs).toBe(RULE.waitMs);
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
