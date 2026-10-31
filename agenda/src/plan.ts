import { addDays, eachDay, minutes, mondayOf, weekday, type ISODate } from './dates.ts';
import type { Agenda, Closure, Placement, SchoolCalendar, Seance, Sequence } from './model.ts';

/** One actual lesson of a class on a given day. */
export interface Lesson {
  classId: string;
  date: ISODate;
  start: string;
  end: string;
  room?: string;
  /** Set for a timetable lesson… */
  slotId?: string;
  /** …or for a one-off extra lesson. */
  extraSlotId?: string;
}

export interface PlannedSeance {
  placementId: string;
  sequenceId: string;
  classId: string;
  seance: Seance;
  /** 0-based position in the séquence. */
  index: number;
  total: number;
  lessons: Lesson[];
  /** A multi-lesson séance with holidays (or another closure) between its lessons. */
  interrupted: boolean;
}

export interface PlannedSequence {
  placement: Placement;
  sequence: Sequence;
  seances: PlannedSeance[];
  /** Date of the first and last scheduled lesson; undefined when nothing could be scheduled. */
  start?: ISODate;
  end?: ISODate;
  /** Séances that did not fit before the end of the school year. */
  unscheduled: number;
}

export type WarningKind = 'unknown-sequence' | 'unknown-class' | 'empty-sequence' | 'pushed-back' | 'overflow';

export interface PlanWarning {
  kind: WarningKind;
  placementId: string;
  message: string;
}

/** A lesson of the agenda, with what is taught in it (if anything). */
export interface AgendaEntry {
  lesson: Lesson;
  planned?: {
    placementId: string;
    sequenceId: string;
    seance: Seance;
    index: number;
    total: number;
    /** For a séance spread over several lessons: 1-based part number and part count. */
    part: number;
    parts: number;
  };
}

export interface PlanResult {
  sequences: PlannedSequence[];
  /** Every lesson of the year, in chronological order, planned or free. */
  entries: AgendaEntry[];
  warnings: PlanWarning[];
}

const byTime = (a: Lesson, b: Lesson) =>
  a.date < b.date ? -1 : a.date > b.date ? 1 : minutes(a.start) - minutes(b.start);

function closureApplies(c: Closure, date: ISODate, classId?: string): boolean {
  if (date < c.start || date > c.end) return false;
  return !c.classIds || (classId !== undefined && c.classIds.includes(classId));
}

/** Is the day without lessons for this class? Without a class, only closures for everyone count. */
export function isClosed(calendar: SchoolCalendar, date: ISODate, classId?: string): Closure | undefined {
  return calendar.closures.find((c) => closureApplies(c, date, classId));
}

/** A week counts as a school week when at least one weekday is not closed for everyone. */
function isSchoolWeek(calendar: SchoolCalendar, monday: ISODate): boolean {
  for (let i = 0; i < 5; i++) if (!isClosed(calendar, addDays(monday, i))) return true;
  return false;
}

/** A or B for the week containing `date`; undefined without A/B weeks or during a week of holidays (when they are skipped). */
export function weekType(calendar: SchoolCalendar, date: ISODate): 'A' | 'B' | undefined {
  const ab = calendar.abWeeks;
  if (!ab) return undefined;
  const monday = mondayOf(date);
  const ref = mondayOf(ab.referenceMonday);
  if (!ab.skipHolidayWeeks) {
    const weeks = Math.round((Date.parse(monday) - Date.parse(ref)) / (7 * 86_400_000));
    return weeks % 2 === 0 ? 'A' : 'B';
  }
  if (!isSchoolWeek(calendar, monday)) return undefined;
  let count = 0;
  const [from, to] = monday >= ref ? [ref, monday] : [monday, ref];
  for (let m = from; m < to; m = addDays(m, 7)) if (isSchoolWeek(calendar, m)) count++;
  return count % 2 === 0 ? 'A' : 'B';
}

