import { describe, expect, it } from 'vitest';
import { AppEnv, envFilePath, parseEnv } from '../../../../src/shared/infrastructure/config/env.js';

const VALID = { APP_ENV: 'dev', JWT_SECRET: 'x'.repeat(32) };

describe('parseEnv', () => {
  it('fails without APP_ENV or with an unknown APP_ENV', () => {
    expect(() => parseEnv({ JWT_SECRET: VALID.JWT_SECRET })).toThrow(/APP_ENV/);
    expect(() => parseEnv({ ...VALID, APP_ENV: 'staging' })).toThrow(/APP_ENV/);
  });

  it('parses APP_ENV into AppEnv', () => {
    expect(parseEnv(VALID).APP_ENV).toBe(AppEnv.Dev);
    expect(parseEnv({ ...VALID, APP_ENV: 'prod' }).APP_ENV).toBe(AppEnv.Prod);
  });

  it('fails without JWT_SECRET', () => {
    expect(() => parseEnv({ APP_ENV: 'dev' })).toThrow(/JWT_SECRET/);
  });

  it('fails with a short JWT_SECRET', () => {
    expect(() => parseEnv({ ...VALID, JWT_SECRET: 'short' })).toThrow(/JWT_SECRET/);
  });

  it('does not include the secret value in the error', () => {
    expect(() => parseEnv({ ...VALID, JWT_SECRET: 'short-secret-value' })).not.toThrow(/short-secret-value/);
  });

  it('parses PORT and applies its default', () => {
    expect(parseEnv({ ...VALID, PORT: '3000' }).PORT).toBe(3000);
    expect(parseEnv(VALID).PORT).toBe(8080);
  });

  it('parses ACCESS_TOKEN_TTL_SEC and defaults it to one hour', () => {
    expect(parseEnv({ ...VALID, ACCESS_TOKEN_TTL_SEC: '60' }).ACCESS_TOKEN_TTL_SEC).toBe(60);
    expect(parseEnv(VALID).ACCESS_TOKEN_TTL_SEC).toBe(3600);
    expect(() => parseEnv({ ...VALID, ACCESS_TOKEN_TTL_SEC: '0' })).toThrow(/ACCESS_TOKEN_TTL_SEC/);
  });
});

describe('envFilePath', () => {
  it('points into the private .env directory per environment', () => {
    expect(envFilePath(AppEnv.Dev)).toBe('.env/dev/server.env');
    expect(envFilePath(AppEnv.Prod)).toBe('.env/prod/server.env');
  });
});
