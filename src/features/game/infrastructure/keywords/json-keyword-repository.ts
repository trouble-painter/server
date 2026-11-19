import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { Locale } from '../../../../shared/domain/locale.js';
import type { KeywordRepository } from '../../application/ports/keyword-repository.js';
import type { KeywordCategory } from '../../domain/keyword.js';

const KeywordFileSchema = z
  .array(z.object({ category: z.string().trim().min(1), keywords: z.array(z.string().trim().min(1)).min(1) }))
  .min(1);

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
    return new JsonKeywordRepository(byLocale);
  }

  categories(locale: Locale): readonly KeywordCategory[] {
    return this.byLocale.get(locale) ?? [];
  }
}
