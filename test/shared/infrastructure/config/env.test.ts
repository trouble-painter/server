import { describe, expect, it } from 'vitest';
import { Locale } from '../../../../src/shared/domain/locale.js';
import { AppEnv, envFilePath, parseEnv, pushTextOf } from '../../../../src/shared/infrastructure/config/env.js';
import { TEST_ENV_SOURCE } from '../../../support/env.js';

const VALID = TEST_ENV_SOURCE;

function without(key: string): Record<string, string> {
  const { [key]: _, ...rest } = VALID;
  return rest;
}

describe('parseEnv', () => {
  it('fails without APP_ENV or with an unknown APP_ENV', () => {
    expect(() => parseEnv(without('APP_ENV'))).toThrow(/APP_ENV/);
    expect(() => parseEnv({ ...VALID, APP_ENV: 'staging' })).toThrow(/APP_ENV/);
  });

  it('parses APP_ENV into AppEnv', () => {
    expect(parseEnv(VALID).APP_ENV).toBe(AppEnv.Dev);
    expect(parseEnv({ ...VALID, APP_ENV: 'prod' }).APP_ENV).toBe(AppEnv.Prod);
  });

  it('fails when any setting is missing, since there are no code defaults', () => {
    for (const key of Object.keys(VALID)) {
      expect(() => parseEnv(without(key)), key).toThrow(new RegExp(key));
    }
  });

  it('fails with a short JWT_SECRET', () => {
    expect(() => parseEnv({ ...VALID, JWT_SECRET: 'short' })).toThrow(/JWT_SECRET/);
  });

  it('does not include the secret value in the error', () => {
    expect(() => parseEnv({ ...VALID, JWT_SECRET: 'short-secret-value' })).not.toThrow(/short-secret-value/);
  });

  it('coerces numbers and rejects out-of-range values', () => {
    expect(parseEnv({ ...VALID, PORT: '3000' }).PORT).toBe(3000);
    expect(parseEnv({ ...VALID, ACCESS_TOKEN_TTL_SEC: '60' }).ACCESS_TOKEN_TTL_SEC).toBe(60);
    expect(() => parseEnv({ ...VALID, ACCESS_TOKEN_TTL_SEC: '0' })).toThrow(/ACCESS_TOKEN_TTL_SEC/);
    expect(parseEnv({ ...VALID, GAME_INTRO_ANIMATION_MS: '0' }).GAME_INTRO_ANIMATION_MS).toBe(0);
  });

  it('parses PUSH_ENABLED as a strict flag', () => {
    expect(parseEnv({ ...VALID, PUSH_ENABLED: 'true' }).PUSH_ENABLED).toBe(true);
    expect(parseEnv({ ...VALID, PUSH_ENABLED: 'false' }).PUSH_ENABLED).toBe(false);
    expect(() => parseEnv({ ...VALID, PUSH_ENABLED: 'yes' })).toThrow(/PUSH_ENABLED/);
  });

  it('reads the push text of each locale', () => {
    const env = parseEnv(VALID);
    expect(pushTextOf(env, Locale.Ko)).toEqual({ title: VALID.PUSH_TITLE_KO, body: VALID.PUSH_BODY_KO });
    expect(pushTextOf(env, Locale.En)).toEqual({ title: VALID.PUSH_TITLE_EN, body: VALID.PUSH_BODY_EN });
  });
});

describe('envFilePath', () => {
  it('points into the private .env directory per environment', () => {
    expect(envFilePath(AppEnv.Dev)).toBe('.env/dev/server.env');
    expect(envFilePath(AppEnv.Prod)).toBe('.env/prod/server.env');
  });
});
