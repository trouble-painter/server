import type { FastifyInstance } from 'fastify';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pino } from 'pino';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { testEnv } from '../support/env.js';
import { Client, type Message } from '../support/ws-client.js';

/** Phase timers short enough to run out within a test; turns are long so tests end them explicitly. */
const FAST = {
  GAME_READY_MS: '50',
  GAME_INTRO_ANIMATION_MS: '0',
  GAME_ROUND_ANIMATION_MS: '0',
  GAME_ROUNDS: '1',
  GAME_TURN_MS: '5000',
  GAME_VOTE_MS: '5000',
  GAME_ANSWER_MS: '5000',
  GAME_END_MS: '5000',
};

const STROKE = { x: [1, 2], y: [3, 4], t: [0, 16] };
const CANVAS = { w: 335, h: 425 };

interface Player {
  userId: number;
  accessToken: string;
  client: Client;
}

describe('WebSocket game', () => {
  let app: FastifyInstance;
  let url: string;
  const clients: Client[] = [];

  afterEach(async () => {
    await Promise.all(clients.splice(0).map((c) => c.close()));
    await app.close();
  });

  async function boot(overrides: Record<string, string> = {}): Promise<void> {
    const env = testEnv({ ...FAST, ...overrides });
    app = buildApp(env, pino({ enabled: false }));
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

  /** Three players in one waiting room, every queued message drained. */
  async function threePlayers(): Promise<[Player, Player, Player]> {
    const host = await user();
    const roomId = (await host.client.request('CREATE_ROOM', { nickname: 'A', locale: 'KO' })).data.room.id;
    const b = await user();
    await b.client.request('JOIN_ROOM', { roomId, nickname: 'B' });
    await host.client.next();
    const c = await user();
    await c.client.request('JOIN_ROOM', { roomId, nickname: 'C' });
    await host.client.next();
    await b.client.next();
    return [host, b, c];
  }

  async function expectNext(players: Player[], type: string): Promise<Message[]> {
    const messages = await Promise.all(players.map((p) => p.client.next()));
    expect(messages.map((m) => m.type)).toEqual(players.map(() => type));
    return messages;
  }

  /** Starts the game and waits for the first turn; returns players keyed by role and the turn order. */
  async function startGame(players: Player[]) {
    players[0]!.client.send('START_GAME');
    const ready = await expectNext(players, 'ROOM');
    const roles = ready.map((m) => m.data.room.phase.game.role);
    expect(roles.filter((r) => r === 'MAFIA')).toHaveLength(1);
    const mafia = players[roles.indexOf('MAFIA')]!;
    const drawing = await expectNext(players, 'ROOM');
    const phase = drawing[0]!.data.room.phase;
    expect(phase.type).toBe('DRAWING');
    const byId = (id: number) => players.find((p) => p.userId === id)!;
    return { mafia, ready, order: (phase.game.turnOrder as number[]).map(byId), turn: phase.turn };
  }

  it('plays a game from START_GAME to PLAY_AGAIN', async () => {
    await boot();
    const players = await threePlayers();
    const { mafia, ready, order, turn } = await startGame(players);

    for (const [i, message] of ready.entries()) {
      const game = message.data.room.phase.game;
      expect(game.category).toMatch(/^(동물|음식)$/);
      expect(game.keyword === null).toBe(players[i] === mafia);
    }
    expect(turn).toMatchObject({ round: 0, turn: 0, drawerId: order[0]!.userId });

    // Each drawer draws one stroke and ends the turn; the others see the stroke, everyone sees TURN.
    for (const [i, drawer] of order.entries()) {
      drawer.client.send('DRAW_STROKE', { index: 0, stroke: STROKE, canvas: CANVAS });
      const watchers = players.filter((p) => p !== drawer);
      for (const message of await expectNext(watchers, 'STROKE')) {
        expect(message.data).toEqual({ index: 0, stroke: STROKE, canvas: CANVAS });
      }
      drawer.client.send('END_TURN');
      if (i < order.length - 1) {
        const [next] = await expectNext(players, 'TURN');
        expect(next!.data.turn.drawerId).toBe(order[i + 1]!.userId);
        expect(next!.data.sketch).toEqual({ userId: drawer.userId, canvas: CANVAS, strokes: [STROKE] });
      }
    }
    const [vote] = await expectNext(players, 'ROOM');
    expect(vote!.data.room.phase).toMatchObject({ type: 'VOTE', votes: {} });
    expect(vote!.data.room.phase.sketches).toHaveLength(3);

    const citizens = players.filter((p) => p !== mafia);
    for (const citizen of citizens) {
      citizen.client.send('VOTE', { targetId: mafia.userId });
      await expectNext(players, 'VOTES');
    }
    mafia.client.send('VOTE', { targetId: citizens[0]!.userId });
    const [votes] = await expectNext(players, 'VOTES');
    expect(Object.keys(votes!.data.votes)).toHaveLength(3);
    const [answer] = await expectNext(players, 'ROOM');
    expect(answer!.data.room.phase).toMatchObject({ type: 'ANSWER', accusedId: mafia.userId, typing: '' });

    mafia.client.send('TYPE_ANSWER', { answer: '모름' });
    for (const message of await expectNext(citizens, 'ANSWER_TYPING')) {
      expect(message.data).toEqual({ answer: '모름' });
    }
    mafia.client.send('SUBMIT_ANSWER', { answer: '모름' });
    const end = await expectNext(players, 'ROOM');
    expect(end[0]!.data.room.phase).toMatchObject({
      type: 'END',
      result: { mafiaId: mafia.userId, accusedId: mafia.userId, mafiaGuess: '모름', winner: 'CITIZEN' },
    });
    expect(end[0]!.data.room.phase.result.answer).toBe(ready[0]!.data.room.phase.game.keyword ?? ready[1]!.data.room.phase.game.keyword);

    citizens[1]!.client.send('PLAY_AGAIN');
    const wait = await expectNext(players, 'ROOM');
    expect(wait[0]!.data.room.phase).toEqual({ type: 'WAIT' });
    expect(players.every((p) => p.client.pending === 0)).toBe(true);
  });

  it('runs on deadlines alone: an empty vote lets the mafia win, then the room waits again', async () => {
    await boot({ GAME_TURN_MS: '30', GAME_VOTE_MS: '30', GAME_END_MS: '30' });
    const players = await threePlayers();
    const { mafia } = await startGame(players);
    await expectNext(players, 'TURN');
    await expectNext(players, 'TURN');
    expect((await expectNext(players, 'ROOM'))[0]!.data.room.phase.type).toBe('VOTE');
    const [end] = await expectNext(players, 'ROOM');
    expect(end!.data.room.phase.result).toMatchObject({ mafiaId: mafia.userId, accusedId: null, winner: 'MAFIA' });
    expect((await expectNext(players, 'ROOM'))[0]!.data.room.phase).toEqual({ type: 'WAIT' });
  });

  it('a reconnecting player gets the turn in progress, with their own view', async () => {
    await boot();
    const players = await threePlayers();
    const { mafia, order } = await startGame(players);
    const drawer = order[0]!;
    drawer.client.send('DRAW_STROKE', { index: 0, stroke: STROKE, canvas: CANVAS });
    const watchers = players.filter((p) => p !== drawer);
    await expectNext(watchers, 'STROKE');

    const away = watchers[0]!;
    await away.client.close();
    await expectNext(players.filter((p) => p !== away), 'PLAYERS');
    const { client, hello } = await connect(away.accessToken);
    away.client = client;
    expect(hello.data.limits).toEqual({ drawThrottleMs: 50, reactionThrottleMs: 500, maxStrokePoints: 500, maxAnswerLength: 20 });
    expect(hello.data.room.phase).toMatchObject({
      type: 'DRAWING',
      turn: { drawerId: drawer.userId },
      current: { userId: drawer.userId, strokes: [STROKE] },
      game: { role: away === mafia ? 'MAFIA' : 'CITIZEN' },
    });
  });

  it('answers game requests that break the rules with a code', async () => {
    await boot();
    const host = await user();
    const roomId = (await host.client.request('CREATE_ROOM', { nickname: 'A', locale: 'KO' })).data.room.id;
    expect((await host.client.request('START_GAME')).data.code).toBe('NOT_ENOUGH_PLAYERS');
    const b = await user();
    await b.client.request('JOIN_ROOM', { roomId, nickname: 'B' });
    const c = await user();
    await c.client.request('JOIN_ROOM', { roomId, nickname: 'C' });
    await host.client.next();
    await host.client.next();
    await b.client.next();
    expect((await b.client.request('START_GAME')).data.code).toBe('NOT_HOST');
    expect((await b.client.request('VOTE', { targetId: host.userId })).data.code).toBe('INVALID_PHASE');

    const players = [host, b, c];
    const { order } = await startGame(players);
    expect((await order[1]!.client.request('END_TURN')).data.code).toBe('NOT_YOUR_TURN');
    const points = Array.from({ length: 501 }, (_, i) => i);
    const tooLong = await order[0]!.client.request('DRAW_STROKE', { index: 0, stroke: { x: points, y: points, t: points }, canvas: CANVAS });
    expect(tooLong.data.code).toBe('INVALID_REQUEST');
    const refused = await order[0]!.client.request('DRAW_STROKE', { index: 0, stroke: { ...STROKE, t: [0] }, canvas: CANVAS });
    expect(refused.data.code).toBe('INVALID_REQUEST');
    expect((await order[0]!.client.request('DRAW_STROKE', { index: 1, stroke: STROKE, canvas: CANVAS })).data.code).toBe(
      'INVALID_REQUEST',
    );
    expect((await order[0]!.client.request('REACTION', { reaction: 'NOPE' })).data.code).toBe('INVALID_REQUEST');
  });

  it('leaving a game in progress keeps the seat until the game is over', async () => {
    await boot();
    const players = await threePlayers();
    await startGame(players);
    const leaver = players[1];
    expect(await leaver.client.request('LEAVE_ROOM')).toEqual({ type: 'IDLE', data: { reason: 'LEFT' } });
    const [host, , stayer] = players;
    const others = [host, stayer];
    const [patch] = await expectNext(others, 'PLAYERS');
    expect(patch!.data.players[1]).toMatchObject({ id: leaver.userId, isConnected: false });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/playing-room',
      headers: { authorization: `Bearer ${leaver.accessToken}` },
    });
    expect(res.json().roomId).not.toBeNull();
    host.client.send('REACTION', { reaction: 'HEART' });
    expect((await stayer.client.next()).type).toBe('REACTION');
    expect(leaver.client.pending).toBe(0);
  });

  it('picks a game up again after a restart: everyone reconnects to the same turn', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'restart-'));
    const db = { SQLITE_PATH: join(dir, 'rooms.db') };
    try {
      await boot(db);
      const players = await threePlayers();
      const { mafia, order } = await startGame(players);
      const [first, second] = order as [Player, Player, Player];
      first.client.send('DRAW_STROKE', { index: 0, stroke: STROKE, canvas: CANVAS });
      await expectNext(players.filter((p) => p !== first), 'STROKE');
      first.client.send('END_TURN');
      await expectNext(players, 'TURN');

      await app.close();
      expect(await Promise.all(players.map((p) => p.client.closed))).toEqual([1001, 1001, 1001]);
      await boot(db);

      for (const [i, player] of players.entries()) {
        const { client, hello } = await connect(player.accessToken);
        player.client = client;
        expect(hello.data.room.phase).toMatchObject({
          type: 'DRAWING',
          turn: { round: 0, turn: 1, drawerId: second.userId },
          sketches: [{ userId: first.userId, canvas: CANVAS, strokes: [STROKE] }],
          game: { role: player === mafia ? 'MAFIA' : 'CITIZEN' },
        });
        expect(hello.data.room.players.filter((p: { isConnected: boolean }) => p.isConnected)).toHaveLength(i + 1);
        await Promise.all(players.slice(0, i).map((p) => p.client.next()));
      }

      second.client.send('END_TURN');
      const [turn] = await expectNext(players, 'TURN');
      expect(turn!.data.turn).toMatchObject({ turn: 2, drawerId: order[2]!.userId });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
