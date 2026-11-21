import { describe, expect, it } from 'vitest';
import type { Nickname } from '../../../../src/features/game/domain/nickname.js';
import { createMatchRule, MatchQueue, type MatchRule } from '../../../../src/features/matching/domain/match-queue.js';
import { pushDueAt } from '../../../../src/features/matching/domain/push-rule.js';
import { Locale } from '../../../../src/shared/domain/locale.js';
import type { UserId } from '../../../../src/shared/domain/user-id.js';

const RULE: MatchRule = { min: 3, target: 6, waitMs: 10_000, acceptMs: 5_000 };
const T0 = 1_000_000;
const uid = (n: number) => n as UserId;
const nick = (n: number) => `P${n}` as Nickname;

/** A queue with users 1..count joined one millisecond apart, settled after each join. */
function queueOf(count: number): MatchQueue {
  const queue = new MatchQueue('q', Locale.Ko, RULE);
  for (let n = 1; n <= count; n++) {
    queue.join(uid(n), nick(n), T0 + n);
    expect(queue.settle(T0 + n)).toEqual([]);
  }
  return queue;
}

const ids = (entries: readonly { userId: UserId }[]) => entries.map((e) => e.userId);

describe('MatchQueue', () => {
  it('sets a deadline once min players wait and keeps it as more join', () => {
    const queue = queueOf(2);
    expect(queue.deadline).toBeNull();
    queue.join(uid(3), nick(3), T0 + 3);
    queue.settle(T0 + 3);
    expect(queue.deadline).toBe(T0 + 3 + RULE.waitMs);
    queue.join(uid(4), nick(4), T0 + 4);
    queue.settle(T0 + 4);
    expect(queue.deadline).toBe(T0 + 3 + RULE.waitMs);
  });

  it('matches everyone waiting when the deadline passes', () => {
    const queue = queueOf(4);
    expect(queue.settle(queue.deadline! - 1)).toEqual([]);
    const matched = queue.settle(queue.deadline!);
    expect(ids(matched)).toEqual([1, 2, 3, 4].map(uid));
    expect(queue.statusOf(uid(1)).waitingCount).toBe(4);
    expect(queue.deadline).toBeNull();
  });

  it('matches the first target players at once', () => {
    const queue = queueOf(5);
    queue.join(uid(6), nick(6), T0 + 6);
    expect(ids(queue.settle(T0 + 6))).toEqual([1, 2, 3, 4, 5, 6].map(uid));
  });

  it('clears the deadline when the queue drops below min', () => {
    const queue = queueOf(3);
    queue.remove(uid(2));
    expect(queue.settle(T0 + 10)).toEqual([]);
    expect(queue.deadline).toBeNull();
  });

  it('keeps the place of someone who joins again', () => {
    const queue = queueOf(2);
    queue.join(uid(1), nick(1), T0 + 50);
    expect(ids(queue.waiting)).toEqual([uid(1), uid(2)]);
    expect(queue.waiting[0]!.enqueuedAt).toBe(T0 + 1);
  });

  it('neither counts nor matches disconnected players', () => {
    const queue = queueOf(4);
    queue.setConnected(uid(2), false);
    expect(queue.statusOf(uid(1))).toEqual({ locale: Locale.Ko, waitingCount: 3, startsAt: T0 + 3 + RULE.waitMs, minCount: RULE.min, waitMs: RULE.waitMs, ready: null });
    expect(ids(queue.settle(queue.deadline!))).toEqual([1, 3, 4].map(uid));
    expect(queue.has(uid(2))).toBe(true);
  });
});

describe('MatchQueue seats', () => {
  it('is joinable until target players are in', () => {
    const queue = queueOf(5);
    expect(queue.isJoinable).toBe(true);
    queue.join(uid(6), nick(6), T0 + 6);
    expect(queue.isJoinable).toBe(false);
  });

  it('hands over the longest waiter and takes one in by place in line', () => {
    const queue = queueOf(3);
    const other = queueOf(2);
    const entry = queue.take()!;
    expect(entry.userId).toBe(uid(1));
    expect(queue.has(uid(1))).toBe(false);
    other.add({ ...entry, enqueuedAt: T0 + 99 });
    expect(ids(other.waiting)).toEqual([1, 2, 1].map(uid));
    expect(other.has(uid(1))).toBe(true);
  });

  it('takes nobody from an empty queue', () => {
    expect(queueOf(0).take()).toBeUndefined();
    expect(queueOf(0).isEmpty).toBe(true);
  });
});

