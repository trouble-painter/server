import { type Env, parseEnv } from '../../src/shared/infrastructure/config/env.js';
import { KEYWORDS_FIXTURE_DIR } from './game.js';

/** A complete settings source for tests; real values live in the private server.env files. */
export const TEST_ENV_SOURCE: Readonly<Record<string, string>> = {
  APP_ENV: 'dev',
  PORT: '8080',
  JWT_SECRET: 'x'.repeat(32),
  ACCESS_TOKEN_TTL_SEC: '3600',
  WS_PING_INTERVAL_MS: '25000',
  WS_MAX_MESSAGE_BYTES: '65536',
  WS_RATE_PER_SEC: '40',
  WS_RATE_BURST: '80',
  WAIT_DISCONNECT_GRACE_MS: '30000',
  EMPTY_ROOM_TTL_MS: '600000',
  ROOM_CLEANUP_INTERVAL_MS: '60000',
  GAME_READY_MS: '5000',
  GAME_INTRO_ANIMATION_MS: '3000',
  GAME_ROUND_ANIMATION_MS: '2000',
  GAME_ROUNDS: '2',
  GAME_TURN_MS: '10000',
  GAME_STROKES_PER_TURN: '1',
  GAME_VOTE_MS: '30000',
  GAME_ANSWER_MS: '20000',
  GAME_END_MS: '15000',
  DRAW_THROTTLE_MS: '50',
  REACTION_THROTTLE_MS: '500',
  MAX_STROKE_POINTS: '500',
  MAX_ANSWER_LENGTH: '20',
  KEYWORDS_DIR: KEYWORDS_FIXTURE_DIR,
  SQLITE_PATH: ':memory:',
  RESTORE_GRACE_MS: '10000',
};

export function testEnv(overrides: Record<string, string> = {}): Env {
  return parseEnv({ ...TEST_ENV_SOURCE, ...overrides });
}
