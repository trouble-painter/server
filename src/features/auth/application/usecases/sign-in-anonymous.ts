import type { IdGenerator } from '../../../../shared/application/ports/id-generator.js';
import { TokenType, type IssuedTokens } from '../../domain/token.js';
import type { TokenService } from '../ports/token-service.js';

export class SignInAnonymous {
  constructor(
    private readonly tokens: TokenService,
    private readonly ids: IdGenerator,
  ) {}

  async execute(): Promise<IssuedTokens> {
    const userId = this.ids.userId();
    return {
      userId,
      accessToken: await this.tokens.issue(userId, TokenType.Access),
      refreshToken: await this.tokens.issue(userId, TokenType.Refresh),
    };
  }
}
