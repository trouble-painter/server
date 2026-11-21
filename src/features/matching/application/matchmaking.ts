import type { Clock } from '../../../shared/application/ports/clock.js';
import type { Scheduler } from '../../../shared/application/ports/scheduler.js';
import type { Locale } from '../../../shared/domain/locale.js';
import type { UserId } from '../../../shared/domain/user-id.js';
import type { Nickname } from '../../game/domain/nickname.js';
import { MatchQueue, type MatchingStatus, type MatchRule, type QueueEntry } from '../domain/match-queue.js';
import { pushDueAt, type PushRule } from '../domain/push-rule.js';
import type { MatchFoundPush } from './ports/match-found-push.js';
import type { MatchingPublisher } from './ports/matching-publisher.js';
import type { PushNotifier } from './ports/push-notifier.js';
import type { QuickStartRooms } from './ports/quick-start-rooms.js';
import type { RoomMembership } from './ports/room-membership.js';

/** Scheduler key of the timer that matches a queue when its deadline passes. */
export function matchDeadlineKey(queueId: string): string {
  return `match:${queueId}`;
}

/** Scheduler key of the timer that ends a queue's accept step. */
export function readyKey(queueId: string): string {
  return `ready:${queueId}`;
}

/** Scheduler key of the timer that sends a locale's waiting push. */
export function pushKey(locale: Locale): string {
  return `push:${locale}`;
}

/** Scheduler key of the timer that drops a disconnected user from the queue. */
export function queueLeaveKey(userId: UserId): string {
  return `queue-leave:${userId}`;
}

/**
 * The quick-start queues, kept in memory only: losing them on a restart costs a few seconds of
 * waiting. A locale has as many queues as it needs, oldest first; each runs its own timers.
 */
export class Matchmaking {
  readonly #queues = new Map<Locale, MatchQueue[]>();
  readonly #queueOfUser = new Map<UserId, MatchQueue>();
  readonly #lastPushAt = new Map<Locale, number>();
  #queueCount = 0;

  constructor(
    private readonly rule: MatchRule,
    private readonly pushRule: PushRule,
    private readonly disconnectGraceMs: number,
    private readonly rooms: RoomMembership,
    private readonly quickStart: QuickStartRooms,
    private readonly publisher: MatchingPublisher,
    private readonly notifier: PushNotifier,
    private readonly matchFoundPush: MatchFoundPush,
    private readonly scheduler: Scheduler,
    private readonly clock: Clock,
  ) {}

  /**
   * Leaves a waiting room or another locale's queue first; someone already in a queue of this
   * locale keeps their place. A newcomer goes to the oldest queue that is waiting and not full,
   * or to a new one. Returns the requester's status; a user matched at once is in the accept step.
   */
  join(userId: UserId, nickname: Nickname, locale: Locale): MatchingStatus {
    this.rooms.release(userId);
    let queue = this.#queueOf(userId);
    if (queue !== undefined && queue.locale !== locale) {
      this.release(userId);
      queue = undefined;
    }
    this.scheduler.cancel(queueLeaveKey(userId));
    queue ??= this.#openQueue(locale);
    queue.join(userId, nickname, this.clock.now());
    this.#queueOfUser.set(userId, queue);
    this.#changed(queue, userId);
    return this.#statusOf(userId);
  }

  /**
   * Takes the user's accept; the game starts as soon as everyone matched with them has accepted.
   * Returns their status, or null when they are not queued or the game has started (they got the room).
   */
  accept(userId: UserId): MatchingStatus | null {
    const queue = this.#queueOf(userId);
    if (queue === undefined) {
      return null;
    }
    queue.accept(userId);
    if (queue.isCheckComplete) {
      this.#finishCheck(queue);
      this.#broadcast(queue, userId);
      this.#rebalance(queue.locale);
    }
    return this.#queueOf(userId) === undefined ? null : this.#statusOf(userId);
  }

  /** Does nothing when the user is not queued, so a cancel that crosses a match or a restart is harmless. */
  release(userId: UserId): void {
    const queue = this.#queueOf(userId);
    if (queue === undefined) {
      return;
    }
    this.scheduler.cancel(queueLeaveKey(userId));
    queue.remove(userId);
    this.#queueOfUser.delete(userId);
    this.#changed(queue);
  }

