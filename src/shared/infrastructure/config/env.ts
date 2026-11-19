import { existsSync } from 'node:fs';
import { z } from 'zod';

export enum AppEnv {
  Dev = 'dev',
  Prod = 'prod',
}

const AppEnvSchema = z.enum(AppEnv);

const EnvSchema = z.object({
  APP_ENV: AppEnvSchema,
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  JWT_SECRET: z.string().min(32),
  ACCESS_TOKEN_TTL_SEC: z.coerce.number().int().positive().default(3600),
  WS_PING_INTERVAL_MS: z.coerce.number().int().positive().default(25_000),
  WS_MAX_MESSAGE_BYTES: z.coerce.number().int().positive().default(64 * 1024),
  WS_RATE_PER_SEC: z.coerce.number().int().positive().default(40),
  WS_RATE_BURST: z.coerce.number().int().positive().default(80),
  WAIT_DISCONNECT_GRACE_MS: z.coerce.number().int().positive().default(30_000),
  EMPTY_ROOM_TTL_MS: z.coerce.number().int().positive().default(600_000),
  ROOM_CLEANUP_INTERVAL_MS: z.coerce.number().int().positive().default(60_000),
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
