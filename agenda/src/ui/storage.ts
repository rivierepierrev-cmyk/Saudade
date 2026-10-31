import type { Agenda, Closure } from '../model.ts';

const KEY = 'agenda.v1';
/** Where the holidays window kept its list before the whole agenda was saved. */
const OLD_CLOSURES_KEY = 'agenda.closures';

/** School year containing `today`: from 1 September to 10 July. */
export function currentSchoolYear(today = new Date()) {
  const y = today.getMonth() >= 7 ? today.getFullYear() : today.getFullYear() - 1;
  return { start: `${y}-09-01`, end: `${y + 1}-07-10` };
}

export function emptyAgenda(today = new Date()): Agenda {
  return { classes: [], timetable: [], sequences: [], placements: [], calendar: { ...currentSchoolYear(today), closures: [] } };
}

function read(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : undefined;
  } catch {
    return undefined;
  }
}

export function loadAgenda(): Agenda {
  const saved = read(KEY) as Partial<Agenda> | undefined;
  const base = emptyAgenda();
  if (saved && typeof saved === 'object') {
    return {
      ...base,
      ...saved,
      calendar: { ...base.calendar, ...saved.calendar, closures: saved.calendar?.closures ?? [] },
    };
  }
  const closures = read(OLD_CLOSURES_KEY);
  return Array.isArray(closures) ? { ...base, calendar: { ...base.calendar, closures: closures as Closure[] } } : base;
}

export function saveAgenda(agenda: Agenda) {
  try {
    localStorage.setItem(KEY, JSON.stringify(agenda));
    localStorage.removeItem(OLD_CLOSURES_KEY);
  } catch {
    // Storage unavailable (private window): changes last for this session only.
  }
}
