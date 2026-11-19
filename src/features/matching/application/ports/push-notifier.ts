import type { Locale } from '../../../../shared/domain/locale.js';
import type { Nickname } from '../../../game/domain/nickname.js';

export interface PushNotifier {
  /** Tells the locale's players someone is waiting. Never throws: a failed push only gets logged. */
  notifyQuickStart(locale: Locale, nickname: Nickname): void;
}
