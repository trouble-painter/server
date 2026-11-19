import Fastify from 'fastify';
import { pino } from 'pino';
import { loadEnv, type Env } from './shared/infrastructure/config/env.js';

const LISTEN_HOST = '0.0.0.0';

const logger = pino();

let env: Env;
try {
  env = loadEnv(process.env);
} catch (error) {
  logger.fatal(error instanceof Error ? error.message : error);
  process.exit(1);
}

const http = Fastify({ loggerInstance: logger });

await http.listen({ host: LISTEN_HOST, port: env.PORT });

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  logger.info({ signal }, 'shutting down');
  await http.close();
  process.exit(0);
}

process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
