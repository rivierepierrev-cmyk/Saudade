/** French school levels, in order; any other text is accepted as a level too. */
export const LEVELS = ['PS', 'MS', 'GS', 'CP', 'CE1', 'CE2', 'CM1', 'CM2', '6e', '5e', '4e', '3e', '2nde', '1re', 'Tle', 'BTS'];

const PATTERNS: [RegExp, string][] = [
  [/^(6|5|4|3)\s*(e|è|ème|eme)(?![a-z])/i, '$1e'],
  [/^(2\s*(nde|nd|de)|seconde)(?![a-z])/i, '2nde'],
  [/^(1\s*(re|ère|ere|er)|premi[eè]re)(?![a-z])/i, '1re'],
  [/^(t\s*le|tale|term(inale)?)(?![a-z])/i, 'Tle'],
  [/^(cp|ce1|ce2|cm1|cm2|ps|ms|gs|bts)(?![a-z])/i, '$1'],
];

/** The level a class name starts with: « 6e B » → 6e, « 2nde 3 » → 2nde, « Tle S » → Tle. */
export function guessLevel(name: string): string | undefined {
  const n = name.trim();
  for (const [re, out] of PATTERNS) {
    const m = re.exec(n);
    if (m) {
      const level = m[0].replace(re, out);
      return /^[a-z]/i.test(level) && level !== 'Tle' && level !== '2nde' && level !== '1re' ? level.toUpperCase() : level;
    }
  }
  return undefined;
}

/** Sort key: known levels in school order, then the others alphabetically, then none. */
export function levelRank(level: string | undefined): string {
  if (!level) return '~';
  const i = LEVELS.indexOf(level);
  return i === -1 ? `z${level.toLowerCase()}` : String(i).padStart(3, '0');
}

/** A séquence of a level placed on a class of another level (both known). */
export const levelMismatch = (sequenceLevel?: string, classLevel?: string) =>
  Boolean(sequenceLevel && classLevel && sequenceLevel.trim().toLowerCase() !== classLevel.trim().toLowerCase());

/** The levels used by classes and séquences, in school order. */
export function levelsIn(items: { level?: string }[]): string[] {
  return [...new Set(items.map((x) => x.level?.trim()).filter((l): l is string => Boolean(l)))].sort((a, b) => (levelRank(a) < levelRank(b) ? -1 : 1));
}
