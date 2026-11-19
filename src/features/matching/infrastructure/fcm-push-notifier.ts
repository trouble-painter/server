import { cert, deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getMessaging, type Messaging } from 'firebase-admin/messaging';
import type { BaseLogger } from 'pino';
import { localeToWire } from '../../../shared/adapters/ws/protocol.js';
import type { Locale } from '../../../shared/domain/locale.js';
import type { Nickname } from '../../game/domain/nickname.js';
import type { PushNotifier } from '../application/ports/push-notifier.js';

/** The push contract with the app (protocol.md 8). */
const QUICK_START_TOPIC_PREFIX = 'QUICK_START_';
const QUICK_START_DATA_TYPE = 'QUICK_START';
const NICKNAME_PLACEHOLDER = '{nickname}';

export interface PushText {
  readonly title: string;
  /** `{nickname}` becomes the nickname of whoever has waited longest. */
  readonly body: string;
}

type Logger = Pick<BaseLogger, 'info' | 'warn'>;

/** Sends to the locale's topic through Firebase Cloud Messaging. */
export class FcmPushNotifier implements PushNotifier {
  private constructor(
    private readonly app: App,
    private readonly messaging: Messaging,
    private readonly texts: Readonly<Record<Locale, PushText>>,
    private readonly logger: Logger,
  ) {}

  /** Reads the service account key now, so a missing or broken key fails the boot. */
  static create(credentialsPath: string, texts: Readonly<Record<Locale, PushText>>, logger: Logger): FcmPushNotifier {
    const app = initializeApp({ credential: cert(credentialsPath) }, 'push');
    return new FcmPushNotifier(app, getMessaging(app), texts, logger);
  }

  notifyQuickStart(locale: Locale, nickname: Nickname): void {
    const wireLocale = localeToWire(locale);
    const text = this.texts[locale];
    const topic = `${QUICK_START_TOPIC_PREFIX}${wireLocale}`;
    this.messaging
      .send({
        topic,
        notification: { title: text.title, body: text.body.replaceAll(NICKNAME_PLACEHOLDER, nickname) },
        data: { type: QUICK_START_DATA_TYPE, locale: wireLocale },
      })
      .then(
        () => this.logger.info({ topic }, 'quick-start push sent'),
        (error: unknown) => this.logger.warn({ err: error, topic }, 'quick-start push failed'),
      );
  }

  async close(): Promise<void> {
    await deleteApp(this.app);
  }
}
