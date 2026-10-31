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

/** A class whose groups also progress during its whole-class lessons: it has no chain of its own. */
export function classFollowsGroups(agenda: Agenda, classId: string): boolean {
  const cls = agenda.classes.find((c) => c.id === classId);
  return Boolean(cls?.groupsShareClassLessons && cls.groups?.length);
}

/** Does a lesson of `slotTrack` count for `track`? Its own lessons, and the whole-class ones for a group sharing them. */
export function lessonCountsFor(agenda: Agenda, slotTrack: Track, track: Track): boolean {
  if (sameTrack(slotTrack, track)) return true;
  return Boolean(track.groupId && !slotTrack.groupId && slotTrack.classId === track.classId && classFollowsGroups(agenda, track.classId));
}

/** Every track that has a chain of séquences: each class as a whole (unless it follows its groups), then each of its groups. */
export function allTracks(agenda: Agenda): Track[] {
  return agenda.classes.flatMap((c) => [
    ...(classFollowsGroups(agenda, c.id) ? [] : [{ classId: c.id }]),
    ...(c.groups ?? []).map((g) => ({ classId: c.id, groupId: g.id })),
  ]);
}

/**
 * The tracks worth showing: a class with groups shows its whole-class track only when it has
 * whole-class lessons or séquences.
 */
export function visibleTracks(agenda: Agenda): Track[] {
  return allTracks(agenda).filter((t) => {
    if (t.groupId) return true;
    const cls = agenda.classes.find((c) => c.id === t.classId);
    if (cls?.groupsShareClassLessons && cls.groups?.length) return false;
    if (!cls?.groups?.length) return true;
    const own = (x: { classId: string; groupId?: string }) => x.classId === t.classId && !x.groupId;
    return agenda.timetable.some(own) || agenda.placements.some(own) || (agenda.extraSlots ?? []).some(own);
  });
}
