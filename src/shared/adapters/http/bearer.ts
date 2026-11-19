/** Auth schemes are case-insensitive (RFC 9110), and the app has sent a lowercase `bearer`. */
const BEARER = /^bearer\s+(\S+)$/i;

export function parseBearer(header: string | undefined): string | null {
  return BEARER.exec(header ?? '')?.[1] ?? null;
}
