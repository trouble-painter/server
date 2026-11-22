import { createServer, type Server } from 'node:http';

export const METRICS_PATH = '/metrics';

/** Only loopback, so the tunnel that publishes the game port never reaches it. */
export const METRICS_HOST = '127.0.0.1';

export interface MetricsSource {
  readonly contentType: string;
  render(): Promise<string>;
}

/** A server of its own that serves nothing but the metrics; the caller listens on `METRICS_HOST`. */
export function createMetricsServer(source: MetricsSource): Server {
  return createServer((request, response) => {
    if (request.method !== 'GET' || new URL(request.url ?? '', 'http://localhost').pathname !== METRICS_PATH) {
      response.writeHead(404).end();
      return;
    }
    source.render().then(
      (body) => response.writeHead(200, { 'content-type': source.contentType }).end(body),
      () => response.writeHead(500).end(),
    );
  });
}
