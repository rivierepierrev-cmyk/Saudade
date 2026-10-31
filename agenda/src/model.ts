import type { ISODate, Weekday } from './dates.ts';

export interface SchoolClass {
  id: string;
  name: string;
  level?: string;
  color?: string;
  /** Half-groups (or more): each has its own lessons and its own progress. */
  groups?: ClassGroup[];
  /**
   * Each group also progresses during whole-class lessons (its séquences use both). The class as a
   * whole then has no chain of its own. Off by default: whole-class lessons are a chain apart.
   */
  groupsShareClassLessons?: boolean;
}

export interface ClassGroup {
  id: string;
  name: string;
}

/** A recurring weekly lesson of one class. */
export interface TimetableSlot {
  id: string;
  classId: string;
  weekday: Weekday;
  /** 'HH:MM' */
  start: string;
  end: string;
  room?: string;
  /** Only on A weeks or B weeks; every week when absent. */
  week?: 'A' | 'B';
  /** Lets the timetable change during the year (both included). */
  validFrom?: ISODate;
  validTo?: ISODate;
  /** A lesson of one group of the class; the whole class when absent. */
  groupId?: string;
}

/** A building block of a séquence: what happens during one lesson (or several, for a double lesson). */
export interface Seance {
  id: string;
  title: string;
  objectives?: string;
  activities?: string;
  materials?: string;
  homework?: string;
  /** Number of timetable slots the séance takes. Default 1. */
  slots?: number;
}

export interface Sequence {
  id: string;
  title: string;
  subject?: string;
  /** School level it is meant for (« 6e », « 2nde »…). */
  level?: string;
  color?: string;
  seances: Seance[];
}

/**
 * A séquence placed on a class, or on one of its groups. Placements of a class are taught in array order:
 * without `start`, a séquence begins at the first free lesson after the previous one ends.
 */
export interface Placement {
  id: string;
  sequenceId: string;
  classId: string;
  /** Placed on one group of the class (its lessons only); the whole class when absent. */
  groupId?: string;
  start?: ISODate;
}

export type ClosureKind = 'holiday' | 'public-holiday' | 'closure';

/** Days without lessons, both ends included. Applies to every class unless `classIds` is set. */
export interface Closure {
  start: ISODate;
  end: ISODate;
  label: string;
  kind: ClosureKind;
  classIds?: string[];
}

/**
 * A lesson that gives no séance: it will not happen (strike, trip, exam…), or it happened but its
 * séance was not done or not finished (`postponed`). Either way the séances move to the next lesson.
 */
export interface Cancellation {
  slotId: string;
  date: ISODate;
  reason?: string;
  kind?: 'postponed';
}

/** A séance marked as done in a lesson. Only counts while that séance is still the one planned there. */
export interface DoneMark {
  slotId?: string;
  extraSlotId?: string;
  date: ISODate;
  seanceId: string;
}

/** A one-off lesson outside the timetable (a moved or extra lesson). */
export interface ExtraSlot {
  id: string;
  classId: string;
  groupId?: string;
  date: ISODate;
  start: string;
  end: string;
  room?: string;
}

export interface ABWeeks {
  /** Monday of a week that is an A week. */
  referenceMonday: ISODate;
  /** true: weeks with no school day (holidays) are not counted, so A/B resumes where it stopped. */
  skipHolidayWeeks: boolean;
}

export interface SchoolCalendar {
  /** First and last day of lessons, both included. */
  start: ISODate;
  end: ISODate;
  closures: Closure[];
  abWeeks?: ABWeeks;
}

export interface Agenda {
  classes: SchoolClass[];
  timetable: TimetableSlot[];
  sequences: Sequence[];
  placements: Placement[];
  calendar: SchoolCalendar;
  cancellations?: Cancellation[];
  extraSlots?: ExtraSlot[];
  done?: DoneMark[];
}