/** Every lesson a class actually has during the school year, holidays, closures and cancellations removed. */
export function lessonsOf(agenda: Agenda, classId: string, from = agenda.calendar.start, to = agenda.calendar.end): Lesson[] {
  const { calendar } = agenda;
  const slots = agenda.timetable.filter((s) => s.classId === classId);
  const cancelled = new Set((agenda.cancellations ?? []).map((c) => `${c.slotId}@${c.date}`));
  const weekTypes = new Map<ISODate, 'A' | 'B' | undefined>();
  const lessons: Lesson[] = [];
  for (const date of eachDay(from, to)) {
    if (isClosed(calendar, date, classId)) continue;
    const wd = weekday(date);
    for (const s of slots) {
      if (s.weekday !== wd) continue;
      if ((s.validFrom && date < s.validFrom) || (s.validTo && date > s.validTo)) continue;
      // Without A/B weeks in the calendar, a lesson marked A or B happens every week.
      if (s.week && calendar.abWeeks) {
        const monday = mondayOf(date);
        if (!weekTypes.has(monday)) weekTypes.set(monday, weekType(calendar, date));
        if (weekTypes.get(monday) !== s.week) continue;
      }
      if (cancelled.has(`${s.id}@${date}`)) continue;
      lessons.push({ classId, date, start: s.start, end: s.end, room: s.room, slotId: s.id });
    }
  }
  for (const x of agenda.extraSlots ?? []) {
    if (x.classId !== classId || x.date < from || x.date > to) continue;
    lessons.push({ classId, date: x.date, start: x.start, end: x.end, room: x.room, extraSlotId: x.id });
  }
  return lessons.sort(byTime);
}

const slotsOf = (s: Seance) => Math.max(1, Math.floor(s.slots ?? 1));

const fmt = (d: ISODate) => d.split('-').reverse().join('/');

/**
 * Gives each séance of each placed séquence its lessons, in order, skipping holidays and closures.
 * Nothing is stored: call it again after any change and every date that depends on it moves.
 */
export function plan(agenda: Agenda): PlanResult {
  const sequences = new Map(agenda.sequences.map((s) => [s.id, s]));
  const classIds = new Set(agenda.classes.map((c) => c.id));
  const warnings: PlanWarning[] = [];
  const planned: PlannedSequence[] = [];
  const entries: AgendaEntry[] = [];

  for (const classId of classIds) {
    const lessons = lessonsOf(agenda, classId);
    const taken: (AgendaEntry['planned'] | undefined)[] = new Array(lessons.length);
    let next = 0;

    for (const placement of agenda.placements) {
      if (placement.classId !== classId) continue;
      const sequence = sequences.get(placement.sequenceId);
      if (!sequence) {
        warnings.push({ kind: 'unknown-sequence', placementId: placement.id, message: 'Séquence introuvable.' });
        continue;
      }
      if (sequence.seances.length === 0) {
        warnings.push({ kind: 'empty-sequence', placementId: placement.id, message: `« ${sequence.title} » ne contient aucune séance.` });
      }
      let i = next;
      if (placement.start) {
        let wanted = lessons.findIndex((l) => l.date >= placement.start!);
        if (wanted === -1) wanted = lessons.length;
        if (wanted < next) {
          warnings.push({
            kind: 'pushed-back',
            placementId: placement.id,
            message: `« ${sequence.title} » devait commencer le ${fmt(placement.start)}, mais la séquence précédente n'est pas terminée : elle commence après.`,
          });
        }
        i = Math.max(next, wanted);
      }

      const result: PlannedSequence = { placement, sequence, seances: [], unscheduled: 0 };
      sequence.seances.forEach((seance, index) => {
        const parts = slotsOf(seance);
        const own = lessons.slice(i, i + parts);
        if (own.length < parts) {
          result.unscheduled++;
          i = lessons.length;
          return;
        }
        own.forEach((_, k) => {
          taken[i + k] = { placementId: placement.id, sequenceId: sequence.id, seance, index, total: sequence.seances.length, part: k + 1, parts };
        });
        i += parts;
        const first = own[0].date;
        const last = own[own.length - 1].date;
        let interrupted = false;
        for (let d = addDays(first, 1); d < last && !interrupted; d = addDays(d, 1)) {
          interrupted = isClosed(agenda.calendar, d, classId) !== undefined;
        }
        result.seances.push({ placementId: placement.id, sequenceId: sequence.id, classId, seance, index, total: sequence.seances.length, lessons: own, interrupted });
      });

      if (result.seances.length) {
        result.start = result.seances[0].lessons[0].date;
        const lastLessons = result.seances[result.seances.length - 1].lessons;
        result.end = lastLessons[lastLessons.length - 1].date;
      }
      if (result.unscheduled) {
        warnings.push({
          kind: 'overflow',
          placementId: placement.id,
          message: `« ${sequence.title} » dépasse la fin de l'année : ${result.unscheduled} séance(s) sans cours.`,
        });
      }
      planned.push(result);
      next = i;
    }

    lessons.forEach((lesson, k) => entries.push(taken[k] ? { lesson, planned: taken[k] } : { lesson }));
  }

  for (const p of agenda.placements) {
    if (!classIds.has(p.classId)) warnings.push({ kind: 'unknown-class', placementId: p.id, message: 'Classe introuvable.' });
  }
  entries.sort((a, b) => byTime(a.lesson, b.lesson));
  planned.sort((a, b) => agenda.placements.indexOf(a.placement) - agenda.placements.indexOf(b.placement));
  return { sequences: planned, entries, warnings };
}

