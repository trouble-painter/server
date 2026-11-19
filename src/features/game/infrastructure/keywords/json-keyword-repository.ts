import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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

/** Reads `<dir>/<locale>.json` for every locale once at boot; a missing or malformed file fails the boot. */
export class JsonKeywordRepository implements KeywordRepository {
  private constructor(private readonly byLocale: ReadonlyMap<Locale, readonly KeywordCategory[]>) {}

  static load(dir: string): JsonKeywordRepository {
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
    return new JsonKeywordRepository(byLocale);
  }

  categories(locale: Locale): readonly KeywordCategory[] {
    return this.byLocale.get(locale) ?? [];
  }
}

/** A room's rule names categories by id, so every locale must offer the same ones. */
function assertSameCategoryIds(byLocale: ReadonlyMap<Locale, readonly KeywordCategory[]>): void {
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
