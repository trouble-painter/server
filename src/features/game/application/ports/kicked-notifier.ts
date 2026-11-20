import type { UserId } from '../../../../shared/domain/user-id.js';

export interface KickedNotifier {
  /** Tells a user the host removed them from their room. */
  notify(userId: UserId): void;
}
