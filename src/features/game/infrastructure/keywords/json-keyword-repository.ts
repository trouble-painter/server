import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { BaseLogger } from 'pino';
import { z } from 'zod';
import { Locale } from '../../../../shared/domain/locale.js';
import type { KeywordRepository } from '../../application/ports/keyword-repository.js';
import type { KeywordCategory } from '../../domain/keyword.js';

/** Keywords and synonyms are single words; whitespace anywhere fails the boot. */
const word = z.string().regex(/^\S+$/, 'must be one word without whitespace');
const keyword = z.object({ word, synonyms: z.array(word) });

const categoryId = z.string().regex(/^[a-z]+(-[a-z]+)*$/, 'must be lowercase words joined by hyphens');

const KeywordFileSchema = z
  .array(z.object({ id: categoryId, category: z.string().trim().min(1), keywords: z.array(keyword).min(1) }))
  .min(1)
  .refine((categories) => new Set(categories.map((c) => c.id)).size === categories.length, 'category ids must be unique');

type KeywordsByLocale = ReadonlyMap<Locale, readonly KeywordCategory[]>;

/**
 * Reads `<dir>/<locale>.json` for every locale at boot, where a missing or malformed file fails the boot. Afterwards every lookup checks whether a file was
 * replaced and reads them all again, so keywords can be uploaded without a restart. A set of files that fails to read is logged and the last good one kept.
 */
export class JsonKeywordRepository implements KeywordRepository {
  private constructor(
    private readonly dir: string,
    private readonly logger: Pick<BaseLogger, 'info' | 'error'>,
    private byLocale: KeywordsByLocale,
    private stamp: string,
  ) {}

  static load(dir: string, logger: Pick<BaseLogger, 'info' | 'error'>): JsonKeywordRepository {
    const stamp = fileStamp(dir);
    return new JsonKeywordRepository(dir, logger, readKeywordFiles(dir), stamp);
  }

  categories(locale: Locale): readonly KeywordCategory[] {
    this.reloadIfChanged();
    return this.byLocale.get(locale) ?? [];
  }

  /** The stamp is taken before reading, so a file replaced mid-read changes it again and is read on the next lookup. */
  private reloadIfChanged(): void {
    try {
      const stamp = fileStamp(this.dir);
      if (stamp === this.stamp) {
        return;
      }
      this.stamp = stamp;
      this.byLocale = readKeywordFiles(this.dir);
      this.logger.info({ dir: this.dir }, 'keywords reloaded');
    } catch (error) {
      this.logger.error({ dir: this.dir, err: error }, 'keyword reload failed; keeping the previous keywords');
    }
  }
}

/** Reads and validates every locale file; throws on the first problem. Also run by the keyword upload script before it uploads. */
export function readKeywordFiles(dir: string): KeywordsByLocale {
  const byLocale = new Map<Locale, readonly KeywordCategory[]>();
  for (const locale of Object.values(Locale)) {
    const file = join(dir, `${locale}.json`);
    const parsed = KeywordFileSchema.safeParse(JSON.parse(readFileSync(file, 'utf8')));
    if (!parsed.success) {
      throw new Error(`Invalid keyword file ${file}:\n${z.prettifyError(parsed.error)}`);
    }
    byLocale.set(locale, parsed.data);
  }
  assertSameCategoryIds(byLocale);
  return byLocale;
}

/** Changes whenever a locale file is replaced (new inode) or rewritten (new mtime or size). */
function fileStamp(dir: string): string {
  return Object.values(Locale)
    .map((locale) => {
      const { ino, mtimeMs, size } = statSync(join(dir, `${locale}.json`));
      return `${ino}:${mtimeMs}:${size}`;
    })
    .join(',');
}

/** A room's rule names categories by id, so every locale must offer the same ones. */
function assertSameCategoryIds(byLocale: KeywordsByLocale): void {
  const idsOf = (categories: readonly KeywordCategory[]) => categories.map((c) => c.id).sort().join(',');
  const [first, ...rest] = [...byLocale.entries()];
  if (first === undefined) {
    return;
  }
  for (const [locale, categories] of rest) {
    if (idsOf(categories) !== idsOf(first[1])) {
      throw new Error(`Keyword file ${locale} has different category ids from ${first[0]}`);
    }
  }
}
