import { addDays, type ISODate } from './dates.ts';
import { newId } from './edit.ts';
import type { Agenda, Closure, Placement } from './model.ts';
import { lessonsOf, plan, withoutPlacement, withPlacement, type PlanResult } from './plan.ts';

/**
 * Where a séquence starting on `date` goes in a class's chain: after the séquences of that class that
 * start before that date. One starting on that very date goes after it: dropping on the first lesson
 * of a séquence puts the new one there and pushes the other back.
 */
export function insertionIndex(agenda: Agenda, classId: string, date: ISODate | undefined, result: PlanResult = plan(agenda), excludeId?: string): number {
  // Starts are those of the agenda as it is (with the placement being moved), positions those of the list without it.
  const list = agenda.placements.filter((p) => p.id !== excludeId);
  if (!date) return list.length;
  const starts = new Map(result.sequences.map((s) => [s.placement.id, s.start ?? s.placement.start]));
  let index = -1;
  list.forEach((p, i) => {
    if (p.classId !== classId) return;
    const start = starts.get(p.id);
    if (start && start < date) index = i;
  });
  if (index !== -1) return index + 1;
  const firstOfClass = list.findIndex((p) => p.classId === classId);
  return firstOfClass === -1 ? list.length : firstOfClass;
}

/**
 * The placement a drop proposes. Without a start date it follows the class's last séquence; when the
 * class has none yet, it starts with the first lesson from `today` (or from the start of the year).
 */
export function proposePlacement(agenda: Agenda, sequenceId: string, classId: string, start: ISODate | undefined, today: ISODate, id = newId('place')): { placement: Placement; index: number } {
  let date = start;
  if (!date && !agenda.placements.some((p) => p.classId === classId && p.id !== id)) {
    date = today > agenda.calendar.start && today <= agenda.calendar.end ? today : agenda.calendar.start;
  }
  const placement: Placement = date ? { id, sequenceId, classId, start: date } : { id, sequenceId, classId };
  return { placement, index: insertionIndex(agenda, classId, date, plan(agenda), id) };
}

/** Adds or moves a placement, at `index` in the list without it. */
export const putPlacement = (agenda: Agenda, placement: Placement, index: number): Agenda => withPlacement(agenda, placement, index);

export const removePlacement = (agenda: Agenda, id: string): Agenda => withoutPlacement(agenda, id);

/** A lesson that will not happen: every séance from there on moves to the next lesson. */
export function cancelLesson(agenda: Agenda, slotId: string, date: ISODate, reason?: string): Agenda {
  const others = (agenda.cancellations ?? []).filter((c) => !(c.slotId === slotId && c.date === date));
  return { ...agenda, cancellations: [...others, reason ? { slotId, date, reason } : { slotId, date }] };
}

export function restoreLesson(agenda: Agenda, slotId: string, date: ISODate): Agenda {
  return { ...agenda, cancellations: (agenda.cancellations ?? []).filter((c) => !(c.slotId === slotId && c.date === date)) };
}

export function removeExtraSlot(agenda: Agenda, id: string): Agenda {
  return { ...agenda, extraSlots: (agenda.extraSlots ?? []).filter((x) => x.id !== id) };
}

/** Closures of a class that fall between two dates (both included), each listed once. */
export function closuresBetween(agenda: Agenda, from: ISODate, to: ISODate, classId?: string): Closure[] {
  return agenda.calendar.closures
    .filter((c) => c.start <= to && c.end >= from && (!c.classIds || (classId !== undefined && c.classIds.includes(classId))))
    .sort((a, b) => (a.start < b.start ? -1 : 1));
}

export interface ClassProgress {
  /** Lessons of the year and how many of them have a séance. */
  lessons: number;
  planned: number;
  /** Share of the year's lessons already past. */
  elapsed: number;
  /** Last day with a planned séance. */
  plannedUntil?: ISODate;
  /** The séance of the next lesson from today, if any. */
  next?: { date: ISODate; sequenceTitle: string; seanceTitle: string; index: number; total: number };
  /** Lessons from today on with nothing planned. */
  freeAhead: number;
}

export function classProgress(agenda: Agenda, result: PlanResult, classId: string, today: ISODate): ClassProgress {
  const entries = result.entries.filter((e) => e.lesson.classId === classId);
  const planned = entries.filter((e) => e.planned);
  const past = entries.filter((e) => e.lesson.date < today).length;
  const nextEntry = entries.find((e) => e.lesson.date >= today);
  const titles = new Map(agenda.sequences.map((s) => [s.id, s.title]));
  return {
    lessons: entries.length,
    planned: planned.length,
    elapsed: entries.length ? past / entries.length : 0,
    plannedUntil: planned.at(-1)?.lesson.date,
    next: nextEntry?.planned && {
      date: nextEntry.lesson.date,
      sequenceTitle: titles.get(nextEntry.planned.sequenceId) ?? '',
      seanceTitle: nextEntry.planned.seance.title,
      index: nextEntry.planned.index,
      total: nextEntry.planned.total,
    },
    freeAhead: entries.filter((e) => e.lesson.date >= today && !e.planned).length,
  };
}

/** Cancelled lessons of a class between two dates, with their times, to show them crossed out. */
export function cancelledLessons(agenda: Agenda, from: ISODate, to: ISODate) {
  const cancellations = (agenda.cancellations ?? []).filter((c) => c.date >= from && c.date <= to);
  if (!cancellations.length) return [];
  const withoutThem = { ...agenda, cancellations: [] };
  return cancellations.flatMap((c) => {
    const slot = agenda.timetable.find((s) => s.id === c.slotId);
    if (!slot) return [];
    const lesson = lessonsOf(withoutThem, slot.classId, c.date, c.date).find((l) => l.slotId === c.slotId);
    return lesson ? [{ ...lesson, reason: c.reason }] : [];
  });
}

/** First day of the month of `d`, and the Monday on or before it. */
export function monthGridStart(d: ISODate): ISODate {
  const first = `${d.slice(0, 7)}-01`;
  const wd = (new Date(`${first}T00:00:00Z`).getUTCDay() + 6) % 7;
  return addDays(first, -wd);
}
