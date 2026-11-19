import type { UserId } from '../../../../shared/domain/user-id.js';

/** The single player with the most votes; null on a tie or when nobody voted. */
export function accusedBy(votes: ReadonlyMap<UserId, UserId>): UserId | null {
  const counts = new Map<UserId, number>();
  for (const target of votes.values()) {
    counts.set(target, (counts.get(target) ?? 0) + 1);
  }
  let accused: UserId | null = null;
  let top = 0;
  for (const [target, count] of counts) {
    if (count > top) {
      accused = target;
      top = count;
    } else if (count === top) {
      accused = null;
    }
  }
  return accused;
}
