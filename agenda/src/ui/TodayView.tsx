import { useState, type CSSProperties } from 'react';
import type { Agenda } from '../model.ts';
import { addDays, type ISODate } from '../dates.ts';
import { dayEntries, isClosed, type AgendaEntry, type PlanResult } from '../plan.ts';
import { cancelledLessons, isDone, toConfirm } from '../placements.ts';
import { trackName } from '../tracks.ts';
import { longDay, shortDay } from './format.ts';
import { lessonKey } from './CalendarViews.tsx';

interface Props {
  agenda: Agenda;
  result: PlanResult;
  today: ISODate;
  onOpen: (entry: AgendaEntry) => void;
  onDone: (entry: AgendaEntry, done: boolean) => void;
  onPostpone: (entry: AgendaEntry, reason: string) => void;
  onRestore: (slotId: string, date: ISODate) => void;
}

const RECENT = 8;

/** The next day with lessons (today included), within two weeks. */
function nextTeachingDay(result: PlanResult, today: ISODate): ISODate | undefined {
  const limit = addDays(today, 14);
  return result.entries.find((e) => e.lesson.date >= today && e.lesson.date <= limit)?.lesson.date;
}

/** Today: what to teach, ready to tick off; past lessons still to confirm. */
export function TodayView({ agenda, result, today, onOpen, onDone, onPostpone, onRestore }: Props) {
  // Today, if it has lessons (even cancelled or postponed ones); otherwise the next day with lessons.
  const day = dayEntries(result, today).length || cancelledLessons(agenda, today, today).length ? today : nextTeachingDay(result, today);
  const entries = day ? dayEntries(result, day) : [];
  const cancelled = day ? cancelledLessons(agenda, day, day) : [];
  const closed = isClosed(agenda.calendar, today);
  const pending = toConfirm(agenda, result, today);
  const sequences = new Map(agenda.sequences.map((s) => [s.id, s]));
  const classes = new Map(agenda.classes.map((c) => [c.id, c]));

  return (
    <div className="today-view">
      {day !== today && (
        <h3 className="today-title">
          Pas de cours aujourd'hui{closed ? ` (${closed.label})` : ''}.{day && <> Prochain jour de cours : {longDay(day)}</>}
        </h3>
      )}
      {!day && <p className="muted">Aucun cours dans les deux prochaines semaines.</p>}

      {[...entries.map((e) => ({ e })), ...cancelled.map((c) => ({ c }))]
        .sort((a, b) => ('e' in a ? a.e.lesson.start : a.c.start).localeCompare('e' in b ? b.e.lesson.start : b.c.start))
        .map((item) => {
          if ('c' in item) {
            const c = item.c;
            return (
              <article key={`x${lessonKey(c)}`} className="today-card muted-card" style={{ '--class-color': classes.get(c.classId)?.color } as CSSProperties}>
                <div className="today-head">
                  <span className="time">{c.start}–{c.end}</span> <b>{trackName(agenda, c)}</b> · {c.postponed ? 'Séance reportée' : 'Cours annulé'}{c.reason ? ` (${c.reason})` : ''}
                </div>
                {c.slotId && <button type="button" className="ghost small-btn" onClick={() => onRestore(c.slotId!, c.date)}>{c.postponed ? 'Annuler le report' : 'Rétablir'}</button>}
              </article>
            );
          }
          return <TodayCard key={lessonKey(item.e.lesson)} agenda={agenda} entry={item.e} seqTitle={item.e.planned && sequences.get(item.e.planned.sequenceId)?.title} color={item.e.planned ? sequences.get(item.e.planned.sequenceId)?.color : classes.get(item.e.lesson.classId)?.color} onOpen={onOpen} onDone={onDone} onPostpone={onPostpone} />;
        })}

      {pending.length > 0 && (
        <section className="to-confirm" aria-label="À confirmer">
          <h4>À confirmer : {pending.length === 1 ? 'un cours passé' : `${pending.length} cours passés`}</h4>
          <p className="muted small">Cochez ce qui a été fait ; une séance pas faite passe au cours suivant.</p>
          <ul>
            {pending.slice(0, RECENT).map((e) => (
              <li key={lessonKey(e.lesson)}>
                <button type="button" className="link-row" onClick={() => onOpen(e)}>
                  <span className="muted">{shortDay(e.lesson.date)}</span> <b>{trackName(agenda, e.lesson)}</b> · {e.planned!.seance.title}
                  <span className="muted small"> ({sequences.get(e.planned!.sequenceId)?.title} {e.planned!.index + 1}/{e.planned!.total})</span>
                </button>
                <button type="button" className="ghost small-btn" aria-label={`Faite : ${trackName(agenda, e.lesson)}, ${shortDay(e.lesson.date)}`} onClick={() => onDone(e, true)}>✓ Faite</button>
                {e.lesson.slotId && (
                  <button type="button" className="ghost small-btn" aria-label={`Pas faite : ${trackName(agenda, e.lesson)}, ${shortDay(e.lesson.date)}`} onClick={() => onPostpone(e, '')}>Pas faite</button>
                )}
              </li>
            ))}
          </ul>
          {pending.length > RECENT && <p className="muted small">… et {pending.length - RECENT} plus anciens.</p>}
        </section>
      )}
    </div>
  );
}

