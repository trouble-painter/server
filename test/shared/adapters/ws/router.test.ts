import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ClientMessageType, ServerMessageType, WireErrorCode } from '../../../../src/shared/adapters/ws/protocol.js';
import { WsRouter } from '../../../../src/shared/adapters/ws/router.js';
import type { UserId } from '../../../../src/shared/domain/user-id.js';

const USER = 1 as UserId;

class KnownError extends Error {}

function newRouter() {
  const logger = { error: vi.fn() };
  const router = new WsRouter(logger, (error) => (error instanceof KnownError ? WireErrorCode.RoomFull : null));
  return { router, logger };
}

const error = (request: string | null, code: WireErrorCode) => ({
  type: ServerMessageType.Error,
  data: { request, code },
});

describe('WsRouter', () => {
  it('validates data and passes it to the handler', () => {
    const { router } = newRouter();
    router.register(ClientMessageType.JoinRoom, z.object({ roomId: z.string() }), (userId, data) => ({
      type: ServerMessageType.Room,
      data: { userId, roomId: data.roomId },
    }));
    expect(router.handle(USER, JSON.stringify({ type: 'JOIN_ROOM', data: { roomId: 'X' } }))).toEqual({
      type: ServerMessageType.Room,
      data: { userId: USER, roomId: 'X' },
    });
    expect(router.handle(USER, JSON.stringify({ type: 'JOIN_ROOM', data: { roomId: 1 } }))).toEqual(
      error('JOIN_ROOM', WireErrorCode.InvalidRequest),
    );
  });

  it('answers INVALID_REQUEST to malformed frames and unknown types', () => {
    const { router } = newRouter();
    expect(router.handle(USER, 'not json')).toEqual(error(null, WireErrorCode.InvalidRequest));
    expect(router.handle(USER, JSON.stringify({ data: {} }))).toEqual(error(null, WireErrorCode.InvalidRequest));
    expect(router.handle(USER, JSON.stringify({ type: 'NOPE', data: {} }))).toEqual(
      error('NOPE', WireErrorCode.InvalidRequest),
    );
  });

  it('maps known errors and hides unknown ones behind INTERNAL', () => {
    const { router, logger } = newRouter();
    router.register(ClientMessageType.CreateRoom, z.object({}), () => {
      throw new KnownError();
    });
    router.register(ClientMessageType.LeaveRoom, z.object({}), () => {
      throw new Error('boom');
    });
    expect(router.handle(USER, JSON.stringify({ type: 'CREATE_ROOM', data: {} }))).toEqual(
      error('CREATE_ROOM', WireErrorCode.RoomFull),
    );
    expect(router.handle(USER, JSON.stringify({ type: 'LEAVE_ROOM', data: {} }))).toEqual(
      error('LEAVE_ROOM', WireErrorCode.Internal),
    );
    expect(logger.error).toHaveBeenCalledOnce();
  });
});
