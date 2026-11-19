import type { Locale } from '../../../../shared/domain/locale.js';

export interface GameStartPushSender {
  /** Tells these devices their game has started. Never throws: a failed push only gets logged. */
  notifyGameStarted(locale: Locale, tokens: readonly string[]): void;
}
