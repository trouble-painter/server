import type { Locale } from '../../../shared/domain/locale.js';
import type { UserId } from '../../../shared/domain/user-id.js';
import type { Nickname } from '../../game/domain/nickname.js';

/**
 * Once `min` players are waiting, wait `waitMs` more for others; `target` players match at once.
 * Matched players then have `acceptMs` to accept before the game starts.
 */
export interface MatchRule {
  readonly min: number;
  readonly target: number;
  readonly waitMs: number;
  readonly acceptMs: number;
}

/** Checks the rule against the game's player limits; a rule that could never start a game fails at boot. */
export function createMatchRule(rule: MatchRule, players: { minPlayers: number; maxPlayers: number }): MatchRule {
  if (rule.min < players.minPlayers || rule.target > players.maxPlayers || rule.min > rule.target) {
    throw new Error(
      `match rule needs ${players.minPlayers} <= min (${rule.min}) <= target (${rule.target}) <= ${players.maxPlayers}`,
    );
  }
  return rule;
}

export interface QueueEntry {
  readonly userId: UserId;
  readonly nickname: Nickname;
  readonly enqueuedAt: number;
  isConnected: boolean;
}

/** A matched user's accept step; the others in the queue have none. */
export interface ReadyStatus {
  /** When the accept step ends. */
  readonly endsAt: number;
  /** How long the accept step runs. */
  readonly acceptMs: number;
  readonly isAccepted: boolean;
}

/** What a queued user is told about their own queue; players who lost connection do not count. */
export interface MatchingStatus {
  readonly locale: Locale;
  /** Connected players in the user's queue, the user included. */
  readonly waitingCount: number;
  /** When the waiting players will be matched; null until `min` are waiting. */
  readonly startsAt: number | null;
  /** How many must wait before the countdown to `startsAt` runs */
  readonly minCount: number;
  /** How long the countdown to `startsAt` runs once `min` are waiting */
  readonly waitMs: number;
  /** Null unless this user was matched and has yet to be started or sent back. */
  readonly ready: ReadyStatus | null;
}

/** Matched players who have not started a game yet; they stay in the queue until it resolves. */
interface ReadyCheck {
  readonly endsAt: number;
  readonly members: ReadonlySet<UserId>;
  readonly accepted: Set<UserId>;
}

/**
 * One quick-start queue: up to `target` players of a locale who become one game. A locale has
 * many queues side by side, so a full or matched queue never holds up the people behind it.
 */
export class MatchQueue {
  readonly #entries: QueueEntry[] = [];
  #deadline: number | null = null;
  #check: ReadyCheck | null = null;

  constructor(
    readonly id: string,
    readonly locale: Locale,
    private readonly rule: MatchRule,
  ) {}

  /** True while players can be added: not in an accept step and not full. */
  get isJoinable(): boolean {
    return this.#check === null && this.#entries.length < this.rule.target;
  }

  get isEmpty(): boolean {
    return this.#entries.length === 0;
  }

  /** When the waiting players are matched even if fewer than `target`; null below `min`. */
  get deadline(): number | null {
    return this.#deadline;
  }

  /** When the current accept step ends; null when there is none. */
  get readyEndsAt(): number | null {
    return this.#check?.endsAt ?? null;
  }

  /** True while an accept step runs. */
  get isChecking(): boolean {
    return this.#check !== null;
  }

