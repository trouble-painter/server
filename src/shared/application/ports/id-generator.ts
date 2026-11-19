import type { UserId } from '../../domain/user-id.js';

export interface IdGenerator {
  userId(): UserId;
}
