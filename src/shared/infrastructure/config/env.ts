import { existsSync } from 'node:fs';
import { z } from 'zod';
import { Locale } from '../../domain/locale.js';

export enum AppEnv {
  Dev = 'dev',
  Prod = 'prod',
}

const AppEnvSchema = z.enum(AppEnv);

/** Every setting is required: values live only in `.env/<APP_ENV>/server.env`, never as code defaults. */
const positiveInt = z.coerce.number().int().positive();
const nonNegativeInt = z.coerce.number().int().min(0);
const flag = z.enum(['true', 'false']).transform((value) => value === 'true');

type LocaleKey = Uppercase<`${Locale}`>;

/** The env key prefix of each push's title and body */
export enum PushTextPrefix {
  QuickStart = 'PUSH_',
  GameStart = 'PUSH_GAME_START_',
  MatchFound = 'PUSH_MATCH_FOUND_',
}

type PushTextKey<P extends PushTextPrefix> = `${P}TITLE_${LocaleKey}` | `${P}BODY_${LocaleKey}`;

/** `<prefix>TITLE_<LOCALE>` and `<prefix>BODY_<LOCALE>` for every locale, so a new locale cannot go without text. */
function pushTextShape<P extends PushTextPrefix>(prefix: P): Record<PushTextKey<P>, z.ZodString> {
  return Object.fromEntries(
    Object.values(Locale).flatMap((locale) => {
      const key = locale.toUpperCase();
      return [
        [`${prefix}TITLE_${key}`, z.string().min(1)],
        [`${prefix}BODY_${key}`, z.string().min(1)],
      ];
    }),
  ) as Record<PushTextKey<P>, z.ZodString>;
}

const EnvSchema = z.object({
  APP_ENV: AppEnvSchema,
  PORT: z.coerce.number().int().min(1).max(65535),
  /** Served on loopback only; Prometheus reads it from the same machine. */
  METRICS_PORT: z.coerce.number().int().min(1).max(65535),
  JWT_SECRET: z.string().min(32),
  ACCESS_TOKEN_TTL_SEC: positiveInt,
  WS_PING_INTERVAL_MS: positiveInt,
  WS_MAX_MESSAGE_BYTES: positiveInt,
  WS_RATE_PER_SEC: positiveInt,
  WS_RATE_BURST: positiveInt,
  WAIT_DISCONNECT_GRACE_MS: positiveInt,
  EMPTY_ROOM_TTL_MS: positiveInt,
  ROOM_CLEANUP_INTERVAL_MS: positiveInt,
  GAME_READY_MS: positiveInt,
  GAME_INTRO_ANIMATION_MS: nonNegativeInt,
  GAME_ROUND_ANIMATION_MS: nonNegativeInt,
  GAME_ROUNDS: positiveInt,
  GAME_TURN_MS: positiveInt,
  GAME_STROKES_PER_TURN: positiveInt,
  GAME_VOTE_MS: positiveInt,
  GAME_ANSWER_MS: positiveInt,
  DRAW_THROTTLE_MS: positiveInt,
  REACTION_THROTTLE_MS: positiveInt,
  MAX_STROKE_POINTS: positiveInt,
  MAX_ANSWER_LENGTH: positiveInt,
  /** Holds `<locale>.json` per locale. */
  KEYWORDS_DIR: z.string().min(1),
  /** `:memory:` keeps nothing. */
  SQLITE_PATH: z.string().min(1),
  RESTORE_GRACE_MS: positiveInt,
  MATCH_MIN: positiveInt,
  MATCH_TARGET: positiveInt,
  MATCH_WAIT_MS: positiveInt,
  MATCH_ACCEPT_MS: positiveInt,
  MATCH_DISCONNECT_GRACE_MS: positiveInt,
  /** false logs pushes instead of sending them; the key path is then not read. */
  PUSH_ENABLED: flag,
  FCM_CREDENTIALS_PATH: z.string().min(1),
  PUSH_WAIT_MS: positiveInt,
  PUSH_COOLDOWN_MS: positiveInt,
  ...pushTextShape(PushTextPrefix.QuickStart),
  ...pushTextShape(PushTextPrefix.GameStart),
  ...pushTextShape(PushTextPrefix.MatchFound),
});

export type Env = z.infer<typeof EnvSchema>;

/** The title and body of the push named by `prefix`, for `locale`. */
export function pushTextOf(env: Env, prefix: PushTextPrefix, locale: Locale): { title: string; body: string } {
  const key = locale.toUpperCase() as LocaleKey;
  return {
    title: env[`${prefix}TITLE_${key}` as PushTextKey<PushTextPrefix>],
    body: env[`${prefix}BODY_${key}` as PushTextKey<PushTextPrefix>],
  };
}

export function envFilePath(appEnv: AppEnv): string {
  return `.env/${appEnv}/server.env`;
}

export function parseEnv(source: NodeJS.ProcessEnv): Env {
  const result = EnvSchema.safeParse(source);
  if (!result.success) {
    throw new Error(`Invalid environment:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}

/**
 * Reads APP_ENV, loads `.env/<APP_ENV>/server.env` into process.env if it exists
 * (variables already set in the process take precedence), then validates everything.
 */
export function loadEnv(): Env {
  const appEnv = AppEnvSchema.safeParse(process.env.APP_ENV);
  if (!appEnv.success) {
    throw new Error(`Invalid environment:\n${z.prettifyError(appEnv.error)}\n  → at APP_ENV`);
  }
  const file = envFilePath(appEnv.data);
  if (existsSync(file)) {
    process.loadEnvFile(file);
  }
  return parseEnv(process.env);
}
