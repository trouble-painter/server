import type { UserId } from '../../../shared/domain/user-id.js';

export enum TokenType {
  Access = 'access',
  Refresh = 'refresh',
}

export interface IssuedTokens {
  userId: UserId;
  accessToken: string;
  refreshToken: string;
}
