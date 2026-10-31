import { useMemo, useState, type CSSProperties } from 'react';
import type { Agenda } from '../model.ts';
import { addDays, addMonths, mondayOf, today as todayOf, type ISODate } from '../dates.ts';
import { updateSeance, sequenceLessons } from '../edit.ts';
import { plan, previewPlacement, weekType, type AgendaEntry, type Lesson } from '../plan.ts';
import { cancelLesson, classProgress, proposePlacement, removePlacement, restoreLesson } from '../placements.ts';
import { sameTrack, trackKey, trackName, visibleTracks } from '../tracks.ts';
import { DayView, MonthView, WeekView, lessonKey, type Cancelled, type Incoming, type ViewProps } from './CalendarViews.tsx';
import { LessonWindow } from './LessonWindow.tsx';
import { PlacementWindow, type PlacementRequest } from './PlacementWindow.tsx';
import { SeanceWindow } from './SeanceWindow.tsx';
import { longDate, monthLabel, plural, shortDate, shortDay } from './format.ts';
import { dropClass, useDragDrop, type DragPayload, type DropTarget } from './useDragDrop.ts';

type View = 'week' | 'day' | 'month';
const VIEW_KEY = 'agenda.view';

function initialView(): View {
  try {
    const v = localStorage.getItem(VIEW_KEY);
    return v === 'day' || v === 'month' ? v : 'week';
  } catch {
    return 'week';
  }
}

interface Props {
  agenda: Agenda;
  onChange: (agenda: Agenda) => void;
  onGoTo: (tab: 'timetable' | 'sequences') => void;
}

