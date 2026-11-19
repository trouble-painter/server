import { existsSync } from 'node:fs';
import { z } from 'zod';

export enum AppEnv {
  Dev = 'dev',
  Prod = 'prod',
}

const AppEnvSchema = z.enum(AppEnv);

/** Every setting is required: values live only in `.env/<APP_ENV>/server.env`, never as code defaults. */
const positiveInt = z.coerce.number().int().positive();
const nonNegativeInt = z.coerce.number().int().min(0);

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
});

export type Env = z.infer<typeof EnvSchema>;

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
