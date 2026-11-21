import type { FastifyInstance } from 'fastify';
import { ROOM_CODE_LENGTH } from '../../domain/room-code.js';

/** Values the app needs before it can open a socket (so before `HELLO`); it keeps no copy of them. */
export function registerConfigRoute(http: FastifyInstance): void {
  http.get('/api/v1/config', async () => ({ roomCodeLength: ROOM_CODE_LENGTH }));
}
