import type { BaseLogger } from 'pino';
import type { Locale } from '../../../shared/domain/locale.js';
import type { Nickname } from '../../game/domain/nickname.js';
import type { PushNotifier } from '../application/ports/push-notifier.js';

/** Stands in for FCM when pushes are turned off: records what would have been sent. */
export class LogPushNotifier implements PushNotifier {
  constructor(private readonly logger: Pick<BaseLogger, 'info'>) {}

  notifyQuickStart(locale: Locale, nickname: Nickname): void {
    this.logger.info({ locale, nickname }, 'quick-start push skipped (PUSH_ENABLED=false)');
  }
}
