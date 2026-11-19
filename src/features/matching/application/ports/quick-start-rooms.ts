import type { Locale } from '../../../../shared/domain/locale.js';
import type { UserId } from '../../../../shared/domain/user-id.js';
import type { Nickname } from '../../../game/domain/nickname.js';

export interface QuickStartRooms {
  /** Opens a quick-start room for the matched players, earliest first, and starts its game. */
  start(locale: Locale, players: readonly { userId: UserId; nickname: Nickname }[]): void;
}
