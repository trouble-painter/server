import type { Locale } from '../../../../shared/domain/locale.js';
import type { KeywordCategory } from '../../domain/keyword.js';

export interface KeywordRepository {
  /** Never empty, and no category is empty. */
  categories(locale: Locale): readonly KeywordCategory[];
}
