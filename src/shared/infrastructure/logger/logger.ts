import { pino, type Level, type Logger } from 'pino';
import { AppEnv } from '../config/env.js';

const LOG_LEVEL: Record<AppEnv, Level> = {
  [AppEnv.Dev]: 'debug',
  [AppEnv.Prod]: 'info',
};

/** `onLog` hears the level of every line written, whatever it says. */
export function createLogger(appEnv: AppEnv, onLog: (level: Level) => void): Logger {
  return pino({
    level: LOG_LEVEL[appEnv],
    hooks: {
      logMethod(args, method, level) {
        onLog(this.levels.labels[level] as Level);
        method.apply(this, args);
      },
    },
  });
}
