import { beforeEach, describe, expect, it } from 'vitest';
import { GameError, GameErrorCode } from '../../../../src/features/game/domain/game-error.js';
import type { Nickname } from '../../../../src/features/game/domain/nickname.js';
import {
  matchDeadlineKey,
  Matchmaking,
  pushKey,
  queueLeaveKey,
} from '../../../../src/features/matching/application/matchmaking.js';
import type { MatchingStatus } from '../../../../src/features/matching/domain/match-queue.js';
import { Locale } from '../../../../src/shared/domain/locale.js';
import type { UserId } from '../../../../src/shared/domain/user-id.js';
import { FakeClock, FakeScheduler } from '../../../support/fakes.js';

const RULE = { min: 3, target: 6, waitMs: 10_000 };
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
  let released: UserId[];
  let matchmaking: Matchmaking;

  beforeEach(() => {
    scheduler = new FakeScheduler();
    clock = new FakeClock();
    sent = [];
    started = [];
    pushed = [];
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
      { send: (userId, status) => sent.push([userId, status]) },
      { notifyQuickStart: (locale, nickname) => pushed.push([locale, nickname]) },
      scheduler,
      clock,
    );
  });

  function join(...numbers: number[]): (MatchingStatus | null)[] {
    return numbers.map((n) => matchmaking.join(uid(n), nick(n), Locale.Ko));
  }

  it('replies with the count and tells the others', () => {
    const [first, second] = join(1, 2);
    expect(first).toEqual({ locale: Locale.Ko, waitingCount: 1, startsAt: null, minCount: RULE.min, waitMs: RULE.waitMs });
    expect(second).toEqual({ locale: Locale.Ko, waitingCount: 2, startsAt: null, minCount: RULE.min, waitMs: RULE.waitMs });
    expect(sent).toEqual([[uid(1), { locale: Locale.Ko, waitingCount: 2, startsAt: null, minCount: RULE.min, waitMs: RULE.waitMs }]]);
    expect(released).toEqual([uid(1), uid(2)]);
  });

  it('refuses a user in a game and leaves the queue alone', () => {
    expect(() => matchmaking.join(IN_GAME, nick(99), Locale.Ko)).toThrow(GameError);
    expect(matchmaking.connect(IN_GAME)).toBeNull();
  });

  it('tells everyone when the game starts once min players wait', () => {
    const [, , third] = join(1, 2, 3);
    const startsAt = clock.time + RULE.waitMs;
    expect(third).toEqual({ locale: Locale.Ko, waitingCount: 3, startsAt, minCount: RULE.min, waitMs: RULE.waitMs });
    expect(sent.slice(-2)).toEqual([1, 2].map((n) => [uid(n), { locale: Locale.Ko, waitingCount: 3, startsAt, minCount: RULE.min, waitMs: RULE.waitMs }]));
  });

  it('matches min players when the deadline passes', () => {
    join(1, 2, 3);
    expect(scheduler.tasks.get(matchDeadlineKey(Locale.Ko))?.delayMs).toBe(RULE.waitMs);
    clock.time += RULE.waitMs;
    scheduler.fire(matchDeadlineKey(Locale.Ko));
    expect(started).toEqual([[Locale.Ko, [1, 2, 3].map(uid)]]);
    expect(matchmaking.connect(uid(1))).toBeNull();
  });

  it('matches target players at once and answers the last one with null', () => {
    const replies = join(1, 2, 3, 4, 5, 6);
    expect(replies[5]).toBeNull();
    expect(started).toEqual([[Locale.Ko, [1, 2, 3, 4, 5, 6].map(uid)]]);
    expect(scheduler.tasks.has(matchDeadlineKey(Locale.Ko))).toBe(false);
  });

  it('moves a user to the queue of the locale they join', () => {
    join(1, 2);
    matchmaking.join(uid(1), nick(1), Locale.En);
    expect(sent.at(-1)).toEqual([uid(2), { locale: Locale.Ko, waitingCount: 1, startsAt: null, minCount: RULE.min, waitMs: RULE.waitMs }]);
    expect(matchmaking.connect(uid(1))).toEqual({ locale: Locale.En, waitingCount: 1, startsAt: null, minCount: RULE.min, waitMs: RULE.waitMs });
  });

  it('release takes the user out and is harmless when they are not queued', () => {
    join(1, 2);
    matchmaking.release(uid(1));
    expect(sent.at(-1)).toEqual([uid(2), { locale: Locale.Ko, waitingCount: 1, startsAt: null, minCount: RULE.min, waitMs: RULE.waitMs }]);
    expect(() => matchmaking.release(uid(1))).not.toThrow();
  });

  it('drops a user who stays disconnected past the grace period', () => {
    join(1, 2, 3);
    matchmaking.disconnect(uid(3));
    expect(sent.at(-1)).toEqual([uid(2), { locale: Locale.Ko, waitingCount: 2, startsAt: null, minCount: RULE.min, waitMs: RULE.waitMs }]);
    expect(scheduler.tasks.has(matchDeadlineKey(Locale.Ko))).toBe(false);
    scheduler.fire(queueLeaveKey(uid(3)));
    expect(matchmaking.connect(uid(3))).toBeNull();
  });

  it('a user back in time keeps their place and the match is retried after HELLO', () => {
    join(1, 2, 3);
    matchmaking.disconnect(uid(1));
    expect(matchmaking.connect(uid(1))).toEqual({ locale: Locale.Ko, waitingCount: 3, startsAt: null, minCount: RULE.min, waitMs: RULE.waitMs });
    expect(scheduler.tasks.has(queueLeaveKey(uid(1)))).toBe(false);
    expect(scheduler.tasks.get(matchDeadlineKey(Locale.Ko))?.delayMs).toBe(0);
    scheduler.fire(matchDeadlineKey(Locale.Ko));
    expect(scheduler.tasks.get(matchDeadlineKey(Locale.Ko))?.delayMs).toBe(RULE.waitMs);
    // The start time set by the retry reaches everyone waiting.
    const startsAt = clock.time + RULE.waitMs;
    expect(sent.slice(-3)).toEqual([1, 2, 3].map((n) => [uid(n), { locale: Locale.Ko, waitingCount: 3, startsAt, minCount: RULE.min, waitMs: RULE.waitMs }]));
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
