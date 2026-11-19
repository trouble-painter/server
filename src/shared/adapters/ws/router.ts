import type { BaseLogger } from 'pino';
import { z } from 'zod';
import type { UserId } from '../../domain/user-id.js';
import { errorMessage, WireErrorCode, type ClientMessageType, type ServerMessage } from './protocol.js';

const FrameSchema = z.object({ type: z.string(), data: z.unknown() });

/** Returns the reply for the sender, or null when the sender needs none. */
type Handler<T> = (userId: UserId, data: T) => ServerMessage | null;

/** Maps an error thrown by a use case to a wire code; null when the error is not a known domain error. */
export type ErrorMapper = (error: unknown) => WireErrorCode | null;

class InvalidRequest extends Error {}

export class WsRouter {
  private readonly handlers = new Map<string, Handler<unknown>>();

  constructor(
    private readonly logger: Pick<BaseLogger, 'error'>,
    private readonly mapError: ErrorMapper,
  ) {}

  register<S extends z.ZodType>(type: ClientMessageType, schema: S, handler: Handler<z.output<S>>): void {
    this.handlers.set(type, (userId, data) => {
      const parsed = schema.safeParse(data);
      if (!parsed.success) {
        throw new InvalidRequest();
      }
      return handler(userId, parsed.data);
    });
  }

  handle(userId: UserId, text: string): ServerMessage | null {
    const frame = parseFrame(text);
    if (frame === null) {
      return errorMessage(null, WireErrorCode.InvalidRequest);
    }
    const handler = this.handlers.get(frame.type);
    if (handler === undefined) {
      return errorMessage(frame.type, WireErrorCode.InvalidRequest);
    }
    try {
      return handler(userId, frame.data);
    } catch (error) {
      if (error instanceof InvalidRequest) {
        return errorMessage(frame.type, WireErrorCode.InvalidRequest);
      }
      const code = this.mapError(error);
      if (code !== null) {
        return errorMessage(frame.type, code);
      }
      this.logger.error({ err: error, userId, type: frame.type }, 'ws request failed');
      return errorMessage(frame.type, WireErrorCode.Internal);
    }
  }
}

function parseFrame(text: string): z.output<typeof FrameSchema> | null {
  try {
    const frame = FrameSchema.safeParse(JSON.parse(text));
    return frame.success ? frame.data : null;
  } catch {
    return null;
  }
}