describe('MatchQueue accept step', () => {
  /** Users 1..count matched at `T0 + 100`, so the accept step ends at `T0 + 100 + acceptMs`. */
  function matchedQueue(count: number): MatchQueue {
    const queue = queueOf(count);
    queue.settle(queue.deadline ?? T0 + 100);
    return queue;
  }
  const NOW = T0 + 100;

  it('keeps the matched in the queue and tells each their step', () => {
    const queue = queueOf(3);
    const matched = queue.settle(queue.deadline!);
    expect(ids(matched)).toEqual([1, 2, 3].map(uid));
    expect(queue.has(uid(1))).toBe(true);
    const endsAt = queue.readyEndsAt!;
    expect(endsAt).toBe(T0 + 3 + RULE.waitMs + RULE.acceptMs);
    expect(queue.statusOf(uid(1)).ready).toEqual({ endsAt, acceptMs: RULE.acceptMs, isAccepted: false });
    queue.accept(uid(1));
    expect(queue.statusOf(uid(1)).ready?.isAccepted).toBe(true);
    expect(queue.statusOf(uid(2)).ready?.isAccepted).toBe(false);
  });

  it('matches nobody else while the step runs and takes no newcomers', () => {
    const queue = matchedQueue(3);
    expect(queue.isJoinable).toBe(false);
    expect(queue.settle(NOW + 10)).toEqual([]);
  });

  it('is complete once everyone present accepted', () => {
    const queue = matchedQueue(3);
    expect(queue.isCheckComplete).toBe(false);
    queue.accept(uid(1));
    queue.accept(uid(2));
    expect(queue.isCheckComplete).toBe(false);
    queue.remove(uid(3));
    expect(queue.isCheckComplete).toBe(true);
  });

  it('resolve takes out those who did not accept or lost connection', () => {
    const queue = matchedQueue(4);
    queue.accept(uid(1));
    queue.accept(uid(2));
    queue.accept(uid(3));
    queue.setConnected(uid(3), false);
    const { accepted, declined } = queue.resolve();
    expect(ids(accepted)).toEqual([uid(1), uid(2)]);
    expect(ids(declined)).toEqual([uid(3), uid(4)]);
    expect(queue.has(uid(3))).toBe(false);
    expect(queue.has(uid(4))).toBe(false);
    expect(queue.readyEndsAt).toBeNull();
  });

  it('puts those who stay back in the waiting pool after resolve', () => {
    const queue = matchedQueue(3);
    queue.accept(uid(1));
    queue.resolve();
    expect(ids(queue.waiting)).toEqual([uid(1)]);
    expect(queue.statusOf(uid(1)).ready).toBeNull();
  });
});

describe('createMatchRule', () => {
  const players = { minPlayers: 3, maxPlayers: 10 };

  it('accepts a rule a game can start with', () => {
    expect(createMatchRule(RULE, players)).toBe(RULE);
  });

  it('refuses a rule outside the player limits', () => {
    expect(() => createMatchRule({ ...RULE, min: 2 }, players)).toThrow();
    expect(() => createMatchRule({ ...RULE, target: 11 }, players)).toThrow();
    expect(() => createMatchRule({ ...RULE, min: 7 }, players)).toThrow();
  });
});

describe('pushDueAt', () => {
  const rule = { waitMs: 5_000, cooldownMs: 300_000 };

  it('is due once the longest waiter has waited', () => {
    expect(pushDueAt(rule, null, null)).toBeNull();
    expect(pushDueAt(rule, T0, null)).toBe(T0 + 5_000);
  });

  it('waits out the cooldown since the last push', () => {
    expect(pushDueAt(rule, T0, T0 - 1_000)).toBe(T0 - 1_000 + 300_000);
    expect(pushDueAt(rule, T0, T0 - 400_000)).toBe(T0 + 5_000);
  });
});
