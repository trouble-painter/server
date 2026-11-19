export interface PushRule {
  /** How long someone waits unmatched before the locale is notified. */
  readonly waitMs: number;
  /** Least time between two notifications of the same locale. */
  readonly cooldownMs: number;
}

/**
 * When the locale should be notified next: once the longest waiter has waited `waitMs` and the
 * cooldown since the last notification has passed. Null when nobody is waiting.
 */
export function pushDueAt(rule: PushRule, oldestWaitingSince: number | null, lastSentAt: number | null): number | null {
  if (oldestWaitingSince === null) {
    return null;
  }
  const waited = oldestWaitingSince + rule.waitMs;
  return lastSentAt === null ? waited : Math.max(waited, lastSentAt + rule.cooldownMs);
}
