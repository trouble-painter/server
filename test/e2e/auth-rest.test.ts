import type { FastifyInstance } from 'fastify';
import { pino } from 'pino';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { testEnv } from '../support/env.js';

const ENV = testEnv();

describe('auth REST', () => {
  let app: FastifyInstance;

  beforeEach(() => {
    app = buildApp(ENV, pino({ enabled: false }));
  });

  afterEach(async () => {
    await app.close();
  });

  async function signIn() {
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/anonymous-signin' });
    expect(res.statusCode).toBe(200);
    return res.json<{ userId: number; accessToken: string; refreshToken: string }>();
  }

  it('anonymous-signin issues a new safe-integer userId each time', async () => {
    const a = await signIn();
    const b = await signIn();
    expect(Number.isSafeInteger(a.userId) && a.userId > 0).toBe(true);
    expect(a.userId).not.toBe(b.userId);
    expect(a.accessToken).toBeTypeOf('string');
    expect(a.refreshToken).toBeTypeOf('string');
  });

  it('reissue returns a new access token for the same user and echoes the refresh token', async () => {
    const signed = await signIn();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/reissue',
      payload: { refreshToken: signed.refreshToken },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.userId).toBe(signed.userId);
    expect(body.refreshToken).toBe(signed.refreshToken);
    expect(body.accessToken).toBeTypeOf('string');
  });

  it('reissue answers 401 for an access token or garbage, 400 for a missing body field', async () => {
    const signed = await signIn();
    for (const refreshToken of [signed.accessToken, 'garbage']) {
      const res = await app.inject({ method: 'POST', url: '/api/v1/auth/reissue', payload: { refreshToken } });
      expect(res.statusCode).toBe(401);
    }
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/reissue', payload: {} });
    expect(res.statusCode).toBe(400);
  });

  it('playing-room returns null roomId with a lowercase bearer access token', async () => {
    const signed = await signIn();
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/playing-room',
      headers: { authorization: `bearer ${signed.accessToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ roomId: null });
  });

  it('playing-room answers 401 without a header or with a refresh token', async () => {
    const signed = await signIn();
    const missing = await app.inject({ method: 'GET', url: '/api/v1/playing-room' });
    const refresh = await app.inject({
      method: 'GET',
      url: '/api/v1/playing-room',
      headers: { authorization: `Bearer ${signed.refreshToken}` },
    });
    expect(missing.statusCode).toBe(401);
    expect(refresh.statusCode).toBe(401);
  });

  it('config answers the room code length without authentication', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/config' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ roomCodeLength: 4 });
  });
});
