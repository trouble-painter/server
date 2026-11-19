import { jwtVerify, SignJWT } from 'jose';
import { toUserId, type UserId } from '../../../shared/domain/user-id.js';
import type { TokenService } from '../application/ports/token-service.js';
import { TokenType } from '../domain/token.js';

const ALGORITHM = 'HS256';
/** Absorbs the gap between the app's local expiry check and the server receiving the token. */
const CLOCK_TOLERANCE_SEC = 60;
const TYPE_CLAIM = 'typ';

export class JoseTokenService implements TokenService {
  private readonly key: Uint8Array;

  constructor(
    secret: string,
    private readonly accessTokenTtlSec: number,
  ) {
    this.key = new TextEncoder().encode(secret);
  }

  async issue(userId: UserId, type: TokenType): Promise<string> {
    const jwt = new SignJWT({ [TYPE_CLAIM]: type })
      .setProtectedHeader({ alg: ALGORITHM })
      .setSubject(String(userId))
      .setIssuedAt();
    if (type === TokenType.Access) {
      jwt.setExpirationTime(`${this.accessTokenTtlSec}s`);
    }
    return jwt.sign(this.key);
  }

  async verify(token: string, type: TokenType): Promise<UserId | null> {
    try {
      const { payload } = await jwtVerify(token, this.key, {
        algorithms: [ALGORITHM],
        clockTolerance: CLOCK_TOLERANCE_SEC,
        requiredClaims: type === TokenType.Access ? ['sub', 'iat', 'exp'] : ['sub', 'iat'],
      });
      if (payload[TYPE_CLAIM] !== type) {
        return null;
      }
      return toUserId(Number(payload.sub));
    } catch {
      return null;
    }
  }
}
