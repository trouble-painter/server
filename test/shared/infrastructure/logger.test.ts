import { describe, expect, it } from 'vitest';
import { AppEnv } from '../../../src/shared/infrastructure/config/env.js';
import { createLogger } from '../../../src/shared/infrastructure/logger/logger.js';

describe('createLogger', () => {
  it('tells the hook the level of every line written', () => {
    const levels: string[] = [];
    const logger = createLogger(AppEnv.Dev, (level) => levels.push(level));
    logger.info('a');
    logger.warn('b');
    logger.error('c');
    expect(levels).toEqual(['info', 'warn', 'error']);
  });
});
