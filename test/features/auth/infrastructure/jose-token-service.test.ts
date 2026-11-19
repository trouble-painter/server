import { decodeJwt, SignJWT } from 'jose';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TokenType } from '../../../../src/features/auth/application/index.js';
import { JoseTokenService } from '../../../../src/features/auth/infrastructure/jose-token-service.js';
import type { UserId } from '../../../../src/shared/domain/user-id.js';

const SECRET = 'x'.repeat(32);
const TTL_SEC = 3600;
const USER_ID = 123 as UserId;

describe('JoseTokenService', () => {
  const service = new JoseTokenService(SECRET, TTL_SEC);

  afterEach(() => {
    vi.useRealTimers();
  });

  it('round-trips the userId for each token type', async () => {
    for (const type of [TokenType.Access, TokenType.Refresh]) {
      expect(await service.verify(await service.issue(USER_ID, type), type)).toBe(USER_ID);
    }
  });

  it('gives access tokens exp, refresh tokens only iat', async () => {
    const access = decodeJwt(await service.issue(USER_ID, TokenType.Access));
    const refresh = decodeJwt(await service.issue(USER_ID, TokenType.Refresh));
    expect(access.exp! - access.iat!).toBe(TTL_SEC);
    expect(refresh.iat).toBeTypeOf('number');
    expect(refresh.exp).toBeUndefined();
  });

  it('rejects a token used as the other type', async () => {
    const access = await service.issue(USER_ID, TokenType.Access);
    const refresh = await service.issue(USER_ID, TokenType.Refresh);
    expect(await service.verify(access, TokenType.Refresh)).toBeNull();
    expect(await service.verify(refresh, TokenType.Access)).toBeNull();
  });

  it('rejects a token signed with another secret, or garbage', async () => {
    const other = new JoseTokenService('y'.repeat(32), TTL_SEC);
    expect(await service.verify(await other.issue(USER_ID, TokenType.Access), TokenType.Access)).toBeNull();
    expect(await service.verify('not-a-jwt', TokenType.Access)).toBeNull();
  });

  it('accepts an access token up to 60s past exp, then rejects it', async () => {
    vi.useFakeTimers({ now: new Date('2026-01-01T00:00:00Z') });
    const access = await service.issue(USER_ID, TokenType.Access);
    vi.setSystemTime(Date.now() + (TTL_SEC + 59) * 1000);
    expect(await service.verify(access, TokenType.Access)).toBe(USER_ID);
    vi.setSystemTime(Date.now() + 2 * 1000);
    expect(await service.verify(access, TokenType.Access)).toBeNull();
  });

  it('keeps refresh tokens valid indefinitely', async () => {
    vi.useFakeTimers({ now: new Date('2026-01-01T00:00:00Z') });
    const refresh = await service.issue(USER_ID, TokenType.Refresh);
    vi.setSystemTime(new Date('2036-01-01T00:00:00Z'));
    expect(await service.verify(refresh, TokenType.Refresh)).toBe(USER_ID);
  });

  it('rejects a correctly signed token without typ or with a non-integer sub', async () => {
    const key = new TextEncoder().encode(SECRET);
    const noType = await new SignJWT({}).setProtectedHeader({ alg: 'HS256' }).setSubject('1').setIssuedAt().sign(key);
    const badSub = await new SignJWT({ typ: TokenType.Refresh })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('abc')
      .setIssuedAt()
      .sign(key);
    expect(await service.verify(noType, TokenType.Refresh)).toBeNull();
    expect(await service.verify(badSub, TokenType.Refresh)).toBeNull();
  });
});
