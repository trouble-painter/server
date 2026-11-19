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
type PushTextKey = `PUSH_TITLE_${LocaleKey}` | `PUSH_BODY_${LocaleKey}`;

/** `PUSH_TITLE_<LOCALE>` and `PUSH_BODY_<LOCALE>` for every locale, so a new locale cannot go without text. */
const PushTextShape = Object.fromEntries(
  Object.values(Locale).flatMap((locale) => {
    const key = locale.toUpperCase();
    return [
      [`PUSH_TITLE_${key}`, z.string().min(1)],
      [`PUSH_BODY_${key}`, z.string().min(1)],
    ];
  }),
) as Record<PushTextKey, z.ZodString>;

const EnvSchema = z.object({
  APP_ENV: AppEnvSchema,
  PORT: z.coerce.number().int().min(1).max(65535),
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
  GAME_END_MS: positiveInt,
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
  MATCH_DISCONNECT_GRACE_MS: positiveInt,
  /** false logs pushes instead of sending them; the key path is then not read. */
  PUSH_ENABLED: flag,
  FCM_CREDENTIALS_PATH: z.string().min(1),
  PUSH_WAIT_MS: positiveInt,
  PUSH_COOLDOWN_MS: positiveInt,
  ...PushTextShape,
});

export type Env = z.infer<typeof EnvSchema>;

/** The push title and body for `locale`. */
export function pushTextOf(env: Env, locale: Locale): { title: string; body: string } {
  const key = locale.toUpperCase() as LocaleKey;
  return { title: env[`PUSH_TITLE_${key}`], body: env[`PUSH_BODY_${key}`] };
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
