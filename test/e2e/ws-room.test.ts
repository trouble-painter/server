import type { FastifyInstance } from 'fastify';
import { pino } from 'pino';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { buildApp } from '../../src/app.js';
import { parseEnv } from '../../src/shared/infrastructure/config/env.js';

const GRACE_MS = 150;
const ENV = parseEnv({ APP_ENV: 'dev', JWT_SECRET: 'x'.repeat(32), WAIT_DISCONNECT_GRACE_MS: String(GRACE_MS) });
const WAIT_MS = 2_000;

interface Message {
  type: string;
  data: any;
}

/** A WebSocket client that buffers what it receives so tests can await messages in order. */
class Client {
  private readonly inbox: Message[] = [];
  private waiter: (() => void) | null = null;
  readonly closed: Promise<number>;

  private constructor(private readonly ws: WebSocket) {
    ws.on('message', (data) => {
      this.inbox.push(JSON.parse(data.toString()));
      this.waiter?.();
    });
    this.closed = new Promise((resolve) => ws.on('close', (code) => resolve(code)));
  }

  static open(url: string, token: string | null): Promise<Client> {
    const headers = token === null ? {} : { authorization: `Bearer ${token}` };
    const ws = new WebSocket(url, { headers });
    const client = new Client(ws);
    return new Promise((resolve, reject) => {
      ws.once('open', () => resolve(client));
      ws.once('unexpected-response', (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
    });
  }

  async next(): Promise<Message> {
    const deadline = Date.now() + WAIT_MS;
    while (this.inbox.length === 0) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        throw new Error('timed out waiting for a message');
      }
      await new Promise<void>((resolve) => {
        this.waiter = resolve;
        setTimeout(resolve, remaining);
      });
      this.waiter = null;
    }
    return this.inbox.shift()!;
  }

  send(type: string, data: unknown = {}): void {
    this.ws.send(JSON.stringify({ type, data }));
  }

  async request(type: string, data: unknown = {}): Promise<Message> {
    this.send(type, data);
    return this.next();
  }

  get pending(): number {
    return this.inbox.length;
  }

  close(): Promise<number> {
    this.ws.close();
    return this.closed;
  }
}

describe('WebSocket rooms', () => {
  let app: FastifyInstance;
  let url: string;
  const clients: Client[] = [];

  beforeEach(async () => {
    app = buildApp(ENV, pino({ enabled: false }));
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
      option: { minPlayers: 3, maxPlayers: 10 },
      phase: { type: 'WAIT' },
      players: [{ id: a.userId, nickname: '아보카도', color: 'RED', isConnected: true }],
    });
    expect(room.id).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);

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

  it('answers errors with the request type and a code', async () => {
    const a = await user();
    expect(await a.client.request('JOIN_ROOM', { roomId: 'ZZZZZZ', nickname: 'A' })).toEqual({
      type: 'ERROR',
      data: { request: 'JOIN_ROOM', code: 'ROOM_NOT_FOUND' },
    });
    expect((await a.client.request('CREATE_ROOM', { nickname: '여덟글자닉네임임', locale: 'KO' })).data.code).toBe(
      'INVALID_REQUEST',
    );
    expect((await a.client.request('CREATE_ROOM', { nickname: 'A', locale: 'ko' })).data.code).toBe('INVALID_REQUEST');
    expect((await a.client.request('LEAVE_ROOM')).data).toEqual({ request: 'LEAVE_ROOM', code: 'NOT_IN_ROOM' });
    expect((await a.client.request('START_GAME')).data).toEqual({ request: 'START_GAME', code: 'INVALID_REQUEST' });
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
