import { buildApp } from './app.js';
import { createMetricsServer, METRICS_HOST } from './shared/adapters/http/metrics-server.js';
import { loadServerVersion } from './shared/infrastructure/build-info/build-info.js';
import { loadEnv, type Env } from './shared/infrastructure/config/env.js';
import { createLogger } from './shared/infrastructure/logger/logger.js';
import { PrometheusMetrics } from './shared/infrastructure/metrics/prometheus-metrics.js';

const LISTEN_HOST = '0.0.0.0';

let env: Env;
try {
  env = loadEnv();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

const metrics = new PrometheusMetrics();
const logger = createLogger(env.APP_ENV, (level) => metrics.logged(level));
const serverVersion = loadServerVersion();
const http = buildApp(env, logger, metrics, serverVersion);
const metricsServer = createMetricsServer(metrics);

await http.listen({ host: LISTEN_HOST, port: env.PORT });
metricsServer.listen(env.METRICS_PORT, METRICS_HOST);
logger.info({ appEnv: env.APP_ENV, serverVersion }, 'server started');

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  logger.info({ signal }, 'shutting down');
  metricsServer.close();
  await http.close();
  process.exit(0);
}

process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
