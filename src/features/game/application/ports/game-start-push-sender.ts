import type { Locale } from '../../../../shared/domain/locale.js';

export interface GameStartPushSender {
  /** Tells these devices their game has started. Never throws: a failed push only gets logged. */
  notifyGameStarted(locale: Locale, tokens: readonly string[]): void;
  /** Tells these devices a quick-start match was found and awaits their accept. Never throws. */
  notifyMatchFound(locale: Locale, tokens: readonly string[]): void;
}
