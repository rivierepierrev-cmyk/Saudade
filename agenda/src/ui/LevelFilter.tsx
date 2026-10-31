import { useState } from 'react';
import { LEVELS } from '../levels.ts';

const KEY = 'agenda.levelFilter';

/** The chosen level filter, remembered on this device; '' shows everything. */
export function useLevelFilter(levels: string[]): [string, (level: string) => void] {
  const [value, setValue] = useState(() => {
    try {
      return localStorage.getItem(KEY) ?? '';
    } catch {
      return '';
    }
  });
  const set = (level: string) => {
    setValue(level);
    try {
      localStorage.setItem(KEY, level);
    } catch {
      // Not remembered: fine.
    }
  };
  // A level that no longer exists shows everything.
  return [levels.includes(value) ? value : '', set];
}

/** « Tous · 6e · 4e … » chips; hidden when there is at most one level. */
export function LevelFilter({ levels, value, onChange }: { levels: string[]; value: string; onChange: (level: string) => void }) {
  if (levels.length < 2) return null;
  return (
    <div className="level-filter" role="radiogroup" aria-label="Niveau">
      {['', ...levels].map((l) => (
        <button key={l || 'all'} type="button" role="radio" aria-checked={value === l} onClick={() => onChange(l)}>
          {l || 'Tous'}
        </button>
      ))}
    </div>
  );
}

/** Suggestions for every « Niveau » field (free text is accepted too). */
export function LevelOptions() {
  return (
    <datalist id="levels">
      {LEVELS.map((l) => <option key={l} value={l} />)}
    </datalist>
  );
}