  /** The status for HELLO; null when the user is not queued. */
  connect(userId: UserId): MatchingStatus | null {
    const queue = this.#queueOf(userId);
    if (queue === undefined) {
      return null;
    }
    this.scheduler.cancel(queueLeaveKey(userId));
    queue.setConnected(userId, true);
    this.#broadcast(queue, userId);
    this.#syncPush(queue.locale);
    // The comeback may complete a match; run it once HELLO has gone out.
    this.scheduler.schedule(matchDeadlineKey(queue.id), 0, () => this.#matchAndTell(queue));
    return queue.statusOf(userId);
  }

  /** A disconnected user stops counting at once and leaves the queue unless back within the grace period. */
  disconnect(userId: UserId): void {
    const queue = this.#queueOf(userId);
    if (queue === undefined) {
      return;
    }
    queue.setConnected(userId, false);
    this.#changed(queue);
    this.scheduler.schedule(queueLeaveKey(userId), this.disconnectGraceMs, () => this.release(userId));
  }

  /**
   * Tells everyone in the queue the new count; `except` gets its own reply. An accept step left
   * with fewer than `min` members is called off and its members wait again. Empty places are
   * then filled from the newer queues.
   */
  #changed(queue: MatchQueue, except?: UserId): void {
    if (queue.isCheckShort) {
      queue.abort();
    }
    if (queue.isCheckComplete) {
      this.#finishCheck(queue);
    } else {
      this.#match(queue);
    }
    this.#broadcast(queue, except);
    this.#rebalance(queue.locale);
  }

