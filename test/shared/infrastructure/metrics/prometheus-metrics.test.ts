import { describe, expect, it } from 'vitest';
import { Role } from '../../../../src/features/game/domain/role.js';
import { PrometheusMetrics } from '../../../../src/shared/infrastructure/metrics/prometheus-metrics.js';

describe('PrometheusMetrics', () => {
  it('counts finished games by winner and mode', async () => {
    const metrics = new PrometheusMetrics();
    metrics.gameEnded(Role.Mafia, true);
    metrics.gameEnded(Role.Mafia, true);
    metrics.gameEnded(Role.Citizen, false);
    const text = await metrics.render();
    expect(text).toContain('games_ended_total{winner="mafia",mode="quick_start"} 2');
    expect(text).toContain('games_ended_total{winner="citizen",mode="room"} 1');
  });

  it('exposes the server version as build_info', async () => {
    const metrics = new PrometheusMetrics();
    metrics.setBuildInfo({ version: '1.0.0', commit: 'abc1234' });
    expect(await metrics.render()).toContain('build_info{version="1.0.0",commit="abc1234"} 1');
  });

  it('counts the players of each matching step', async () => {
    const metrics = new PrometheusMetrics();
    metrics.found(6);
    metrics.accepted(5);
    metrics.declined(1);
    const text = await metrics.render();
    expect(text).toContain('matching_found_players_total 6');
    expect(text).toContain('matching_accepted_players_total 5');
    expect(text).toContain('matching_declined_players_total 1');
  });

  it('counts log lines by level', async () => {
    const metrics = new PrometheusMetrics();
    metrics.logged('warn');
    metrics.logged('error');
    metrics.logged('error');
    const text = await metrics.render();
    expect(text).toContain('log_messages_total{level="warn"} 1');
    expect(text).toContain('log_messages_total{level="error"} 2');
  });

  it('reads a gauge anew at each scrape', async () => {
    const metrics = new PrometheusMetrics();
    let connections = 3;
    metrics.addGauge('ws_connections', 'Open WebSocket connections.', () => connections);
    expect(await metrics.render()).toContain('ws_connections 3');
    connections = 5;
    expect(await metrics.render()).toContain('ws_connections 5');
  });

  it('exposes the process metrics too', async () => {
    expect(await new PrometheusMetrics().render()).toContain('process_cpu_seconds_total');
  });
});
