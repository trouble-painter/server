import type { FastifyInstance } from 'fastify';
import { pino } from 'pino';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { TEST_SERVER_VERSION, testEnv } from '../support/env.js';
import { Client, type Message } from '../support/ws-client.js';
import { PrometheusMetrics } from '../../src/shared/infrastructure/metrics/prometheus-metrics.js';

/** A quick match and a game that runs on short deadlines alone. */
const FAST = {
  MATCH_WAIT_MS: '100',
  MATCH_ACCEPT_MS: '150',
  GAME_READY_MS: '30',
  GAME_INTRO_ANIMATION_MS: '0',
  GAME_ROUND_ANIMATION_MS: '0',
  GAME_ROUNDS: '1',
  GAME_TURN_MS: '30',
  GAME_VOTE_MS: '30',
  GAME_ANSWER_MS: '30',
};

interface Player {
  userId: number;
  accessToken: string;
  client: Client;
}

describe('WebSocket quick start', () => {
  let app: FastifyInstance;
  let url: string;
  const clients: Client[] = [];

  afterEach(async () => {
    await Promise.all(clients.splice(0).map((c) => c.close()));
    await app.close();
  });

  async function boot(): Promise<void> {
    app = buildApp(testEnv(FAST), pino({ enabled: false }), new PrometheusMetrics(), TEST_SERVER_VERSION);
    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    url = `${address.replace('http', 'ws')}/ws`;
  }

  async function connect(accessToken: string): Promise<{ client: Client; hello: Message }> {
    const client = await Client.open(url, accessToken);
    clients.push(client);
    return { client, hello: await client.next() };
  }

  async function user(): Promise<Player> {
    const { userId, accessToken } = (await app.inject({ method: 'POST', url: '/api/v1/auth/anonymous-signin' })).json();
    const { client } = await connect(accessToken);
    return { userId, accessToken, client };
  }

  async function nextOfType(client: Client, type: string): Promise<Message> {
    for (;;) {
      const message = await client.next();
      if (message.type === type) {
        return message;
      }
    }
  }

  /** The next MATCHING that carries an accept step. */
  async function nextAcceptStep(client: Client): Promise<Message> {
    for (;;) {
      const message = await nextOfType(client, 'MATCHING');
      if (message.data.ready !== null) {
        return message;
      }
    }
  }

  it('matches three players at the deadline and deletes the room once the result is out', async () => {
    await boot();
    const [a, b, c] = [await user(), await user(), await user()];

    expect(await a.client.request('MATCH_JOIN', { nickname: 'A', locale: 'KO' })).toEqual({
      type: 'MATCHING',
      data: { locale: 'KO', waitingCount: 1, startsAt: null, minCount: 3, waitMs: 100, ready: null },
    });
    expect((await b.client.request('MATCH_JOIN', { nickname: 'B', locale: 'KO' })).data.waitingCount).toBe(2);
    expect((await a.client.next()).data.waitingCount).toBe(2);
    const third = (await c.client.request('MATCH_JOIN', { nickname: 'C', locale: 'KO' })).data;
    expect(third.waitingCount).toBe(3);
    expect(third.startsAt).toEqual(expect.any(Number));
    for (const player of [a, b]) {
      expect((await player.client.next()).data).toMatchObject({ waitingCount: 3, startsAt: third.startsAt, minCount: 3, waitMs: 100 });
    }

    for (const player of [a, b, c]) {
      const found = await nextAcceptStep(player.client);
      expect(found.data.ready).toMatchObject({ acceptMs: 150, isAccepted: false });
    }
    // The last accept starts the game, so no one waits for a reply.
    expect((await a.client.request('MATCH_ACCEPT')).data.ready.isAccepted).toBe(true);
    b.client.send('MATCH_ACCEPT');
    c.client.send('MATCH_ACCEPT');
    for (const player of [a, b, c]) {
      const ready = await nextOfType(player.client, 'ROOM');
      expect(ready.data.room).toMatchObject({ isQuickStart: true, hostId: a.userId, phase: { type: 'READY' } });
      expect(ready.data.room.players.map((p: { id: number }) => p.id)).toEqual([a.userId, b.userId, c.userId]);
    }
    for (const player of [a, b, c]) {
      let message = await nextOfType(player.client, 'ROOM');
      while (message.data.room.phase.type !== 'END') {
        message = await nextOfType(player.client, 'ROOM');
      }
    }

    const { hello } = await connect(a.accessToken);
    expect(hello.data).toMatchObject({ room: null, matching: null });
  });

  it('sends home whoever did not accept and requeues those who did when fewer than min accepted', async () => {
    await boot();
    const [a, b, c] = [await user(), await user(), await user()];
    for (const [player, nickname] of [[a, 'A'], [b, 'B'], [c, 'C']] as const) {
      await player.client.request('MATCH_JOIN', { nickname, locale: 'KO' });
    }
    for (const player of [a, b, c]) {
      await nextAcceptStep(player.client);
    }
    await a.client.request('MATCH_ACCEPT');
    await b.client.request('MATCH_ACCEPT');

    expect(await nextOfType(c.client, 'IDLE')).toEqual({ type: 'IDLE', data: { reason: 'MATCH_DECLINED' } });
    for (const player of [a, b]) {
      const status = await nextOfType(player.client, 'MATCHING');
      expect(status.data).toMatchObject({ waitingCount: 2, ready: null });
    }
    const { hello } = await connect(c.accessToken);
    expect(hello.data).toMatchObject({ room: null, matching: null });
  });

  /** Joins every player, then answers each one's accept step and returns the rooms they get. */
  async function playOut(players: Player[], locale: string): Promise<Message[]> {
    for (const [index, player] of players.entries()) {
      player.client.send('MATCH_JOIN', { nickname: `P${index}`, locale });
    }
    for (const player of players) {
      await nextAcceptStep(player.client);
    }
    for (const player of players) {
      player.client.send('MATCH_ACCEPT');
    }
    return Promise.all(players.map((player) => nextOfType(player.client, 'ROOM')));
  }

  it('runs two locales at the same time, each into its own room', async () => {
    await boot();
    const ko = [await user(), await user(), await user()];
    const en = [await user(), await user(), await user()];

    const [koRooms, enRooms] = await Promise.all([playOut(ko, 'KO'), playOut(en, 'EN')]);

    const koRoom = koRooms[0]!.data.room;
    const enRoom = enRooms[0]!.data.room;
    expect(koRoom.id).not.toBe(enRoom.id);
    expect(koRoom.players.map((p: { id: number }) => p.id).sort()).toEqual(ko.map((p) => p.userId).sort());
    expect(enRoom.players.map((p: { id: number }) => p.id).sort()).toEqual(en.map((p) => p.userId).sort());
    for (const message of [...koRooms, ...enRooms]) {
      expect(message.data.room).toMatchObject({ isQuickStart: true, phase: { type: 'READY' } });
    }
  });

  it('opens a second queue for newcomers while the first runs its accept step', async () => {
    await boot();
    const first = [await user(), await user(), await user(), await user(), await user(), await user()];
    const second = [await user(), await user(), await user()];

    for (const [index, player] of first.entries()) {
      player.client.send('MATCH_JOIN', { nickname: `A${index}`, locale: 'KO' });
    }
    for (const player of first) {
      await nextAcceptStep(player.client);
    }

    // The first queue is in its accept step, so these three wait in a queue of their own.
    const replies = [];
    for (const [index, player] of second.entries()) {
      replies.push((await player.client.request('MATCH_JOIN', { nickname: `B${index}`, locale: 'KO' })).data);
    }
    expect(replies.map((r) => r.waitingCount)).toEqual([1, 2, 3]);
    expect(replies.every((r) => r.ready === null)).toBe(true);

    for (const player of first) {
      player.client.send('MATCH_ACCEPT');
    }
    for (const player of second) {
      await nextAcceptStep(player.client);
      player.client.send('MATCH_ACCEPT');
    }

    const firstRooms = await Promise.all(first.map((p) => nextOfType(p.client, 'ROOM')));
    const secondRooms = await Promise.all(second.map((p) => nextOfType(p.client, 'ROOM')));
    expect(firstRooms[0]!.data.room.players).toHaveLength(6);
    expect(secondRooms[0]!.data.room.players).toHaveLength(3);
    expect(firstRooms[0]!.data.room.id).not.toBe(secondRooms[0]!.data.room.id);
  });

  it('cancelling tells the others the new count', async () => {
    await boot();
    const [a, b] = [await user(), await user()];
    await a.client.request('MATCH_JOIN', { nickname: 'A', locale: 'KO' });
    await b.client.request('MATCH_JOIN', { nickname: 'B', locale: 'KO' });
    await a.client.next();

    expect(await b.client.request('MATCH_CANCEL')).toEqual({ type: 'IDLE', data: { reason: 'MATCH_CANCELED' } });
    expect(await a.client.next()).toEqual({ type: 'MATCHING', data: { locale: 'KO', waitingCount: 1, startsAt: null, minCount: 3, waitMs: 100, ready: null } });
  });

  it('a user who reconnects while queued gets the queue in HELLO', async () => {
    await boot();
    const a = await user();
    await a.client.request('MATCH_JOIN', { nickname: 'A', locale: 'EN' });
    await a.client.close();

    const { hello } = await connect(a.accessToken);
    expect(hello.data).toMatchObject({ room: null, matching: { locale: 'EN', waitingCount: 1 } });
  });

  it('joining the queue leaves a waiting room, and creating a room leaves the queue', async () => {
    await boot();
    const [a, b] = [await user(), await user()];
    const roomId = (await a.client.request('CREATE_ROOM', { nickname: 'A', locale: 'KO' })).data.room.id;
    await b.client.request('JOIN_ROOM', { roomId, nickname: 'B' });
    await a.client.next();

    expect((await b.client.request('MATCH_JOIN', { nickname: 'B', locale: 'KO' })).type).toBe('MATCHING');
    expect((await a.client.next()).data.players).toHaveLength(1);

    expect((await b.client.request('CREATE_ROOM', { nickname: 'B', locale: 'KO' })).type).toBe('ROOM');
    const { hello } = await connect(b.accessToken);
    expect(hello.data.matching).toBeNull();
  });
});
