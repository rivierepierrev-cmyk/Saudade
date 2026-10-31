import { minutes, type ISODate } from './dates.ts';
import type { Agenda, Seance, SchoolClass, Sequence, TimetableSlot } from './model.ts';

/**
 * Editing operations on the agenda. Each returns a new agenda and leaves the one it is given
 * untouched, so the screens can keep the previous version (cancel, and later undo).
 */

let counter = 0;
export const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(counter++).toString(36)}`;

/** Colours given in turn to new classes and séquences; readable with dark text in light mode and light text in dark mode. */
export const PALETTE = ['#4f7cff', '#e8833a', '#2fa36b', '#c94f7c', '#8a63d2', '#d1a516', '#2aa1b3', '#d0533f'];

function nextColor(used: (string | undefined)[]): string {
  const counts = PALETTE.map((c) => used.filter((u) => u === c).length);
  return PALETTE[counts.indexOf(Math.min(...counts))];
}

// Classes

export function addClass(agenda: Agenda, name: string): { agenda: Agenda; id: string } {
  const id = newId('class');
  const cls: SchoolClass = { id, name: name.trim() || 'Nouvelle classe', color: nextColor(agenda.classes.map((c) => c.color)) };
  return { agenda: { ...agenda, classes: [...agenda.classes, cls] }, id };
}

export function updateClass(agenda: Agenda, id: string, change: Partial<Omit<SchoolClass, 'id'>>): Agenda {
  return { ...agenda, classes: agenda.classes.map((c) => (c.id === id ? { ...c, ...change } : c)) };
}

/** Removes the class with its timetable, its placed séquences and its one-off lessons. The séquences themselves stay. */
export function removeClass(agenda: Agenda, id: string): Agenda {
  const slotIds = new Set(agenda.timetable.filter((s) => s.classId === id).map((s) => s.id));
  return {
    ...agenda,
    classes: agenda.classes.filter((c) => c.id !== id),
    timetable: agenda.timetable.filter((s) => s.classId !== id),
    placements: agenda.placements.filter((p) => p.classId !== id),
    cancellations: agenda.cancellations?.filter((c) => !slotIds.has(c.slotId)),
    extraSlots: agenda.extraSlots?.filter((x) => x.classId !== id),
  };
}

// Timetable

export function addSlot(agenda: Agenda, slot: Omit<TimetableSlot, 'id'>): { agenda: Agenda; id: string } {
  const id = newId('slot');
  return { agenda: { ...agenda, timetable: [...agenda.timetable, { ...slot, id }] }, id };
}

export function updateSlot(agenda: Agenda, id: string, change: Partial<Omit<TimetableSlot, 'id'>>): Agenda {
  return { ...agenda, timetable: agenda.timetable.map((s) => (s.id === id ? { ...s, ...change } : s)) };
}

export function removeSlot(agenda: Agenda, id: string): Agenda {
  return {
    ...agenda,
    timetable: agenda.timetable.filter((s) => s.id !== id),
    cancellations: agenda.cancellations?.filter((c) => c.slotId !== id),
  };
}

const rangesMeet = (aFrom?: ISODate, aTo?: ISODate, bFrom?: ISODate, bTo?: ISODate) =>
  (!aFrom || !bTo || aFrom <= bTo) && (!bFrom || !aTo || bFrom <= aTo);

/**
 * Lessons of the timetable at the same time as `slot`, whatever the class: a teacher cannot be in two
 * rooms. An A-week lesson does not clash with a B-week one, nor lessons valid over separate periods.
 */
export function slotConflicts(timetable: TimetableSlot[], slot: Omit<TimetableSlot, 'id'> & { id?: string }): TimetableSlot[] {
  const start = minutes(slot.start);
  const end = minutes(slot.end);
  return timetable.filter(
    (s) =>
      s.id !== slot.id &&
      s.weekday === slot.weekday &&
      minutes(s.start) < end &&
      start < minutes(s.end) &&
      !(s.week && slot.week && s.week !== slot.week) &&
      rangesMeet(s.validFrom, s.validTo, slot.validFrom, slot.validTo),
  );
}

/**
 * Lessons a class has in a normal week, on a given date. With A/B weeks, a lesson of one week counts
 * for half. `minutes` is the teaching time, counted the same way.
 */
export function weeklyLessons(agenda: Agenda, classId: string, on: ISODate = agenda.calendar.start): { lessons: number; minutes: number } {
  const ab = Boolean(agenda.calendar.abWeeks);
  let lessons = 0;
  let total = 0;
  for (const s of agenda.timetable) {
    if (s.classId !== classId) continue;
    if ((s.validFrom && on < s.validFrom) || (s.validTo && on > s.validTo)) continue;
    const weight = ab && s.week ? 0.5 : 1;
    lessons += weight;
    total += weight * (minutes(s.end) - minutes(s.start));
  }
  return { lessons, minutes: total };
}

// Séquences

export function addSequence(agenda: Agenda, title: string): { agenda: Agenda; id: string } {
  const id = newId('seq');
  const sequence: Sequence = { id, title: title.trim() || 'Nouvelle séquence', color: nextColor(agenda.sequences.map((s) => s.color)), seances: [] };
  return { agenda: { ...agenda, sequences: [...agenda.sequences, sequence] }, id };
}

export function updateSequence(agenda: Agenda, id: string, change: Partial<Omit<Sequence, 'id' | 'seances'>>): Agenda {
  return { ...agenda, sequences: agenda.sequences.map((s) => (s.id === id ? { ...s, ...change } : s)) };
}

/** Removes the séquence and takes it off every class it was placed on. */
export function removeSequence(agenda: Agenda, id: string): Agenda {
  return {
    ...agenda,
    sequences: agenda.sequences.filter((s) => s.id !== id),
    placements: agenda.placements.filter((p) => p.sequenceId !== id),
  };
}

/** A copy of the séquence (new séances too), placed right after it. Not placed on any class. */
export function duplicateSequence(agenda: Agenda, id: string): { agenda: Agenda; id: string } {
  const index = agenda.sequences.findIndex((s) => s.id === id);
  if (index === -1) return { agenda, id };
  const source = agenda.sequences[index];
  const copy: Sequence = { ...source, id: newId('seq'), title: `${source.title} (copie)`, seances: source.seances.map(copySeance) };
  const sequences = [...agenda.sequences];
  sequences.splice(index + 1, 0, copy);
  return { agenda: { ...agenda, sequences }, id: copy.id };
}

const copySeance = (s: Seance): Seance => ({ ...s, id: newId('seance') });

function editSeances(agenda: Agenda, sequenceId: string, change: (seances: Seance[]) => Seance[]): Agenda {
  return { ...agenda, sequences: agenda.sequences.map((s) => (s.id === sequenceId ? { ...s, seances: change(s.seances) } : s)) };
}

/** Adds a séance at `index` (default: at the end). */
export function addSeance(agenda: Agenda, sequenceId: string, seance: Partial<Omit<Seance, 'id'>> = {}, index?: number): { agenda: Agenda; id: string } {
  const id = newId('seance');
  const next = editSeances(agenda, sequenceId, (list) => {
    const out = [...list];
    out.splice(index ?? out.length, 0, { title: `Séance ${list.length + 1}`, ...seance, id });
    return out;
  });
  return { agenda: next, id };
}

export function updateSeance(agenda: Agenda, sequenceId: string, seanceId: string, change: Partial<Omit<Seance, 'id'>>): Agenda {
  return editSeances(agenda, sequenceId, (list) => list.map((s) => (s.id === seanceId ? { ...s, ...change } : s)));
}

export function removeSeance(agenda: Agenda, sequenceId: string, seanceId: string): Agenda {
  return editSeances(agenda, sequenceId, (list) => list.filter((s) => s.id !== seanceId));
}

/** Moves the séance at `from` to position `to` (positions in the list after it was taken out). */
export function moveSeance(agenda: Agenda, sequenceId: string, from: number, to: number): Agenda {
  return editSeances(agenda, sequenceId, (list) => {
    if (from < 0 || from >= list.length) return list;
    const out = [...list];
    const [moved] = out.splice(from, 1);
    out.splice(Math.max(0, Math.min(to, out.length)), 0, moved);
    return out;
  });
}

/** A copy of the séance, right after it. */
export function duplicateSeance(agenda: Agenda, sequenceId: string, seanceId: string): { agenda: Agenda; id: string } {
  const list = agenda.sequences.find((s) => s.id === sequenceId)?.seances ?? [];
  const index = list.findIndex((s) => s.id === seanceId);
  if (index === -1) return { agenda, id: seanceId };
  const copy = copySeance(list[index]);
  return { agenda: editSeances(agenda, sequenceId, (l) => [...l.slice(0, index + 1), copy, ...l.slice(index + 1)]), id: copy.id };
}

/** Reuses a séance in another séquence: a copy is added at its end, so editing one does not change the other. */
export function copySeanceTo(agenda: Agenda, fromSequenceId: string, seanceId: string, toSequenceId: string): { agenda: Agenda; id: string } {
  const seance = agenda.sequences.find((s) => s.id === fromSequenceId)?.seances.find((s) => s.id === seanceId);
  if (!seance) return { agenda, id: seanceId };
  const copy = copySeance(seance);
  return { agenda: editSeances(agenda, toSequenceId, (l) => [...l, copy]), id: copy.id };
}

/** Number of lessons the séquence needs (a double séance counts for two). */
export function sequenceLessons(sequence: Sequence): number {
  return sequence.seances.reduce((n, s) => n + Math.max(1, Math.floor(s.slots ?? 1)), 0);
}
