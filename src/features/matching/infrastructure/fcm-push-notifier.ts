import { cert, deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getMessaging, type Messaging } from 'firebase-admin/messaging';
import type { BaseLogger } from 'pino';
import { localeToWire } from '../../../shared/adapters/ws/protocol.js';
import type { Locale } from '../../../shared/domain/locale.js';
import type { GameStartPushSender } from '../../game/application/ports/game-start-push-sender.js';
import type { Nickname } from '../../game/domain/nickname.js';
import type { PushNotifier } from '../application/ports/push-notifier.js';

/** The push contract with the app (protocol.md 8). */
const QUICK_START_TOPIC_PREFIX = 'QUICK_START_';
const NICKNAME_PLACEHOLDER = '{nickname}';

/** `data.type` of each push */
enum PushDataType {
  QuickStart = 'QUICK_START',
  GameStarted = 'GAME_STARTED',
}

export interface PushText {
  readonly title: string;
  /** In the quick-start push, `{nickname}` becomes the nickname of whoever has waited longest. */
  readonly body: string;
}

export interface PushTexts {
  readonly quickStart: Readonly<Record<Locale, PushText>>;
  readonly gameStart: Readonly<Record<Locale, PushText>>;
}

type Logger = Pick<BaseLogger, 'info' | 'warn'>;

/** Sends through Firebase Cloud Messaging: the quick-start push to the locale's topic, the game-start push to devices. */
export class FcmPushNotifier implements PushNotifier, GameStartPushSender {
  private constructor(
    private readonly app: App,
    private readonly messaging: Messaging,
    private readonly texts: PushTexts,
    private readonly logger: Logger,
  ) {}

  /** Reads the service account key now, so a missing or broken key fails the boot. */
  static create(credentialsPath: string, texts: PushTexts, logger: Logger): FcmPushNotifier {
    const app = initializeApp({ credential: cert(credentialsPath) }, 'push');
    return new FcmPushNotifier(app, getMessaging(app), texts, logger);
  }

  notifyQuickStart(locale: Locale, nickname: Nickname): void {
    const wireLocale = localeToWire(locale);
    const text = this.texts.quickStart[locale];
    const topic = `${QUICK_START_TOPIC_PREFIX}${wireLocale}`;
    this.messaging
      .send({
        topic,
        notification: { title: text.title, body: text.body.replaceAll(NICKNAME_PLACEHOLDER, nickname) },
        data: { type: PushDataType.QuickStart, locale: wireLocale },
      })
      .then(
        () => this.logger.info({ topic }, 'quick-start push sent'),
        (error: unknown) => this.logger.warn({ err: error, topic }, 'quick-start push failed'),
      );
  }

  notifyGameStarted(locale: Locale, tokens: readonly string[]): void {
    const text = this.texts.gameStart[locale];
    this.messaging
      .sendEachForMulticast({
        tokens: [...tokens],
        notification: { title: text.title, body: text.body },
        data: { type: PushDataType.GameStarted },
        android: { priority: 'high' },
      })
      .then(
        (result) =>
          this.logger.info({ sent: result.successCount, failed: result.failureCount }, 'game-start push sent'),
        (error: unknown) => this.logger.warn({ err: error, count: tokens.length }, 'game-start push failed'),
      );
  }

  async close(): Promise<void> {
    await deleteApp(this.app);
  }
}
