import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import type { Agenda } from '../model.ts';
import { addDays, minutes, mondayOf, timeOf, weekday, type ISODate, type Weekday } from '../dates.ts';
import { dayEntries, isClosed, weekEntries, type AgendaEntry, type Lesson, type PlanResult } from '../plan.ts';
import { cancelledLessons, monthGridStart } from '../placements.ts';
import { layoutDay } from '../timetableLayout.ts';
import { trackName } from '../tracks.ts';
import { DAY_NAMES, longDate, shortDate } from './format.ts';
import { dropLesson, type DragPayload } from './useDragDrop.ts';

/** What the agenda shows on a lesson while a séquence is dragged over it. */
export type Incoming = Map<string, { index: number; total: number; title: string }>;
export const lessonKey = (l: Pick<Lesson, 'classId' | 'groupId' | 'date' | 'start'>) => `${l.classId}|${l.groupId ?? ''}|${l.date}|${l.start}`;

export type Cancelled = Lesson & { reason?: string };

export interface ViewProps {
  agenda: Agenda;
  result: PlanResult;
  cursor: ISODate;
  today: ISODate;
  incoming?: Incoming;
  begin: (payload: DragPayload, e: ReactPointerEvent<HTMLElement>) => void;
  click: (handler: () => void) => () => void;
  onOpen: (lesson: Lesson, planned?: AgendaEntry['planned'], cancelled?: Cancelled) => void;
  onPickDay: (date: ISODate) => void;
}

const PX = 1.15;

function useLookups(agenda: Agenda) {
  const classes = new Map(agenda.classes.map((c) => [c.id, c]));
  const sequences = new Map(agenda.sequences.map((s) => [s.id, s]));
  return { classes, sequences };
}

/** Days shown: Monday to Friday, and Saturday when there are Saturday lessons. */
function weekDays(agenda: Agenda): Weekday[] {
  const saturday = agenda.timetable.some((s) => s.weekday === 6) || (agenda.extraSlots ?? []).some((x) => weekday(x.date) === 6);
  return saturday ? [1, 2, 3, 4, 5, 6] : [1, 2, 3, 4, 5];
}

function lessonLabel(className: string, l: Lesson, planned: AgendaEntry['planned'] | undefined, seqTitle: string | undefined, cancelled?: Cancelled) {
  const head = `${className}, ${longDate(l.date)}, ${l.start}–${l.end}`;
  if (cancelled) return `${head} : annulé${cancelled.reason ? ` (${cancelled.reason})` : ''}`;
  return planned ? `${head} : ${seqTitle}, séance ${planned.index + 1}/${planned.total}, ${planned.seance.title}` : `${head} : libre`;
}

/** One lesson as a block: the planned séance, or free. Drop target; a planned one can be dragged to move its séquence. */
function LessonBlock({ props, entry, cancelled, style, compact }: { props: ViewProps; entry?: AgendaEntry; cancelled?: Cancelled; style?: CSSProperties; compact?: boolean }) {
  const { classes, sequences } = useLookups(props.agenda);
  const lesson = entry?.lesson ?? cancelled!;
  const planned = entry?.planned;
  const cls = classes.get(lesson.classId);
  const name = trackName(props.agenda, lesson);
  const seq = planned && sequences.get(planned.sequenceId);
  const incoming = !cancelled ? props.incoming?.get(lessonKey(lesson)) : undefined;
  const kind = cancelled ? 'cancelled' : planned ? 'planned' : 'free';
  return (
    <button
      type="button"
      className={`lesson ${kind}${incoming ? ' incoming' : ''}${compact ? ' compact' : ''}${lesson.date === props.today ? ' today' : ''}`}
      style={{ ...style, '--class-color': cls?.color, '--seq-color': seq?.color } as CSSProperties}
      aria-label={lessonLabel(name, lesson, planned, seq?.title, cancelled)}
      {...(!cancelled ? dropLesson(lesson.classId, lesson.date, lesson.groupId) : {})}
      onPointerDown={planned ? (e) => props.begin({ kind: 'move', placementId: planned.placementId }, e) : undefined}
      onClick={props.click(() => props.onOpen(lesson, planned, cancelled))}
    >
      <span className="lesson-head">{compact ? lesson.start : `${lesson.start} · `}{compact ? ' ' : ''}<b>{name}</b></span>
      {incoming ? (
        <span className="lesson-main">→ {incoming.index + 1}. {incoming.title}</span>
      ) : cancelled ? (
        <span className="lesson-main">Annulé</span>
      ) : planned ? (
        <>
          <span className="lesson-main">{planned.seance.title}</span>
          {!compact && <span className="lesson-sub">{seq?.title} · {planned.index + 1}/{planned.total}</span>}
        </>
      ) : (
        !compact && <span className="lesson-sub">Libre</span>
      )}
    </button>
  );
}

