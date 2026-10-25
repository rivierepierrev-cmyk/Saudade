/** Lowercase and remove accents, so "repetition" matches "Répétition". */
export function normalizeForSearch(text: string): string {
  return text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

/**
 * True when every word of `query` appears in at least one of `fields`
 * (case- and accent-insensitive). An empty query matches everything.
 */
export function matchesQuery(query: string, fields: Array<string | undefined | null>): boolean {
  const words = normalizeForSearch(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = normalizeForSearch(fields.filter(Boolean).join('\n'));
  return words.every((w) => haystack.includes(w));
}
