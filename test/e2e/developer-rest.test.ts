import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { pino } from 'pino';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { PrometheusMetrics } from '../../src/shared/infrastructure/metrics/prometheus-metrics.js';
import { TEST_SERVER_VERSION, testEnv } from '../support/env.js';

describe('developer REST', () => {
  let app: FastifyInstance;
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'dev-uuids-'));
    file = join(dir, 'dev-uuids.txt');
    app = buildApp(testEnv({ DEV_UUIDS_PATH: file }), pino({ enabled: false }), new PrometheusMetrics(), TEST_SERVER_VERSION);
  });

  afterEach(async () => {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });

  async function check(uuid: unknown) {
    return app.inject({ method: 'POST', url: '/api/v1/developer', payload: { uuid } });
  }

  it('says no for everyone while the file does not exist', async () => {
    const res = await check('a');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ isDeveloper: false });
  });

  it('picks up additions and removals without a restart', async () => {
    writeFileSync(file, 'a\n  b  \n\n');
    expect((await check('a')).json()).toEqual({ isDeveloper: true });
    expect((await check('b')).json()).toEqual({ isDeveloper: true });
    expect((await check('c')).json()).toEqual({ isDeveloper: false });

    appendFileSync(file, 'c\n');
    expect((await check('c')).json()).toEqual({ isDeveloper: true });

    writeFileSync(file, 'c\n');
    expect((await check('a')).json()).toEqual({ isDeveloper: false });
  });

  it('rejects a body without a uuid', async () => {
    expect((await check('')).statusCode).toBe(400);
    expect((await check(1)).statusCode).toBe(400);
  });
});
