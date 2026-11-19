import { pino, type Level, type Logger } from 'pino';
import { AppEnv } from '../config/env.js';

const LOG_LEVEL: Record<AppEnv, Level> = {
  [AppEnv.Dev]: 'debug',
  [AppEnv.Prod]: 'info',
};

export function createLogger(appEnv: AppEnv): Logger {
  return pino({ level: LOG_LEVEL[appEnv] });
}