  /** True when an accept step runs and fewer than `min` of its members are still connected in the queue. */
  get isCheckShort(): boolean {
    const check = this.#check;
    if (check === null) {
      return false;
    }
    return [...check.members].filter((id) => this.#find(id)?.isConnected === true).length < this.rule.min;
  }

  /** True once everyone still in the accept step has accepted. */
  get isCheckComplete(): boolean {
    const check = this.#check;
    if (check === null) {
      return false;
    }
    return [...check.members].filter((id) => this.has(id)).every((id) => check.accepted.has(id));
  }

  statusOf(userId: UserId): MatchingStatus {
    const check = this.#check;
    return {
      locale: this.locale,
      waitingCount: this.connected.length,
      startsAt: this.#deadline,
      minCount: this.rule.min,
      waitMs: this.rule.waitMs,
      ready:
        check?.members.has(userId) === true
          ? { endsAt: check.endsAt, acceptMs: this.rule.acceptMs, isAccepted: check.accepted.has(userId) }
          : null,
    };
  }

  /** The connected players still waiting for a match, earliest first. */
  get waiting(): readonly Readonly<QueueEntry>[] {
    return this.#waiting();
  }

  /** Everyone connected, those in the accept step included, earliest first. */
  get connected(): readonly Readonly<QueueEntry>[] {
    return this.#entries.filter((e) => e.isConnected);
  }

  has(userId: UserId): boolean {
    return this.#find(userId) !== undefined;
  }

  /** Someone already queued keeps their place. */
  join(userId: UserId, nickname: Nickname, now: number): void {
    const entry = this.#find(userId);
    if (entry === undefined) {
      this.#entries.push({ userId, nickname, enqueuedAt: now, isConnected: true });
    } else {
      entry.isConnected = true;
    }
  }

  /** Moves in someone from another queue, keeping their place in line. */
  add(entry: QueueEntry): void {
    this.#entries.push(entry);
    this.#entries.sort((a, b) => a.enqueuedAt - b.enqueuedAt);
  }

  /** Keeps a countdown that already ran for players who moved in, so it is not restarted. */
  inheritDeadline(deadline: number | null): void {
    if (deadline !== null && this.#check === null && this.#waiting().length >= this.rule.min) {
      this.#deadline = Math.min(this.#deadline ?? deadline, deadline);
    }
  }

  /** Hands over the connected player who has waited longest, or undefined when there is none. */
  take(): QueueEntry | undefined {
    const entry = this.#waiting()[0];
    if (entry !== undefined) {
      this.remove(entry.userId);
    }
    return entry;
  }

  remove(userId: UserId): void {
    const index = this.#entries.findIndex((e) => e.userId === userId);
    if (index >= 0) {
      this.#entries.splice(index, 1);
    }
  }

  setConnected(userId: UserId, isConnected: boolean): void {
    const entry = this.#find(userId);
    if (entry !== undefined) {
      entry.isConnected = isConnected;
    }
  }

  /**
   * Call after every change and when the deadline passes. Returns the players matched now, who
   * start their accept step and stay in the queue, or an empty list; also sets or clears the
   * deadline. Nobody else is matched while an accept step runs.
   */
  settle(now: number): QueueEntry[] {
    if (this.#check !== null) {
      return [];
    }
    const waiting = this.#waiting();
    if (waiting.length < this.rule.min) {
      this.#deadline = null;
      return [];
    }
    if (waiting.length < this.rule.target) {
      this.#deadline ??= now + this.rule.waitMs;
      if (now < this.#deadline) {
        return [];
      }
    }
    const matched = waiting.slice(0, this.rule.target);
    this.#check = {
      endsAt: now + this.rule.acceptMs,
      members: new Set(matched.map((e) => e.userId)),
      accepted: new Set(),
    };
    this.#deadline = null;
    return matched;
  }

  /** Does nothing for someone who is not in the accept step. */
  accept(userId: UserId): void {
    if (this.#check?.members.has(userId) === true) {
      this.#check.accepted.add(userId);
    }
  }

  /** Ends the accept step without a game: everyone in it, accepted or not, waits again as before. */
  abort(): void {
    this.#check = null;
  }

  /**
   * Ends the accept step. `accepted` stay in the queue for the caller to start or requeue;
   * `declined` (not accepted, or no longer connected) are taken out.
   */
  resolve(): { accepted: QueueEntry[]; declined: QueueEntry[] } {
    const check = this.#check;
    this.#check = null;
    if (check === null) {
      return { accepted: [], declined: [] };
    }
    const entries = [...check.members].flatMap((id) => this.#find(id) ?? []);
    const accepted = entries.filter((e) => check.accepted.has(e.userId) && e.isConnected);
    const declined = entries.filter((e) => !accepted.includes(e));
    for (const entry of declined) {
      this.remove(entry.userId);
    }
    return { accepted, declined };
  }

  #waiting(): QueueEntry[] {
    const inCheck = this.#check?.members;
    return this.#entries.filter((e) => e.isConnected && inCheck?.has(e.userId) !== true);
  }

  #find(userId: UserId): QueueEntry | undefined {
    return this.#entries.find((e) => e.userId === userId);
  }
}
