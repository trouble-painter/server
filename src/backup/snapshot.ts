import { createReadStream, createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { DatabaseSync } from 'node:sqlite';
import { createGzip } from 'node:zlib';

/** Tables that are not worth backing up: rooms only hold the live state of the running server. */
const EXCLUDED_TABLES = ['rooms'] as const;

/**
 * Writes a consistent copy of the live database to `snapshotPath` without the excluded tables.
 * The source is opened read-only and `VACUUM INTO` reads it in one transaction, so a running
 * server (WAL mode) keeps writing meanwhile. Never copy the .db file itself: it lacks the WAL.
 */
export function writeSnapshot(sourcePath: string, snapshotPath: string): void {
  const source = new DatabaseSync(sourcePath, { readOnly: true });
  try {
    source.prepare('VACUUM INTO ?').run(snapshotPath);
  } finally {
    source.close();
  }
  const snapshot = new DatabaseSync(snapshotPath);
  try {
    // DELETE mode keeps the snapshot a single file (no -wal/-shm beside it).
    snapshot.exec('PRAGMA journal_mode = DELETE');
    for (const table of EXCLUDED_TABLES) {
      snapshot.exec(`DROP TABLE IF EXISTS ${table}`);
    }
    snapshot.exec('VACUUM');
  } finally {
    snapshot.close();
  }
}

export async function gzipFile(sourcePath: string, targetPath: string): Promise<void> {
  await pipeline(createReadStream(sourcePath), createGzip(), createWriteStream(targetPath));
}
