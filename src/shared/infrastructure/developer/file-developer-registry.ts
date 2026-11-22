import { readFileSync } from 'node:fs';

/**
 * Developer uuids kept one per line (`#` starts a comment, whole-line or trailing) in a file that is read on every lookup, so an operator can add or remove one
 * on the server without a deploy or restart. A missing file means no developers.
 */
export class FileDeveloperRegistry {
  constructor(private readonly path: string) {}

  has(uuid: string): boolean {
    return this.read().has(uuid);
  }

  private read(): Set<string> {
    try {
      const lines = readFileSync(this.path, 'utf8').split('\n');
      return new Set(lines.map((line) => line.split('#')[0]!.trim()).filter((line) => line !== ''));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return new Set();
      }
      throw error;
    }
  }
}