function TodayCard({ agenda, entry, seqTitle, color, onOpen, onDone, onPostpone }: {
  agenda: Agenda;
  entry: AgendaEntry;
  seqTitle?: string;
  color?: string;
  onOpen: (entry: AgendaEntry) => void;
  onDone: (entry: AgendaEntry, done: boolean) => void;
  onPostpone: (entry: AgendaEntry, reason: string) => void;
}) {
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState('');
  const { lesson: l, planned } = entry;
  const done = isDone(agenda, entry);
  const s = planned?.seance;
  return (
    <article className={`today-card${done ? ' is-done' : ''}${planned ? '' : ' free'}`} style={{ '--seq-color': color } as CSSProperties} aria-label={`${trackName(agenda, l)}, ${l.start}`}>
      <button type="button" className="today-head" onClick={() => onOpen(entry)}>
        <span className="time">{l.start}–{l.end}</span> <b>{trackName(agenda, l)}</b>
        {l.room && <span className="muted"> · salle {l.room}</span>}
        {planned ? <span className="muted"> · {seqTitle} {planned.index + 1}/{planned.total}</span> : <span className="muted"> · cours libre</span>}
      </button>
      {s && (
        <div className="today-body">
          <h4>{s.title}{planned.parts > 1 && <span className="pill">partie {planned.part}/{planned.parts}</span>}</h4>
          {s.objectives && <p><b>Objectifs.</b> {s.objectives}</p>}
          {s.activities && <p className="prewrap">{s.activities}</p>}
          {s.materials && <p><b>Matériel.</b> {s.materials}</p>}
          {s.homework && <p><b>Devoirs.</b> {s.homework}</p>}
          {asking ? (
            <div className="today-actions">
              <input className="reason" aria-label="Note" placeholder="Note (pas fini, absents…)" value={reason} autoFocus onChange={(e) => setReason(e.target.value)} />
              <button type="button" className="ghost" onClick={() => setAsking(false)}>Retour</button>
              <button type="button" className="primary" onClick={() => onPostpone(entry, reason.trim())}>Reporter la séance</button>
            </div>
          ) : (
            <div className="today-actions">
              <button type="button" className={done ? 'primary' : 'ghost'} aria-pressed={done} onClick={() => onDone(entry, !done)}>✓ {done ? 'Faite' : 'Marquer comme faite'}</button>
              {l.slotId && !done && <button type="button" className="ghost" onClick={() => setAsking(true)}>Pas faite : reporter…</button>}
            </div>
          )}
        </div>
      )}
    </article>
  );
}
