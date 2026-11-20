import type { BaseLogger } from 'pino';
import type { Locale } from '../../../shared/domain/locale.js';
import type { GameStartPushSender } from '../../game/application/ports/game-start-push-sender.js';
import type { Nickname } from '../../game/domain/nickname.js';
import type { PushNotifier } from '../application/ports/push-notifier.js';

/** Stands in for FCM when pushes are turned off: records what would have been sent. */
export class LogPushNotifier implements PushNotifier, GameStartPushSender {
  constructor(private readonly logger: Pick<BaseLogger, 'info'>) {}

  notifyQuickStart(locale: Locale, nickname: Nickname): void {
    this.logger.info({ locale, nickname }, 'quick-start push skipped (PUSH_ENABLED=false)');
  }

  notifyGameStarted(locale: Locale, tokens: readonly string[]): void {
    this.logger.info({ locale, count: tokens.length }, 'game-start push skipped (PUSH_ENABLED=false)');
  }

  notifyMatchFound(locale: Locale, tokens: readonly string[]): void {
    this.logger.info({ locale, count: tokens.length }, 'match-found push skipped (PUSH_ENABLED=false)');
  }
}
