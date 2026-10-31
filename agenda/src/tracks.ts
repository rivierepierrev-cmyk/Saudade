import type { Agenda } from './model.ts';

/**
 * What progresses through séquences: a whole class, or one group of a class. Each has its own lessons
 * (the timetable lessons of the class, or of the group) and its own chain of séquences.
 */
export interface Track {
  classId: string;
  groupId?: string;
}

export const toTrack = (t: Track | string): Track => (typeof t === 'string' ? { classId: t } : { classId: t.classId, groupId: t.groupId || undefined });

export const sameTrack = (a: Track, b: Track) => a.classId === b.classId && (a.groupId || undefined) === (b.groupId || undefined);

export const trackKey = (t: Track) => `${t.classId}|${t.groupId ?? ''}`;

export function trackName(agenda: Agenda, t: Track): string {
  const cls = agenda.classes.find((c) => c.id === t.classId);
  if (!t.groupId) return cls?.name ?? '?';
  return `${cls?.name ?? '?'} · ${cls?.groups?.find((g) => g.id === t.groupId)?.name ?? '?'}`;
}

/** Every track: each class as a whole, then each of its groups. */
export function allTracks(agenda: Agenda): Track[] {
  return agenda.classes.flatMap((c) => [{ classId: c.id }, ...(c.groups ?? []).map((g) => ({ classId: c.id, groupId: g.id }))]);
}

/**
 * The tracks worth showing: a class with groups shows its whole-class track only when it has
 * whole-class lessons or séquences.
 */
export function visibleTracks(agenda: Agenda): Track[] {
  return allTracks(agenda).filter((t) => {
    if (t.groupId) return true;
    const cls = agenda.classes.find((c) => c.id === t.classId);
    if (!cls?.groups?.length) return true;
    const own = (x: { classId: string; groupId?: string }) => x.classId === t.classId && !x.groupId;
    return agenda.timetable.some(own) || agenda.placements.some(own) || (agenda.extraSlots ?? []).some(own);
  });
}
