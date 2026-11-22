import { readFileSync } from 'node:fs';
import { z } from 'zod';

const BuildInfoSchema = z.object({ version: z.string().min(1), commit: z.string().min(1) });

export type BuildInfo = z.infer<typeof BuildInfoSchema>;

/** What scripts/write-build-info.mjs wrote next to the compiled code: the release version and the commit it was built from. */
export function loadBuildInfo(): BuildInfo {
  const file = new URL('../../../build-info.json', import.meta.url);
  try {
    return BuildInfoSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
  } catch (error) {
    throw new Error(`Cannot read the build info from ${file.pathname}; run "npm run build" (${error instanceof Error ? error.message : error})`);
  }
}
