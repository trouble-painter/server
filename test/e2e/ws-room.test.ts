import type { FastifyInstance } from 'fastify';
import { pino } from 'pino';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { TEST_SERVER_VERSION, testEnv } from '../support/env.js';
import { Client, type Message } from '../support/ws-client.js';
import { PrometheusMetrics } from '../../src/shared/infrastructure/metrics/prometheus-metrics.js';

const GRACE_MS = 150;
const ENV = testEnv({ WAIT_DISCONNECT_GRACE_MS: String(GRACE_MS) });
describe('WebSocket rooms', () => {
  let app: FastifyInstance;
  let url: string;
  const clients: Client[] = [];

  beforeEach(async () => {
    app = buildApp(ENV, pino({ enabled: false }), new PrometheusMetrics(), TEST_SERVER_VERSION);
    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    url = `${address.replace('http', 'ws')}/ws`;
  });

  afterEach(async () => {
    await Promise.all(clients.splice(0).map((c) => c.close()));
    await app.close();
  });

  async function signIn(): Promise<{ userId: number; accessToken: string; refreshToken: string }> {
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/anonymous-signin' });
    return res.json();
  }

  async function connect(token: string): Promise<{ client: Client; hello: Message }> {
    const client = await Client.open(url, token);
    clients.push(client);
    return { client, hello: await client.next() };
  }

  async function user() {
    const tokens = await signIn();
    const { client, hello } = await connect(tokens.accessToken);
    return { ...tokens, client, hello };
  }

  async function playingRoom(accessToken: string): Promise<string | null> {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/playing-room',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    return res.json().roomId;
  }

  it('refuses the upgrade without a valid access token', async () => {
    const { refreshToken } = await signIn();
    await expect(Client.open(url, null)).rejects.toThrow('HTTP 401');
    await expect(Client.open(url, refreshToken)).rejects.toThrow('HTTP 401');
  });

  it('greets a user with no room', async () => {
    const before = Date.now();
    const { hello } = await user();
    expect(hello.type).toBe('HELLO');
    expect(hello.data.room).toBeNull();
    expect(hello.data.matching).toBeNull();
    expect(hello.data.serverTime).toBeGreaterThanOrEqual(before);
    expect(hello.data.serverVersion).toBe(TEST_SERVER_VERSION);
  });

  it('creates a room and lets another user join it', async () => {
    const a = await user();
    const created = await a.client.request('CREATE_ROOM', { nickname: '아보카도', locale: 'KO' });
    expect(created.type).toBe('ROOM');
    const room = created.data.room;
    expect(room).toMatchObject({
      locale: 'KO',
      isQuickStart: false,
      hostId: a.userId,
      option: { minPlayers: 3, maxPlayers: 10, rounds: 2, defaultStrokesPerTurn: 1 },
      rule: { strokesPerTurn: 1, categoryIds: [], keywordLocale: 'KO' },
      phase: {
        type: 'WAIT',
        categories: [
          { id: 'animal', name: '동물' },
          { id: 'food', name: '음식' },
        ],
      },
      players: [{ id: a.userId, nickname: '아보카도', color: 'RED', isConnected: true }],
    });
    expect(room.id).toMatch(/^[A-HJ-NP-Z2-9]{4}$/);

    const b = await user();
    const joined = await b.client.request('JOIN_ROOM', { roomId: room.id, nickname: 'B' });
    expect(joined.type).toBe('ROOM');
    expect(joined.data.room.players.map((p: any) => p.color)).toEqual(['RED', 'ORANGE']);

    const patch = await a.client.next();
    expect(patch).toEqual({ type: 'PLAYERS', data: { players: joined.data.room.players, hostId: a.userId } });
    expect(b.client.pending).toBe(0);

    expect(await playingRoom(a.accessToken)).toBe(room.id);
    expect(await playingRoom(b.accessToken)).toBe(room.id);
  });

  it('the host changes the rule and everyone gets the room again', async () => {
    const a = await user();
    const room = (await a.client.request('CREATE_ROOM', { nickname: 'A', locale: 'KO' })).data.room;
    const b = await user();
    await b.client.request('JOIN_ROOM', { roomId: room.id, nickname: 'B' });
    await a.client.next();

    const rule = { strokesPerTurn: null, categoryIds: ['food'], keywordLocale: 'KO' };
    a.client.send('UPDATE_RULE', rule);
    for (const client of [a.client, b.client]) {
      const message = await client.next();
      expect(message.type).toBe('ROOM');
      expect(message.data.room.rule).toEqual(rule);
    }

    expect(await b.client.request('UPDATE_RULE', rule)).toEqual({ type: 'ERROR', data: { request: 'UPDATE_RULE', code: 'NOT_HOST' } });
    expect(await a.client.request('UPDATE_RULE', { strokesPerTurn: 1, categoryIds: ['unknown'], keywordLocale: 'KO' })).toEqual({
      type: 'ERROR',
      data: { request: 'UPDATE_RULE', code: 'INVALID_REQUEST' },
    });
  });

  it('the host picks the keyword language and the categories follow it', async () => {
    const a = await user();
    const room = (await a.client.request('CREATE_ROOM', { nickname: 'A', locale: 'KO' })).data.room;
    expect(room.phase.categories).toEqual([
      { id: 'animal', name: '동물' },
      { id: 'food', name: '음식' },
    ]);

    const changed = await a.client.request('UPDATE_RULE', { strokesPerTurn: 1, categoryIds: ['food'], keywordLocale: 'EN' });
    expect(changed.data.room.rule).toEqual({ strokesPerTurn: 1, categoryIds: ['food'], keywordLocale: 'EN' });
    expect(changed.data.room.locale).toBe('KO');
    expect(changed.data.room.phase.categories).toEqual([
      { id: 'animal', name: 'Animals' },
      { id: 'food', name: 'Food' },
    ]);
    expect(await a.client.request('UPDATE_RULE', { strokesPerTurn: 1, categoryIds: [], keywordLocale: 'JP' })).toEqual({
      type: 'ERROR',
      data: { request: 'UPDATE_RULE', code: 'INVALID_REQUEST' },
    });
  });

  it('answers errors with the request type and a code', async () => {
    const a = await user();
    expect(await a.client.request('JOIN_ROOM', { roomId: 'ZZZZ', nickname: 'A' })).toEqual({
      type: 'ERROR',
      data: { request: 'JOIN_ROOM', code: 'ROOM_NOT_FOUND' },
    });
    expect((await a.client.request('CREATE_ROOM', { nickname: '여덟글자닉네임임', locale: 'KO' })).data.code).toBe(
      'INVALID_REQUEST',
    );
    expect((await a.client.request('CREATE_ROOM', { nickname: 'A', locale: 'ko' })).data.code).toBe('INVALID_REQUEST');
    expect((await a.client.request('LEAVE_ROOM')).data).toEqual({ request: 'LEAVE_ROOM', code: 'NOT_IN_ROOM' });
    expect((await a.client.request('START_GAME')).data).toEqual({ request: 'START_GAME', code: 'NOT_IN_ROOM' });
    expect((await a.client.request('NO_SUCH_TYPE')).data).toEqual({ request: 'NO_SUCH_TYPE', code: 'INVALID_REQUEST' });
  });

  it('refuses a joiner once the room is full', async () => {
    const host = await user();
    const roomId = (await host.client.request('CREATE_ROOM', { nickname: 'H', locale: 'KO' })).data.room.id;
    for (let i = 1; i < 10; i++) {
      const guest = await user();
      expect((await guest.client.request('JOIN_ROOM', { roomId, nickname: `G${i}` })).type).toBe('ROOM');
    }
    const late = await user();
    expect((await late.client.request('JOIN_ROOM', { roomId, nickname: 'L' })).data.code).toBe('ROOM_FULL');
  });

  it('leaving hands over the host role and empties playing-room', async () => {
    const a = await user();
    const roomId = (await a.client.request('CREATE_ROOM', { nickname: 'A', locale: 'KO' })).data.room.id;
    const b = await user();
    await b.client.request('JOIN_ROOM', { roomId, nickname: 'B' });
    await a.client.next();

    expect(await a.client.request('LEAVE_ROOM')).toEqual({ type: 'IDLE', data: { reason: 'LEFT' } });
    const patch = await b.client.next();
    expect(patch.data.hostId).toBe(b.userId);
    expect(patch.data.players.map((p: any) => p.id)).toEqual([b.userId]);
    expect(await playingRoom(a.accessToken)).toBeNull();
  });

  it('the host kicks a player, who goes idle while the others see the new players', async () => {
    const a = await user();
    const roomId = (await a.client.request('CREATE_ROOM', { nickname: 'A', locale: 'KO' })).data.room.id;
    const b = await user();
    await b.client.request('JOIN_ROOM', { roomId, nickname: 'B' });
    const c = await user();
    await c.client.request('JOIN_ROOM', { roomId, nickname: 'C' });
    await a.client.next();
    await a.client.next();
    await b.client.next();

    expect((await b.client.request('KICK_PLAYER', { targetId: c.userId })).data.code).toBe('NOT_HOST');
    expect((await a.client.request('KICK_PLAYER', { targetId: a.userId })).data.code).toBe('INVALID_REQUEST');
    expect((await a.client.request('KICK_PLAYER', { targetId: 999_999 })).data.code).toBe('INVALID_REQUEST');

    a.client.send('KICK_PLAYER', { targetId: c.userId });
    expect(await c.client.next()).toEqual({ type: 'IDLE', data: { reason: 'KICKED' } });
    for (const remaining of [a, b]) {
      expect((await remaining.client.next()).data.players.map((p: any) => p.id)).toEqual([a.userId, b.userId]);
    }
    expect(await playingRoom(c.accessToken)).toBeNull();
  });

  it('creating another room leaves the waiting room', async () => {
    const a = await user();
    const roomId = (await a.client.request('CREATE_ROOM', { nickname: 'A', locale: 'KO' })).data.room.id;
    const b = await user();
    await b.client.request('JOIN_ROOM', { roomId, nickname: 'B' });
    await a.client.next();

    const other = await b.client.request('CREATE_ROOM', { nickname: 'B', locale: 'EN' });
    expect(other.data.room.id).not.toBe(roomId);
    expect((await a.client.next()).data.players.map((p: any) => p.id)).toEqual([a.userId]);
  });

  it('restores the room on reconnect and tells the others', async () => {
    const a = await user();
    const roomId = (await a.client.request('CREATE_ROOM', { nickname: 'A', locale: 'KO' })).data.room.id;
    const b = await user();
    await b.client.request('JOIN_ROOM', { roomId, nickname: 'B' });
    await a.client.next();

    await b.client.close();
    expect((await a.client.next()).data.players[1]).toMatchObject({ id: b.userId, isConnected: false });

    const again = await connect(b.accessToken);
    expect(again.hello.data.room).toMatchObject({ id: roomId, players: [{ id: a.userId }, { id: b.userId, isConnected: true }] });
    expect((await a.client.next()).data.players[1]).toMatchObject({ id: b.userId, isConnected: true });
  });

  it('removes a player who does not come back within the grace period', async () => {
    const a = await user();
    const roomId = (await a.client.request('CREATE_ROOM', { nickname: 'A', locale: 'KO' })).data.room.id;
    const b = await user();
    await b.client.request('JOIN_ROOM', { roomId, nickname: 'B' });
    await a.client.next();

    await a.client.close();
    expect((await b.client.next()).data.players[0]).toMatchObject({ id: a.userId, isConnected: false });
    const removed = await b.client.next();
    expect(removed.data).toMatchObject({ hostId: b.userId, players: [{ id: b.userId }] });
    expect(await playingRoom(a.accessToken)).toBeNull();
  });

  it('a new connection replaces the old one without a disconnect', async () => {
    const a = await user();
    const roomId = (await a.client.request('CREATE_ROOM', { nickname: 'A', locale: 'KO' })).data.room.id;

    const second = await connect(a.accessToken);
    expect(await a.client.closed).toBe(4000);
    expect(second.hello.data.room).toMatchObject({ id: roomId, players: [{ id: a.userId, isConnected: true }] });

    await new Promise((resolve) => setTimeout(resolve, GRACE_MS * 2));
    expect(await playingRoom(a.accessToken)).toBe(roomId);
  });
});
