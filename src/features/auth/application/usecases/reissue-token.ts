import { TokenType, type IssuedTokens } from '../../domain/token.js';
import type { TokenService } from '../ports/token-service.js';

export class ReissueToken {
  constructor(private readonly tokens: TokenService) {}

  /**
   * Returns the given refresh token unchanged (no rotation): the app never stores
   * reissued tokens and keeps sending the one it got at sign-in.
   * Returns null when the refresh token is rejected.
   */
  async execute(refreshToken: string): Promise<IssuedTokens | null> {
    const userId = await this.tokens.verify(refreshToken, TokenType.Refresh);
    if (userId === null) {
      return null;
    }
    return {
      userId,
      accessToken: await this.tokens.issue(userId, TokenType.Access),
      refreshToken,
    };
  }
}
