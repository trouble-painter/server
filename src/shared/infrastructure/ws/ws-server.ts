import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import type { BaseLogger } from 'pino';
import { WebSocket, WebSocketServer } from 'ws';
import { CloseCode, type ServerMessage } from '../../adapters/ws/protocol.js';
import type { SessionGateway } from '../../adapters/ws/session-gateway.js';
import type { UserId } from '../../domain/user-id.js';

export interface WsServerOptions {
  path: string;
  pingIntervalMs: number;
  maxMessageBytes: number;
  ratePerSec: number;
  rateBurst: number;
}

export interface WsHandlers {
  /** Receives the raw `Authorization` header of the upgrade request. */
  authenticate(authorization: string | undefined): Promise<UserId | null>;
  /** Returns the first message for the new connection. */
  onConnect(userId: UserId): ServerMessage;
  /** Returns the reply for the sender, if any. */
  onMessage(userId: UserId, text: string): ServerMessage | null;
  onDisconnect(userId: UserId): void;
}

interface Connection {
  readonly ws: WebSocket;
  readonly bucket: TokenBucket;
  isAlive: boolean;
  /** Requests dropped in a row by the rate limit. */
  drops: number;
}

/**
 * Authenticates on upgrade, keeps one connection per user (a new one replaces the old),
 * detects dead peers with ping/pong, and rate-limits requests per connection.
 */
export class WsServer implements SessionGateway {
  private readonly wss: WebSocketServer;
  private readonly connections = new Map<UserId, Connection>();
  private pingTimer: NodeJS.Timeout | undefined;
  private closing = false;

  constructor(
    private readonly options: WsServerOptions,
    private readonly logger: Pick<BaseLogger, 'debug' | 'error'>,
  ) {
    this.wss = new WebSocketServer({ noServer: true, maxPayload: options.maxMessageBytes });
  }

  listen(server: Server, handlers: WsHandlers): void {
    server.on('upgrade', (request: IncomingMessage, socket: Duplex, head: Buffer) => {
      void this.upgrade(request, socket, head, handlers);
    });
    this.pingTimer = setInterval(() => this.ping(), this.options.pingIntervalMs);
  }

  get connectionCount(): number {
    return this.connections.size;
  }

  send(userId: UserId, message: ServerMessage): void {
    const connection = this.connections.get(userId);
    if (connection?.ws.readyState === WebSocket.OPEN) {
      connection.ws.send(JSON.stringify(message));
    }
  }

  /** Closes every connection without treating it as a disconnect: the process is going away, not the users. */
  close(): void {
    this.closing = true;
    clearInterval(this.pingTimer);
    for (const { ws } of this.connections.values()) {
      ws.close(CloseCode.GoingAway);
    }
    this.connections.clear();
    this.wss.close();
  }

  private async upgrade(request: IncomingMessage, socket: Duplex, head: Buffer, handlers: WsHandlers): Promise<void> {
    if (new URL(request.url ?? '', 'http://localhost').pathname !== this.options.path) {
      return reject(socket, '404 Not Found');
    }
    const userId = await handlers.authenticate(request.headers.authorization);
    if (userId === null) {
      return reject(socket, '401 Unauthorized');
    }
    if (this.closing || socket.destroyed) {
      return void socket.destroy();
    }
    this.wss.handleUpgrade(request, socket, head, (ws) => this.accept(userId, ws, handlers));
  }

  private accept(userId: UserId, ws: WebSocket, handlers: WsHandlers): void {
    const connection: Connection = {
      ws,
      bucket: new TokenBucket(this.options.ratePerSec, this.options.rateBurst),
      isAlive: true,
      drops: 0,
    };
    const previous = this.connections.get(userId);
    this.connections.set(userId, connection);
    previous?.ws.close(CloseCode.Replaced);

    ws.on('pong', () => {
      connection.isAlive = true;
    });
    ws.on('message', (data) => this.receive(userId, connection, data.toString(), handlers));
    ws.on('error', (error) => this.logger.debug({ err: error, userId }, 'ws error'));
    ws.on('close', () => {
      // A replaced connection closes after its successor took over; that is not a disconnect.
      if (this.closing || this.connections.get(userId) !== connection) {
        return;
      }
      this.connections.delete(userId);
      this.guard(userId, () => handlers.onDisconnect(userId));
    });

    this.guard(userId, () => this.send(userId, handlers.onConnect(userId)));
  }

  private receive(userId: UserId, connection: Connection, text: string, handlers: WsHandlers): void {
    if (!connection.bucket.take()) {
      connection.drops++;
      if (connection.drops >= this.options.rateBurst) {
        connection.ws.close(CloseCode.RateLimited);
      }
      return;
    }
    connection.drops = 0;
    const reply = handlers.onMessage(userId, text);
    if (reply !== null) {
      this.send(userId, reply);
    }
  }

  private ping(): void {
    for (const connection of this.connections.values()) {
      if (!connection.isAlive) {
        connection.ws.terminate();
        continue;
      }
      connection.isAlive = false;
      connection.ws.ping();
    }
  }

  /** Keeps a failing handler from taking down the process. */
  private guard(userId: UserId, run: () => void): void {
    try {
      run();
    } catch (error) {
      this.logger.error({ err: error, userId }, 'ws connection handler failed');
    }
  }
}

function reject(socket: Duplex, status: string): void {
  socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}

class TokenBucket {
  private tokens: number;
  private updatedAt = Date.now();

  constructor(
    private readonly perSec: number,
    private readonly burst: number,
  ) {
    this.tokens = burst;
  }

  take(): boolean {
    const now = Date.now();
    this.tokens = Math.min(this.burst, this.tokens + ((now - this.updatedAt) * this.perSec) / 1000);
    this.updatedAt = now;
    if (this.tokens < 1) {
      return false;
    }
    this.tokens -= 1;
    return true;
  }
}