/** The agenda: real lessons with their séances, week / day / month, and séquences dropped on classes. */
export function AgendaView({ agenda, onChange, onGoTo }: Props) {
  const today = todayOf();
  const { calendar } = agenda;
  const [view, setView] = useState<View>(initialView);
  const [cursor, setCursor] = useState<ISODate>(() => (today < calendar.start ? calendar.start : today > calendar.end ? calendar.end : today));
  const [placing, setPlacing] = useState<PlacementRequest | undefined>();
  const [open, setOpen] = useState<{ lesson: Lesson; planned?: AgendaEntry['planned']; cancelled?: Cancelled } | undefined>();
  const [editingSeance, setEditingSeance] = useState<{ sequenceId: string; seanceId: string } | undefined>();
  const result = useMemo(() => plan(agenda), [agenda]);
  const tracks = visibleTracks(agenda);
  const sequences = new Map(agenda.sequences.map((s) => [s.id, s]));

  const requestFor = (payload: DragPayload, target: DropTarget): PlacementRequest | undefined => {
    const start = target.kind === 'lesson' ? target.date : undefined;
    const track = { classId: target.classId, groupId: target.groupId };
    if (payload.kind === 'sequence') return { sequenceId: payload.sequenceId, target: track, start };
    const p = agenda.placements.find((x) => x.id === payload.placementId);
    return p && { sequenceId: p.sequenceId, target: track, start, placementId: p.id };
  };

  const { drag, begin, click } = useDragDrop((payload, target) => setPlacing(requestFor(payload, target)));

  // While a séquence is dragged over a target: where its séances would go, and when it would end.
  const targetKey = drag?.target ? JSON.stringify(drag.target) : '';
  const hover = useMemo(() => {
    if (!drag?.target) return undefined;
    const req = requestFor(drag.payload, drag.target);
    if (!req?.target) return undefined;
    const { placement, index } = proposePlacement(agenda, req.sequenceId, req.target, req.start, today, req.placementId ?? 'preview');
    const p = previewPlacement(agenda, placement, index);
    const incoming: Incoming = new Map();
    for (const s of p.result?.seances ?? []) for (const l of s.lessons) incoming.set(lessonKey(l), { index: s.index, total: s.total, title: s.seance.title });
    return { req, result: p.result, incoming };
  }, [agenda, drag?.payload, targetKey]);

  const step = (n: number) =>
    setCursor((c) => (view === 'week' ? addDays(mondayOf(c), 7 * n) : view === 'day' ? addDays(c, n) : addMonths(`${c.slice(0, 7)}-01`, n)));
  const changeView = (v: View) => {
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      // Not remembered: fine.
    }
  };
  const title =
    view === 'week' ? `Semaine du ${shortDate(mondayOf(cursor))}` : view === 'day' ? longDate(cursor) : monthLabel(cursor).replace(/^./, (c) => c.toUpperCase());
  const ab = view === 'week' ? weekType(calendar, cursor) : undefined;

  const viewProps: ViewProps = {
    agenda,
    result,
    cursor,
    today,
    incoming: hover?.incoming,
    begin,
    click,
    onOpen: (lesson, planned, cancelled) => setOpen({ lesson, planned, cancelled }),
    onPickDay: (date) => {
      setCursor(date);
      changeView('day');
    },
  };

  if (agenda.classes.length === 0 || agenda.timetable.length === 0) {
    return (
      <section className="card empty-builder">
        <p className="muted">L'agenda se remplit à partir de l'emploi du temps : ajoutez vos classes et leurs cours.</p>
        <p><button type="button" className="primary" onClick={() => onGoTo('timetable')}>Aller à l'emploi du temps</button></p>
      </section>
    );
  }

  const dragged = drag && (drag.payload.kind === 'sequence' ? sequences.get(drag.payload.sequenceId) : sequences.get(agenda.placements.find((p) => p.id === (drag.payload as { placementId: string }).placementId)?.sequenceId ?? ''));

  return (
    <div className={`agenda-page${drag ? ' is-dragging' : ''}`}>
      <aside className="agenda-side">
        <section className="card" aria-label="Séquences à placer">
          <h2>Séquences</h2>
          {agenda.sequences.length === 0 ? (
            <p className="muted">Aucune séquence. <button type="button" className="link" onClick={() => onGoTo('sequences')}>En créer une</button></p>
          ) : (
            <p className="muted small">Glissez une séquence sur un cours de l'agenda, ou sur une classe (ou un groupe) ci-dessous.</p>
          )}
          <ul className="palette">
            {agenda.sequences.map((s) => (
              <li key={s.id} style={{ '--seq-color': s.color } as CSSProperties}>
                <div className="palette-card" onPointerDown={(e) => begin({ kind: 'sequence', sequenceId: s.id }, e)} aria-label={`Séquence ${s.title}, à glisser`}>
                  <span className="dot" aria-hidden="true" />
                  <span className="seq-text">
                    <span className="seq-title">{s.title}</span>
                    <span className="muted small">{plural(s.seances.length, 'séance')}{sequenceLessons(s) !== s.seances.length ? ` · ${plural(sequenceLessons(s), 'cours', 'cours')}` : ''}</span>
                  </span>
                </div>
                <button type="button" className="ghost small-btn" onClick={() => setPlacing({ sequenceId: s.id })}>Placer…</button>
              </li>
            ))}
          </ul>
        </section>

        <section className="card" aria-label="Classes">
          <h2>Classes</h2>
          <ul className="class-plans">
            {agenda.classes.map((c) => {
              const own = tracks.filter((t) => t.classId === c.id);
              return (
                <li key={c.id} className="class-plan" style={{ '--class-color': c.color } as CSSProperties}>
                  {own.map((t) => {
                    const progress = classProgress(agenda, result, t, today);
                    const placed = result.sequences.filter((s) => sameTrack(s.placement, t));
                    const isTarget = drag?.target?.kind === 'class' && sameTrack(drag.target, t);
                    const name = trackName(agenda, t);
                    const label = own.length === 1 ? c.name : t.groupId ? c.groups?.find((g) => g.id === t.groupId)?.name : 'Classe entière';
                    return (
                      <div key={trackKey(t)} className={`track-plan${isTarget ? ' drop-over' : ''}${own.length > 1 ? ' sub' : ''}`} aria-label={name} {...dropClass(t.classId, t.groupId)}>
                        {own.length > 1 && t === own[0] && <b className="class-plan-name">{c.name}</b>}
                        <div className="class-plan-head">
                          <b>{label}</b>
                          <span className="muted small">{progress.plannedUntil ? `prévu jusqu'au ${shortDate(progress.plannedUntil)}` : 'rien de prévu'}</span>
                        </div>
                        <div
                          className="progress"
                          role="img"
                          aria-label={`${progress.planned} cours prévus sur ${progress.lessons}`}
                          title={`${progress.planned} cours prévus sur ${progress.lessons} · ${progress.freeAhead} cours libres à venir`}
                        >
                          <span className="progress-fill" style={{ width: `${progress.lessons ? (progress.planned / progress.lessons) * 100 : 0}%` }} />
                          <span className="progress-now" style={{ left: `${progress.elapsed * 100}%` }} />
                        </div>
                        {progress.next && (
                          <p className="small">Prochain cours ({shortDay(progress.next.date)}) : {progress.next.sequenceTitle} {progress.next.index + 1}/{progress.next.total}</p>
                        )}
                        {placed.length > 0 && (
                          <ol className="placed">
                            {placed.map((s) => {
                              const warn = result.warnings.filter((w) => w.placementId === s.placement.id);
                              return (
                                <li key={s.placement.id} style={{ '--seq-color': s.sequence.color } as CSSProperties}>
                                  <button type="button" className="placed-btn" onClick={() => setPlacing({ sequenceId: s.sequence.id, target: t, start: s.start, placementId: s.placement.id })}>
                                    <span className="dot" aria-hidden="true" />
                                    <span>{s.sequence.title}</span>
                                    <span className="muted small">{s.start && s.end ? `${shortDate(s.start)} → ${shortDate(s.end)}` : 'sans cours'}</span>
                                    {warn.length > 0 && <span className="warn-icon" title={warn.map((w) => w.message).join('\n')} aria-label={warn.map((w) => w.message).join(' ')}>!</span>}
                                  </button>
                                  <button type="button" className="icon" aria-label={`Retirer ${s.sequence.title} de ${name}`} title="Retirer" onClick={() => onChange(removePlacement(agenda, s.placement.id))}>×</button>
                                </li>
                              );
                            })}
                          </ol>
                        )}
                      </div>
                    );
                  })}
                </li>
              );
            })}
          </ul>
        </section>
      </aside>

      <section className="card agenda-main" aria-label="Agenda">
        <div className="toolbar">
          <div className="nav">
            <button type="button" className="ghost icon-btn" aria-label="Précédent" onClick={() => step(-1)}>‹</button>
            <button type="button" className="ghost" onClick={() => setCursor(today)}>Aujourd'hui</button>
            <button type="button" className="ghost icon-btn" aria-label="Suivant" onClick={() => step(1)}>›</button>
            <h2 className="agenda-title">{title}{ab && <span className="pill">Semaine {ab}</span>}</h2>
          </div>
          <div className="tabs" role="tablist" aria-label="Vue">
            {(['day', 'week', 'month'] as View[]).map((v) => (
              <button key={v} type="button" role="tab" aria-selected={view === v} aria-current={view === v ? 'page' : undefined} onClick={() => changeView(v)}>
                {v === 'day' ? 'Jour' : v === 'week' ? 'Semaine' : 'Mois'}
              </button>
            ))}
          </div>
        </div>
        {view === 'week' ? <WeekView {...viewProps} /> : view === 'day' ? <DayView {...viewProps} /> : <MonthView {...viewProps} />}
      </section>

      {drag && dragged && (
        <div className="drag-ghost" style={{ left: drag.x + 14, top: drag.y + 14, '--seq-color': dragged.color } as CSSProperties} aria-hidden="true">
          <b>{dragged.title}</b>
          {hover?.req && (
            <span>
              → {hover.req.target && trackName(agenda, hover.req.target)}
              {hover.result?.end ? ` · fin ${shortDay(hover.result.end)}` : ' · pas de cours'}
            </span>
          )}
        </div>
      )}

      {placing && (
        <PlacementWindow
          key={JSON.stringify(placing)}
          agenda={agenda}
          request={placing}
          today={today}
          onConfirm={(next) => {
            onChange(next);
            setPlacing(undefined);
          }}
          onRemove={placing.placementId ? () => { onChange(removePlacement(agenda, placing.placementId!)); setPlacing(undefined); } : undefined}
          onClose={() => setPlacing(undefined)}
        />
      )}

      {open && (
        <LessonWindow
          agenda={agenda}
          lesson={open.lesson}
          planned={open.planned}
          cancelled={open.cancelled}
          onEditSeance={() => {
            if (!open.planned) return;
            setEditingSeance({ sequenceId: open.planned.sequenceId, seanceId: open.planned.seance.id });
            setOpen(undefined);
          }}
          onMoveSequence={() => {
            const p = open.planned && agenda.placements.find((x) => x.id === open.planned!.placementId);
            if (!p) return;
            const s = result.sequences.find((x) => x.placement.id === p.id);
            setPlacing({ sequenceId: p.sequenceId, target: { classId: p.classId, groupId: p.groupId }, start: s?.start ?? p.start, placementId: p.id });
            setOpen(undefined);
          }}
          onRemoveSequence={() => {
            if (open.planned) onChange(removePlacement(agenda, open.planned.placementId));
            setOpen(undefined);
          }}
          onCancelLesson={(reason) => {
            if (open.lesson.slotId) onChange(cancelLesson(agenda, open.lesson.slotId, open.lesson.date, reason || undefined));
            setOpen(undefined);
          }}
          onRestoreLesson={() => {
            if (open.lesson.slotId) onChange(restoreLesson(agenda, open.lesson.slotId, open.lesson.date));
            setOpen(undefined);
          }}
          onClose={() => setOpen(undefined)}
        />
      )}

      {editingSeance && (() => {
        const seq = sequences.get(editingSeance.sequenceId);
        const index = seq?.seances.findIndex((s) => s.id === editingSeance.seanceId) ?? -1;
        if (!seq || index === -1) return null;
        return (
          <SeanceWindow
            seance={seq.seances[index]}
            number={index + 1}
            sequence={seq}
            others={[]}
            onSave={(s) => {
              const { id, ...fields } = s;
              onChange(updateSeance(agenda, seq.id, id, fields));
              setEditingSeance(undefined);
            }}
            onClose={() => setEditingSeance(undefined)}
          />
        );
      })()}
    </div>
  );
}
