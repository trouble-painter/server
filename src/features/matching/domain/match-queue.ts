import type { Locale } from '../../../shared/domain/locale.js';
import type { UserId } from '../../../shared/domain/user-id.js';
import type { Nickname } from '../../game/domain/nickname.js';

/** Once `min` players are waiting, wait `waitMs` more for others; `target` players match at once. */
export interface MatchRule {
  readonly min: number;
  readonly target: number;
  readonly waitMs: number;
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

/** What a queued user is told: only connected players count as waiting. */
export interface MatchingStatus {
  readonly locale: Locale;
  readonly waitingCount: number;
}

/** The quick-start queue of one locale, in join order. */
export class MatchQueue {
  readonly #entries: QueueEntry[] = [];
  #deadline: number | null = null;

  constructor(
    readonly locale: Locale,
    private readonly rule: MatchRule,
  ) {}

  /** When the waiting players are matched even if fewer than `target`; null below `min`. */
  get deadline(): number | null {
    return this.#deadline;
  }

  get status(): MatchingStatus {
    return { locale: this.locale, waitingCount: this.#waiting().length };
  }

  /** The connected players, earliest first. */
  get waiting(): readonly Readonly<QueueEntry>[] {
    return this.#waiting();
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
   * Call after every change and when the deadline passes. Returns the players matched now, taken
   * out of the queue, or an empty list; also sets or clears the deadline.
   */
  settle(now: number): QueueEntry[] {
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
    for (const entry of matched) {
      this.remove(entry.userId);
    }
    this.#deadline = null;
    return matched;
  }

  #waiting(): QueueEntry[] {
    return this.#entries.filter((e) => e.isConnected);
  }

  #find(userId: UserId): QueueEntry | undefined {
    return this.#entries.find((e) => e.userId === userId);
  }
}
