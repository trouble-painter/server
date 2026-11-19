import Fastify from 'fastify';
import { loadEnv, type Env } from './shared/infrastructure/config/env.js';
import { createLogger } from './shared/infrastructure/logger/logger.js';

const LISTEN_HOST = '0.0.0.0';

let env: Env;
try {
  env = loadEnv();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

const logger = createLogger(env.APP_ENV);
const http = Fastify({ loggerInstance: logger });

await http.listen({ host: LISTEN_HOST, port: env.PORT });
logger.info({ appEnv: env.APP_ENV }, 'server started');

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  logger.info({ signal }, 'shutting down');
  await http.close();
  process.exit(0);
}

process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
