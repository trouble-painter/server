import { WebSocket } from 'ws';

const WAIT_MS = 2_000;

export interface Message {
  type: string;
  data: any;
}

/** A WebSocket client that buffers what it receives so tests can await messages in order. */
export class Client {
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
