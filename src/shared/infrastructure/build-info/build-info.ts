import { readFileSync } from 'node:fs';
import { z } from 'zod';

const BuildInfoSchema = z.object({ version: z.string().min(1) });

/** The version written next to the compiled code by scripts/write-build-info.mjs. */
export function loadServerVersion(): string {
  const file = new URL('../../../build-info.json', import.meta.url);
  try {
    return BuildInfoSchema.parse(JSON.parse(readFileSync(file, 'utf8'))).version;
  } catch (error) {
    throw new Error(`Cannot read the build version from ${file.pathname}; run "npm run build" (${error instanceof Error ? error.message : error})`);
  }
}