  /** Tells the queue only when its status moved: someone matched, or the start time was set or cleared. */
  #matchAndTell(queue: MatchQueue): void {
    const startsAt = queue.deadline;
    if (this.#match(queue) || queue.deadline !== startsAt) {
      this.#broadcast(queue);
    }
  }

  /** Starts the accept step for whoever is matched now and re-arms the queue's timers. */
  #match(queue: MatchQueue): boolean {
    const matched = queue.settle(this.clock.now());
    if (matched.length > 0) {
      this.matchFoundPush.notifyMatchFound(
        queue.locale,
        matched.map((e) => e.userId),
      );
    }
    this.#syncDeadline(queue);
    this.#syncReady(queue);
    this.#syncPush(queue.locale);
    return matched.length > 0;
  }

  /**
   * Ends the accept step. Those who did not accept leave the queue; the rest start a game when
   * `min` of them accepted, and otherwise wait on in the queue.
   */
  #finishCheck(queue: MatchQueue): void {
    this.scheduler.cancel(readyKey(queue.id));
    const { accepted, declined } = queue.resolve();
    for (const entry of declined) {
      this.scheduler.cancel(queueLeaveKey(entry.userId));
      this.#queueOfUser.delete(entry.userId);
      this.publisher.declined(entry.userId);
    }
    if (accepted.length >= this.rule.min) {
      for (const entry of accepted) {
        queue.remove(entry.userId);
        this.#queueOfUser.delete(entry.userId);
      }
      this.quickStart.start(queue.locale, accepted);
    }
    this.#match(queue);
  }

  /**
   * Fills the places of each waiting queue, oldest first, with the longest waiters of the newest
   * queues behind it, so older queues start first; a countdown that ran on carries over. Then
   * drops queues left empty.
   */
  #rebalance(locale: Locale): void {
    const queues = this.#queues.get(locale);
    if (queues === undefined) {
      return;
    }
    const touched = new Set<MatchQueue>();
    for (const [index, receiver] of queues.entries()) {
      let countdown: number | null = null;
      while (receiver.isJoinable) {
        const donor = queues.slice(index + 1).findLast((q) => !q.isChecking && q.waiting.length > 0);
        const donorDeadline = donor?.deadline ?? null;
        const entry = donor?.take();
        if (donor === undefined || entry === undefined) {
          break;
        }
        receiver.add(entry);
        this.#queueOfUser.set(entry.userId, receiver);
        touched.add(receiver).add(donor);
        if (donorDeadline !== null) {
          countdown = Math.min(countdown ?? donorDeadline, donorDeadline);
        }
      }
      // Players who already counted down keep that time instead of starting over.
      receiver.inheritDeadline(countdown);
    }
    for (const queue of touched) {
      this.#match(queue);
      this.#broadcast(queue);
    }
    this.#prune(locale);
  }

  #prune(locale: Locale): void {
    const queues = this.#queues.get(locale);
    if (queues === undefined) {
      return;
    }
    const alive = queues.filter((queue) => {
      if (!queue.isEmpty || queue.isChecking) {
        return true;
      }
      this.scheduler.cancel(matchDeadlineKey(queue.id));
      this.scheduler.cancel(readyKey(queue.id));
      return false;
    });
    if (alive.length > 0) {
      this.#queues.set(locale, alive);
    } else {
      this.#queues.delete(locale);
    }
  }

  #broadcast(queue: MatchQueue, except?: UserId): void {
    for (const entry of queue.connected) {
      if (entry.userId !== except) {
        this.publisher.send(entry.userId, queue.statusOf(entry.userId));
      }
    }
  }

  #syncReady(queue: MatchQueue): void {
    const key = readyKey(queue.id);
    const endsAt = queue.readyEndsAt;
    if (endsAt === null) {
      this.scheduler.cancel(key);
      return;
    }
    this.scheduler.schedule(key, Math.max(0, endsAt - this.clock.now()), () => {
      this.#finishCheck(queue);
      this.#broadcast(queue);
      this.#rebalance(queue.locale);
    });
  }

  #syncDeadline(queue: MatchQueue): void {
    const key = matchDeadlineKey(queue.id);
    const deadline = queue.deadline;
    if (deadline === null) {
      this.scheduler.cancel(key);
      return;
    }
    this.scheduler.schedule(key, Math.max(0, deadline - this.clock.now()), () => this.#matchAndTell(queue));
  }

  #syncPush(locale: Locale): void {
    const key = pushKey(locale);
    const dueAt = this.#pushDueAt(locale);
    if (dueAt === null) {
      this.scheduler.cancel(key);
      return;
    }
    this.scheduler.schedule(key, Math.max(0, dueAt - this.clock.now()), () => this.#push(locale));
  }

  #push(locale: Locale): void {
    const oldest = this.#oldestWaiting(locale);
    const dueAt = this.#pushDueAt(locale);
    const now = this.clock.now();
    if (oldest !== undefined && dueAt !== null && now >= dueAt) {
      this.notifier.notifyQuickStart(locale, oldest.nickname);
      this.#lastPushAt.set(locale, now);
    }
    this.#syncPush(locale);
  }

  #pushDueAt(locale: Locale): number | null {
    const oldest = this.#oldestWaiting(locale);
    return pushDueAt(this.pushRule, oldest?.enqueuedAt ?? null, this.#lastPushAt.get(locale) ?? null);
  }

  /** The connected player of the locale who has waited longest, in any queue still waiting. */
  #oldestWaiting(locale: Locale): Readonly<QueueEntry> | undefined {
    let oldest: Readonly<QueueEntry> | undefined;
    for (const queue of this.#queues.get(locale) ?? []) {
      const first = queue.waiting[0];
      if (first !== undefined && (oldest === undefined || first.enqueuedAt < oldest.enqueuedAt)) {
        oldest = first;
      }
    }
    return oldest;
  }

  /** The oldest queue of the locale that is waiting and not full, or a new one. */
  #openQueue(locale: Locale): MatchQueue {
    const queues = this.#queues.get(locale) ?? [];
    const open = queues.find((queue) => queue.isJoinable);
    if (open !== undefined) {
      return open;
    }
    const queue = new MatchQueue(`${locale}:${++this.#queueCount}`, locale, this.rule);
    queues.push(queue);
    this.#queues.set(locale, queues);
    return queue;
  }

  #queueOf(userId: UserId): MatchQueue | undefined {
    return this.#queueOfUser.get(userId);
  }

  #statusOf(userId: UserId): MatchingStatus {
    const queue = this.#queueOf(userId);
    if (queue === undefined) {
      throw new Error(`user ${userId} is not queued`);
    }
    return queue.statusOf(userId);
  }
}
