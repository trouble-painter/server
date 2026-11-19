import type { UserId } from '../../../../shared/domain/user-id.js';
import type { TokenType } from '../../domain/token.js';

export interface TokenService {
  /** Access tokens expire; refresh tokens never do but carry `iat` so an age limit can be added later. */
  issue(userId: UserId, type: TokenType): Promise<string>;
  /** Returns null when the token is invalid, expired, or of another type. */
  verify(token: string, type: TokenType): Promise<UserId | null>;
}
