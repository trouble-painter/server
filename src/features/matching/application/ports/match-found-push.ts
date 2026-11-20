import type { Locale } from '../../../../shared/domain/locale.js';
import type { UserId } from '../../../../shared/domain/user-id.js';

export interface MatchFoundPush {
  /** Tells these users a match was found and they must accept; users without a push token are skipped. */
  notifyMatchFound(locale: Locale, userIds: readonly UserId[]): void;
}
