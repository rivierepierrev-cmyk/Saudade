import type { Agenda } from './model.ts';
import type { PlanResult } from './plan.ts';
import { trackName } from './tracks.ts';

/** Text value of an iCalendar property: backslashes, commas, semicolons and line breaks escaped. */
export function icsText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** Lines longer than 75 bytes are folded (RFC 5545), without cutting a character in two. */
export function foldLine(line: string): string {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const parts: string[] = [];
  let current = '';
  let size = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    const limit = parts.length ? 74 : 75; // continuation lines start with a space
    if (size + n > limit) {
      parts.push(current);
      current = '';
      size = 0;
    }
    current += ch;
    size += n;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const local = (date: string, time: string) => `${date.replace(/-/g, '')}T${time.replace(':', '').padStart(4, '0')}00`;

/** Europe/Paris, so that lessons keep their local time in any calendar. */
const PARIS = [
  'BEGIN:VTIMEZONE', 'TZID:Europe/Paris',
  'BEGIN:DAYLIGHT', 'TZOFFSETFROM:+0100', 'TZOFFSETTO:+0200', 'TZNAME:CEST', 'DTSTART:19700329T020000', 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU', 'END:DAYLIGHT',
  'BEGIN:STANDARD', 'TZOFFSETFROM:+0200', 'TZOFFSETTO:+0100', 'TZNAME:CET', 'DTSTART:19701025T030000', 'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU', 'END:STANDARD',
  'END:VTIMEZONE',
];

/**
 * The lessons of the year as an iCalendar file: one event per lesson, titled with the class and the
 * séance planned, described with its objectives, activities and homework. Cancelled and postponed
 * lessons are left out. Event ids stay the same from one export to the next, so re-importing updates them.
 */
export function toICS(agenda: Agenda, result: PlanResult, now = new Date()): string {
  const sequences = new Map(agenda.sequences.map((s) => [s.id, s]));
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Agenda enseignant//FR', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:Agenda', ...PARIS];
  for (const { lesson: l, planned } of result.entries) {
    const name = trackName(agenda, l);
    const seq = planned && sequences.get(planned.sequenceId);
    const summary = planned ? `${name} · ${seq?.title ?? ''} ${planned.index + 1}/${planned.total} : ${planned.seance.title}` : name;
    const s = planned?.seance;
    const description = s
      ? [s.objectives && `Objectifs : ${s.objectives}`, s.activities, s.materials && `Matériel : ${s.materials}`, s.homework && `Devoirs : ${s.homework}`].filter(Boolean).join('\n\n')
      : '';
    lines.push(
      'BEGIN:VEVENT',
      `UID:${[l.classId, l.groupId ?? '', l.date, l.start].join('-').replace(/[^A-Za-z0-9-]/g, '')}@agenda-enseignant`,
      `DTSTAMP:${stamp(now)}`,
      `DTSTART;TZID=Europe/Paris:${local(l.date, l.start)}`,
      `DTEND;TZID=Europe/Paris:${local(l.date, l.end)}`,
      `SUMMARY:${icsText(summary)}`,
      ...(description ? [`DESCRIPTION:${icsText(description)}`] : []),
      ...(l.room ? [`LOCATION:${icsText(`Salle ${l.room}`)}`] : []),
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}
