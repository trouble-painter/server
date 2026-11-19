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
  DRAW_THROTTLE_MS: '50',
  REACTION_THROTTLE_MS: '500',
  MAX_STROKE_POINTS: '500',
  MAX_ANSWER_LENGTH: '20',
  KEYWORDS_DIR: KEYWORDS_FIXTURE_DIR,
  SQLITE_PATH: ':memory:',
  RESTORE_GRACE_MS: '10000',
  MATCH_MIN: '3',
  MATCH_TARGET: '6',
  MATCH_WAIT_MS: '10000',
  MATCH_DISCONNECT_GRACE_MS: '10000',
  PUSH_ENABLED: 'false',
  FCM_CREDENTIALS_PATH: 'unused-when-push-is-disabled.json',
  PUSH_WAIT_MS: '5000',
  PUSH_COOLDOWN_MS: '300000',
  PUSH_TITLE_KO: '제목',
  PUSH_BODY_KO: '{nickname}님이 기다려요.',
  PUSH_TITLE_EN: 'Title',
  PUSH_BODY_EN: '{nickname} is waiting.',
  PUSH_GAME_START_TITLE_KO: '시작 제목',
  PUSH_GAME_START_BODY_KO: '시작 본문',
  PUSH_GAME_START_TITLE_EN: 'Start title',
  PUSH_GAME_START_BODY_EN: 'Start body',
};

export function testEnv(overrides: Record<string, string> = {}): Env {
  return parseEnv({ ...TEST_ENV_SOURCE, ...overrides });
}