export function WeekView(props: ViewProps) {
  const { agenda, result, cursor, today } = props;
  const monday = mondayOf(cursor);
  const days = weekDays(agenda);
  const entries = weekEntries(result, monday);
  const cancelled = cancelledLessons(agenda, monday, addDays(monday, 6));
  const all = [...entries.map((e) => e.lesson), ...cancelled];
  const first = Math.min(8 * 60, ...all.map((l) => Math.floor(minutes(l.start) / 60) * 60));
  const last = Math.max(17 * 60, ...all.map((l) => Math.ceil(minutes(l.end) / 60) * 60));
  const hours: number[] = [];
  for (let h = first; h < last; h += 60) hours.push(h);

  return (
    <div className="grid-scroll">
      <div className="week-grid agenda-week" style={{ '--days': days.length } as CSSProperties}>
        <div className="corner" />
        {days.map((d) => {
          const date = addDays(monday, d - 1);
          const closed = isClosed(agenda.calendar, date);
          return (
            <button type="button" key={d} className={`day-head${date === today ? ' is-today' : ''}`} onClick={() => props.onPickDay(date)} aria-label={`Voir le ${longDate(date)}`}>
              <span>{DAY_NAMES[d]} {shortDate(date)}</span>
              {closed && <span className="closed-label">{closed.label}</span>}
            </button>
          );
        })}
        <div className="hours" style={{ height: (last - first) * PX }}>
          {hours.map((h) => <span key={h} style={{ top: (h - first) * PX }}>{timeOf(h).replace(':00', ' h')}</span>)}
        </div>
        {days.map((d) => {
          const date = addDays(monday, d - 1);
          const closed = isClosed(agenda.calendar, date);
          const items: ({ start: string; end: string } & ({ entry: AgendaEntry } | { cancelled: Cancelled }))[] = [
            ...entries.filter((e) => e.lesson.date === date).map((entry) => ({ start: entry.lesson.start, end: entry.lesson.end, entry })),
            ...cancelled.filter((c) => c.date === date).map((c) => ({ start: c.start, end: c.end, cancelled: c })),
          ];
          return (
            <div key={d} className={`day-col${closed ? ' closed' : ''}${date === today ? ' is-today' : ''}`} style={{ height: (last - first) * PX, '--hour': `${60 * PX}px` } as CSSProperties}>
              {layoutDay(items).map(({ item, col, cols }) => {
                const l = 'entry' in item ? item.entry.lesson : item.cancelled;
                const style: CSSProperties = {
                  position: 'absolute',
                  top: (minutes(l.start) - first) * PX,
                  height: (minutes(l.end) - minutes(l.start)) * PX,
                  left: `calc(${(col / cols) * 100}% + 2px)`,
                  width: `calc(${100 / cols}% - 4px)`,
                };
                return 'entry' in item ? (
                  <LessonBlock key={lessonKey(l)} props={props} entry={item.entry} style={style} />
                ) : (
                  <LessonBlock key={`x${lessonKey(l)}`} props={props} cancelled={item.cancelled} style={style} />
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function DayView(props: ViewProps) {
  const { agenda, result, cursor } = props;
  const { classes, sequences } = useLookups(agenda);
  const entries = dayEntries(result, cursor);
  const cancelled = cancelledLessons(agenda, cursor, cursor);
  const closed = isClosed(agenda.calendar, cursor);
  const items = [...entries.map((entry) => ({ entry, l: entry.lesson })), ...cancelled.map((c) => ({ cancelled: c, l: c as Lesson }))].sort(
    (a, b) => minutes(a.l.start) - minutes(b.l.start),
  );

  return (
    <div className="day-view">
      {closed && <p className="closed-banner">{closed.label}</p>}
      {items.length === 0 && !closed && <p className="muted">Pas de cours ce jour-là.</p>}
      {items.map((item) => {
        const l = item.l;
        const cls = classes.get(l.classId);
        if ('cancelled' in item && item.cancelled) {
          return (
            <article key={`x${lessonKey(l)}`} className="day-card cancelled" style={{ '--class-color': cls?.color } as CSSProperties}>
              <button type="button" className="day-card-head" onClick={() => props.onOpen(l, undefined, item.cancelled)}>
                <span className="time">{l.start}–{l.end}</span> <b>{trackName(agenda, l)}</b> · Annulé{item.cancelled.reason ? ` (${item.cancelled.reason})` : ''}
              </button>
            </article>
          );
        }
        const planned = 'entry' in item ? item.entry?.planned : undefined;
        const seq = planned && sequences.get(planned.sequenceId);
        const incoming = props.incoming?.get(lessonKey(l));
        const s = planned?.seance;
        return (
          <article
            key={lessonKey(l)}
            className={`day-card${planned ? ' planned' : ' free'}${incoming ? ' incoming' : ''}`}
            style={{ '--class-color': cls?.color, '--seq-color': seq?.color } as CSSProperties}
            {...dropLesson(l.classId, l.date, l.groupId)}
          >
            <button
              type="button"
              className="day-card-head"
              onPointerDown={planned ? (e) => props.begin({ kind: 'move', placementId: planned.placementId }, e) : undefined}
              onClick={props.click(() => props.onOpen(l, planned))}
            >
              <span className="time">{l.start}–{l.end}</span> <b>{trackName(agenda, l)}</b>
              {l.room && <span className="muted"> · salle {l.room}</span>}
              {incoming ? <span className="pill">→ {incoming.index + 1}. {incoming.title}</span> : planned ? <span className="muted"> · {seq?.title} {planned.index + 1}/{planned.total}</span> : <span className="muted"> · libre</span>}
            </button>
            {s && (
              <div className="day-card-body">
                <h4>{s.title}{planned.parts > 1 && <span className="pill">partie {planned.part}/{planned.parts}</span>}</h4>
                {s.objectives && <p><b>Objectifs.</b> {s.objectives}</p>}
                {s.activities && <p className="prewrap">{s.activities}</p>}
                {s.materials && <p><b>Matériel.</b> {s.materials}</p>}
                {s.homework && <p><b>Devoirs.</b> {s.homework}</p>}
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}

export function MonthView(props: ViewProps) {
  const { agenda, result, cursor, today } = props;
  const month = cursor.slice(0, 7);
  const start = monthGridStart(cursor);
  const days = weekDays(agenda);
  const weeks: ISODate[] = [];
  for (let m = start; m.slice(0, 7) <= month; m = addDays(m, 7)) weeks.push(m);
  const byDate = new Map<ISODate, AgendaEntry[]>();
  for (const e of result.entries) {
    if (e.lesson.date < start || e.lesson.date.slice(0, 7) > month) continue;
    byDate.set(e.lesson.date, [...(byDate.get(e.lesson.date) ?? []), e]);
  }

  return (
    <div className="grid-scroll">
      <div className="month-grid" style={{ '--days': days.length } as CSSProperties}>
        {days.map((d) => <div key={d} className="month-head">{DAY_NAMES[d]}</div>)}
        {weeks.flatMap((monday) =>
          days.map((d) => {
            const date = addDays(monday, d - 1);
            const closed = isClosed(agenda.calendar, date);
            const outside = date.slice(0, 7) !== month;
            return (
              <div key={date} className={`month-cell${outside ? ' outside' : ''}${closed ? ' closed' : ''}${date === today ? ' is-today' : ''}`}>
                <button type="button" className="month-day" onClick={() => props.onPickDay(date)} aria-label={`Voir le ${longDate(date)}`}>
                  {Number(date.slice(8))}
                </button>
                {closed && <span className="closed-label">{closed.label}</span>}
                {(byDate.get(date) ?? []).map((entry) => (
                  <LessonBlock key={lessonKey(entry.lesson)} props={props} entry={entry} compact />
                ))}
              </div>
            );
          }),
        )}
      </div>
    </div>
  );
}