/**
 * When a séquence leaves the front of a class's chain (moved or removed), the one that followed it
 * would otherwise jump back to the start of the year: it keeps the start it had instead.
 */
function keepFollowers(placements: Placement[], before: PlanResult, classIds: (string | undefined)[]): Placement[] {
  return placements.map((p, i) => {
    if (p.start || !classIds.includes(p.classId)) return p;
    if (placements.findIndex((q) => q.classId === p.classId) !== i) return p;
    const was = before.sequences.find((s) => s.placement.id === p.id);
    const wasFirst = before.sequences.find((s) => s.placement.classId === p.classId)?.placement.id === p.id;
    return was?.start && !wasFirst ? { ...p, start: was.start } : p;
  });
}

/** The agenda with `placement` added or moved to `index` (in the list without it). */
export function withPlacement(agenda: Agenda, placement: Placement, index: number, before: PlanResult = plan(agenda)): Agenda {
  const old = agenda.placements.find((p) => p.id === placement.id);
  const placements = agenda.placements.filter((p) => p.id !== placement.id);
  placements.splice(Math.max(0, Math.min(index, placements.length)), 0, placement);
  return { ...agenda, placements: keepFollowers(placements, before, [placement.classId, old?.classId]) };
}

/** The agenda without a placement; the séquence that followed it stays where it was. */
export function withoutPlacement(agenda: Agenda, id: string, before: PlanResult = plan(agenda)): Agenda {
  const old = agenda.placements.find((p) => p.id === id);
  return { ...agenda, placements: keepFollowers(agenda.placements.filter((p) => p.id !== id), before, [old?.classId]) };
}

/**
 * What dropping a séquence on a class would give, without changing the agenda: its séances with
 * their dates, its end date, and how the séquences after it would move. `index` places it in the
 * list of placements (default: at the end).
 */
export function previewPlacement(agenda: Agenda, placement: Placement, index = agenda.placements.length) {
  const before = plan(agenda);
  const next = withPlacement(agenda, placement, index, before);
  const after = plan(next);
  const endOf = (r: PlanResult, id: string) => r.sequences.find((s) => s.placement.id === id)?.end;
  const shifted = after.sequences
    .filter((s) => s.placement.id !== placement.id && s.placement.classId === placement.classId)
    .map((s) => ({ placementId: s.placement.id, title: s.sequence.title, endBefore: endOf(before, s.placement.id), endAfter: s.end }))
    .filter((s) => s.endBefore !== s.endAfter);
  return {
    result: after.sequences.find((s) => s.placement.id === placement.id),
    shifted,
    warnings: after.warnings.filter((w) => w.placementId === placement.id),
    plan: after,
    agenda: next,
  };
}

/** The lessons of one day, planned or free. */
export function dayEntries(result: PlanResult, date: ISODate): AgendaEntry[] {
  return result.entries.filter((e) => e.lesson.date === date);
}

/** The lessons of the week containing `date`, Monday to Sunday. */
export function weekEntries(result: PlanResult, date: ISODate): AgendaEntry[] {
  const monday = mondayOf(date);
  const sunday = addDays(monday, 6);
  return result.entries.filter((e) => e.lesson.date >= monday && e.lesson.date <= sunday);
}
