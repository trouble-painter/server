import { describe, expect, it } from 'vitest';
import type { Nickname } from '../../../../src/features/game/domain/nickname.js';
import { createMatchRule, MatchQueue, type MatchRule } from '../../../../src/features/matching/domain/match-queue.js';
import { pushDueAt } from '../../../../src/features/matching/domain/push-rule.js';
import { Locale } from '../../../../src/shared/domain/locale.js';
import type { UserId } from '../../../../src/shared/domain/user-id.js';

const RULE: MatchRule = { min: 3, target: 6, waitMs: 10_000 };
const T0 = 1_000_000;
const uid = (n: number) => n as UserId;
const nick = (n: number) => `P${n}` as Nickname;

/** A queue with users 1..count joined one millisecond apart, settled after each join. */
function queueOf(count: number): MatchQueue {
  const queue = new MatchQueue(Locale.Ko, RULE);
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
    expect(queue.status.waitingCount).toBe(0);
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
    expect(queue.status).toEqual({ locale: Locale.Ko, waitingCount: 3, startsAt: T0 + 3 + RULE.waitMs, minCount: RULE.min, waitMs: RULE.waitMs });
    expect(ids(queue.settle(queue.deadline!))).toEqual([1, 3, 4].map(uid));
    expect(queue.has(uid(2))).toBe(true);
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
