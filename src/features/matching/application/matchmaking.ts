import type { Clock } from '../../../shared/application/ports/clock.js';
import type { Scheduler } from '../../../shared/application/ports/scheduler.js';
import type { Locale } from '../../../shared/domain/locale.js';
import type { UserId } from '../../../shared/domain/user-id.js';
import type { Nickname } from '../../game/domain/nickname.js';
import { MatchQueue, type MatchingStatus, type MatchRule } from '../domain/match-queue.js';
import { pushDueAt, type PushRule } from '../domain/push-rule.js';
import type { MatchFoundPush } from './ports/match-found-push.js';
import type { MatchingPublisher } from './ports/matching-publisher.js';
import type { PushNotifier } from './ports/push-notifier.js';
import type { QuickStartRooms } from './ports/quick-start-rooms.js';
import type { RoomMembership } from './ports/room-membership.js';

/** Scheduler key of the timer that matches a locale's queue when its deadline passes. */
export function matchDeadlineKey(locale: Locale): string {
  return `match:${locale}`;
}

/** Scheduler key of the timer that ends a locale's accept step. */
export function readyKey(locale: Locale): string {
  return `ready:${locale}`;
}

/** Scheduler key of the timer that sends a locale's waiting push. */
export function pushKey(locale: Locale): string {
  return `push:${locale}`;
}

/** Scheduler key of the timer that drops a disconnected user from the queue. */
export function queueLeaveKey(userId: UserId): string {
  return `queue-leave:${userId}`;
}

/** The quick-start queues, kept in memory only: losing them on a restart costs a few seconds of waiting. */
export class Matchmaking {
  readonly #queues = new Map<Locale, MatchQueue>();
  readonly #lastPushAt = new Map<Locale, number>();

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
   * Leaves a waiting room or another locale's queue first; someone already in this queue keeps
   * their place. Returns the requester's status; a user matched at once is in the accept step.
   */
  join(userId: UserId, nickname: Nickname, locale: Locale): MatchingStatus {
    this.rooms.release(userId);
    const current = this.#queueOf(userId);
    if (current !== undefined && current.locale !== locale) {
      this.release(userId);
    }
    this.scheduler.cancel(queueLeaveKey(userId));
    const queue = this.#queue(locale);
    queue.join(userId, nickname, this.clock.now());
    this.#changed(queue, userId);
    return queue.statusOf(userId);
  }

  /**
   * Takes the user's accept; the game starts as soon as everyone matched has accepted. Returns
   * their status, or null when they are not queued or the game has started (they got the room).
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
    }
    return queue.has(userId) ? queue.statusOf(userId) : null;
  }

  /** Does nothing when the user is not queued, so a cancel that crosses a match or a restart is harmless. */
  release(userId: UserId): void {
    const queue = this.#queueOf(userId);
    if (queue === undefined) {
      return;
    }
    this.scheduler.cancel(queueLeaveKey(userId));
    queue.remove(userId);
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
    this.#syncPush(queue);
    // The comeback may complete a match; run it once HELLO has gone out.
    this.scheduler.schedule(matchDeadlineKey(queue.locale), 0, () => this.#matchAndTell(queue));
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

  /** Tells everyone still waiting the new count; `except` gets its own reply. */
  #changed(queue: MatchQueue, except?: UserId): void {
    if (queue.isCheckComplete) {
      this.#finishCheck(queue);
    } else {
      this.#match(queue);
    }
    this.#broadcast(queue, except);
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
    this.#syncPush(queue);
    return matched.length > 0;
  }

  /**
   * Ends the accept step. Those who did not accept leave the queue; the rest start a game when
   * `min` of them accepted, and otherwise wait on in the queue.
   */
  #finishCheck(queue: MatchQueue): void {
    this.scheduler.cancel(readyKey(queue.locale));
    const { accepted, declined } = queue.resolve();
    for (const entry of declined) {
      this.scheduler.cancel(queueLeaveKey(entry.userId));
      this.publisher.declined(entry.userId);
    }
    if (accepted.length >= this.rule.min) {
      for (const entry of accepted) {
        queue.remove(entry.userId);
      }
      this.quickStart.start(queue.locale, accepted);
    }
    this.#match(queue);
  }

  #broadcast(queue: MatchQueue, except?: UserId): void {
    for (const entry of queue.connected) {
      if (entry.userId !== except) {
        this.publisher.send(entry.userId, queue.statusOf(entry.userId));
      }
    }
  }

  #syncReady(queue: MatchQueue): void {
    const key = readyKey(queue.locale);
    const endsAt = queue.readyEndsAt;
    if (endsAt === null) {
      this.scheduler.cancel(key);
      return;
    }
    this.scheduler.schedule(key, Math.max(0, endsAt - this.clock.now()), () => {
      this.#finishCheck(queue);
      this.#broadcast(queue);
    });
  }

  #syncDeadline(queue: MatchQueue): void {
    const key = matchDeadlineKey(queue.locale);
    const deadline = queue.deadline;
    if (deadline === null) {
      this.scheduler.cancel(key);
      return;
    }
    this.scheduler.schedule(key, Math.max(0, deadline - this.clock.now()), () => this.#matchAndTell(queue));
  }

  #syncPush(queue: MatchQueue): void {
    const key = pushKey(queue.locale);
    const dueAt = this.#pushDueAt(queue);
    if (dueAt === null) {
      this.scheduler.cancel(key);
      return;
    }
    this.scheduler.schedule(key, Math.max(0, dueAt - this.clock.now()), () => this.#push(queue));
  }

  #push(queue: MatchQueue): void {
    const oldest = queue.waiting[0];
    const dueAt = this.#pushDueAt(queue);
    const now = this.clock.now();
    if (oldest !== undefined && dueAt !== null && now >= dueAt) {
      this.notifier.notifyQuickStart(queue.locale, oldest.nickname);
      this.#lastPushAt.set(queue.locale, now);
    }
    this.#syncPush(queue);
  }

  #pushDueAt(queue: MatchQueue): number | null {
    const oldest = queue.waiting[0];
    return pushDueAt(this.pushRule, oldest?.enqueuedAt ?? null, this.#lastPushAt.get(queue.locale) ?? null);
  }

  #queue(locale: Locale): MatchQueue {
    let queue = this.#queues.get(locale);
    if (queue === undefined) {
      queue = new MatchQueue(locale, this.rule);
      this.#queues.set(locale, queue);
    }
    return queue;
  }

  #queueOf(userId: UserId): MatchQueue | undefined {
    for (const queue of this.#queues.values()) {
      if (queue.has(userId)) {
        return queue;
      }
    }
    return undefined;
  }
}
