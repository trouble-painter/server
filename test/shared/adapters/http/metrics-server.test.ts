import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMetricsServer, METRICS_HOST, METRICS_PATH } from '../../../../src/shared/adapters/http/metrics-server.js';
import { PrometheusMetrics } from '../../../../src/shared/infrastructure/metrics/prometheus-metrics.js';

describe('metrics server', () => {
  const server = createMetricsServer(new PrometheusMetrics());
  let base: string;

  beforeEach(async () => {
    await new Promise<void>((resolve) => server.listen(0, METRICS_HOST, resolve));
    base = `http://${METRICS_HOST}:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  it('serves the metrics in the Prometheus text format', async () => {
    const res = await fetch(`${base}${METRICS_PATH}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/plain');
    expect(await res.text()).toContain('process_cpu_seconds_total');
  });

  it('serves nothing else', async () => {
    expect((await fetch(`${base}/`)).status).toBe(404);
    expect((await fetch(`${base}${METRICS_PATH}`, { method: 'POST' })).status).toBe(404);
  });

  it('listens on loopback only', () => {
    expect((server.address() as AddressInfo).address).toBe(METRICS_HOST);
  });
});
