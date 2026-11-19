import { describe, expect, it } from 'vitest';
import { loadEnv } from '../../../../src/shared/infrastructure/config/env.js';

const SECRET = 'x'.repeat(32);

describe('loadEnv', () => {
  it('fails without JWT_SECRET', () => {
    expect(() => loadEnv({})).toThrow(/JWT_SECRET/);
  });

  it('fails with a short JWT_SECRET', () => {
    expect(() => loadEnv({ JWT_SECRET: 'short' })).toThrow(/JWT_SECRET/);
  });

  it('does not include the secret value in the error', () => {
    expect(() => loadEnv({ JWT_SECRET: 'short-secret-value' })).not.toThrow(/short-secret-value/);
  });

  it('parses PORT and applies its default', () => {
    expect(loadEnv({ JWT_SECRET: SECRET, PORT: '3000' }).PORT).toBe(3000);
    expect(loadEnv({ JWT_SECRET: SECRET }).PORT).toBe(8080);
  });
});
