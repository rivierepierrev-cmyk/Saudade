import { useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import type { Agenda, TimetableSlot } from '../model.ts';
import { minutes, mondayOf, timeOf, today, type Weekday } from '../dates.ts';
import { addClass, addSlot, removeClass, removeSlot, slotConflicts, updateClass, updateSlot, weeklyLessons } from '../edit.ts';
import { weekType } from '../plan.ts';
import { layoutDay } from '../timetableLayout.ts';
import { DAY_NAMES, duration, plural } from './format.ts';
import { SlotWindow, type SlotDraft } from './SlotWindow.tsx';
import { TrashIcon } from './Window.tsx';

interface Props {
  agenda: Agenda;
  onChange: (agenda: Agenda) => void;
}

/** Height of one minute in the grid. */
const PX = 1.1;
const SNAP = 5;
const DEFAULT_LENGTH = 55;
const SATURDAY_KEY = 'agenda.saturday';

const snap = (m: number) => Math.round(m / SNAP) * SNAP;

function readSaturday(): boolean {
  try {
    return localStorage.getItem(SATURDAY_KEY) === '1';
  } catch {
    return false;
  }
}

/** The classes and their weekly timetable, drawn on a grid. */
export function TimetableView({ agenda, onChange }: Props) {
  const { classes, timetable, calendar } = agenda;
  const [selected, setSelected] = useState<string | undefined>(classes[0]?.id);
  const [newName, setNewName] = useState('');
  const [editing, setEditing] = useState<SlotDraft | undefined>();
  const [drawing, setDrawing] = useState<{ weekday: Weekday; from: number; to: number } | undefined>();
  const [hint, setHint] = useState<string | undefined>();
  const [saturday, setSaturday] = useState(readSaturday);
  const columns = useRef(new Map<number, HTMLDivElement>());

  const selectedClass = classes.find((c) => c.id === selected) ?? classes[0];
  const classOf = (id: string) => classes.find((c) => c.id === id);

  const days: Weekday[] = saturday || timetable.some((s) => s.weekday === 6) ? [1, 2, 3, 4, 5, 6] : [1, 2, 3, 4, 5];
  const first = Math.min(8 * 60, ...timetable.map((s) => Math.floor(minutes(s.start) / 60) * 60));
  const last = Math.max(18 * 60, ...timetable.map((s) => Math.ceil(minutes(s.end) / 60) * 60));
  const hours: number[] = [];
  for (let h = first; h < last; h += 60) hours.push(h);

  const totals = classes.reduce(
    (t, c) => {
      const w = weeklyLessons(agenda, c.id);
      return { lessons: t.lessons + w.lessons, minutes: t.minutes + w.minutes };
    },
    { lessons: 0, minutes: 0 },
  );

  // Classes

  const createClass = () => {
    const r = addClass(agenda, newName);
    onChange(r.agenda);
    setSelected(r.id);
    setNewName('');
    setHint(undefined);
  };
  const deleteClass = (id: string, name: string) => {
    const lessons = timetable.filter((s) => s.classId === id).length;
    const placed = agenda.placements.filter((p) => p.classId === id).length;
    const details = [lessons && plural(lessons, 'cours', 'cours'), placed && plural(placed, 'séquence placée', 'séquences placées')].filter(Boolean).join(' et ');
    if (!window.confirm(`Supprimer ${name}${details ? ` avec ses ${details}` : ''} ? Les séquences restent dans la bibliothèque.`)) return;
    onChange(removeClass(agenda, id));
    if (selected === id) setSelected(classes.find((c) => c.id !== id)?.id);
  };

  // Drawing a lesson: press in an empty part of a day, drag down to its end, release.

  const minuteAt = (weekday: number, clientY: number) => {
    const col = columns.current.get(weekday);
    if (!col) return first;
    return Math.max(first, Math.min(last, snap(first + (clientY - col.getBoundingClientRect().top) / PX)));
  };
  const startDrawing = (weekday: Weekday, e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget || e.button !== 0 || e.pointerType === 'touch') return;
    if (!selectedClass) {
      setHint("Ajoutez d'abord une classe, à gauche.");
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    const from = Math.min(minuteAt(weekday, e.clientY), last - SNAP);
    setDrawing({ weekday, from, to: from });
  };
  const moveDrawing = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!drawing) return;
    setDrawing({ ...drawing, to: Math.max(drawing.from + SNAP, minuteAt(drawing.weekday, e.clientY)) });
  };
  const endDrawing = () => {
    if (!drawing || !selectedClass) return;
    const to = drawing.to - drawing.from < 15 ? Math.min(last, drawing.from + DEFAULT_LENGTH) : drawing.to;
    onChange(addSlot(agenda, { classId: selectedClass.id, weekday: drawing.weekday, start: timeOf(drawing.from), end: timeOf(to) }).agenda);
    setDrawing(undefined);
  };

  const saveSlot = (draft: SlotDraft) => {
    const { id, ...slot } = draft;
    onChange(id ? updateSlot(agenda, id, slot) : addSlot(agenda, slot).agenda);
    setEditing(undefined);
  };

  // A/B weeks

  const ab = calendar.abWeeks;
  const setAB = (on: boolean) =>
    onChange({ ...agenda, calendar: { ...calendar, abWeeks: on ? { referenceMonday: mondayOf(calendar.start), skipHolidayWeeks: true } : undefined } });
  const thisDay = today();
  const thisWeek = ab ? weekType(calendar, thisDay) : undefined;

  return (
    <div className="timetable-page">
      <aside className="card classes" aria-label="Classes">
        <h2>Classes</h2>
        {classes.length === 0 && <p className="muted">Ajoutez vos classes, puis dessinez leurs cours dans la grille.</p>}
        <ul>
          {classes.map((c) => {
            const w = weeklyLessons(agenda, c.id);
            const isSelected = c.id === selectedClass?.id;
            return (
              <li key={c.id} className={isSelected ? 'selected' : undefined} style={{ '--class-color': c.color } as CSSProperties}>
                <input type="color" className="swatch" aria-label={`Couleur de ${c.name}`} value={c.color ?? '#4f7cff'} onChange={(e) => onChange(updateClass(agenda, c.id, { color: e.target.value }))} />
                <button type="button" className="class-pick" aria-pressed={isSelected} onClick={() => setSelected(c.id)}>
                  <span className="class-name">{c.name}</span>
                  <span className="muted small">{w.lessons ? `${plural(w.lessons, 'cours', 'cours')} / sem. · ${duration(w.minutes)}` : 'Aucun cours'}</span>
                </button>
                <button type="button" className="delete" aria-label={`Supprimer ${c.name}`} title="Supprimer" onClick={() => deleteClass(c.id, c.name)}>
                  <TrashIcon />
                </button>
              </li>
            );
          })}
        </ul>
        {selectedClass && (
          <label className="rename">
            <span className="muted small">Nom de la classe sélectionnée</span>
            <input value={selectedClass.name} onChange={(e) => onChange(updateClass(agenda, selectedClass.id, { name: e.target.value }))} />
          </label>
        )}
        <form className="add-class" onSubmit={(e) => { e.preventDefault(); createClass(); }}>
          <input aria-label="Nouvelle classe" placeholder="6e B, 2nde 4…" value={newName} onChange={(e) => setNewName(e.target.value)} />
          <button type="submit" className="ghost">Ajouter</button>
        </form>
      </aside>

      <section className="card grid-card" aria-label="Emploi du temps">
        <div className="toolbar">
          <div>
            <h2>Emploi du temps</h2>
            <p className="muted small">
              {totals.lessons ? `${plural(totals.lessons, 'cours', 'cours')} par semaine · ${duration(totals.minutes)}` : 'Aucun cours pour l\'instant.'}
            </p>
          </div>
          <div className="toolbar-actions">
            <label className="check"><input type="checkbox" checked={days.length === 6} disabled={timetable.some((s) => s.weekday === 6)} onChange={(e) => { setSaturday(e.target.checked); try { localStorage.setItem(SATURDAY_KEY, e.target.checked ? '1' : '0'); } catch { /* not remembered */ } }} /> Samedi</label>
            <label className="check"><input type="checkbox" checked={Boolean(ab)} onChange={(e) => setAB(e.target.checked)} /> Semaines A/B</label>
            <button
              type="button"
              className="primary"
              disabled={!selectedClass}
              onClick={() => selectedClass && setEditing({ classId: selectedClass.id, weekday: 1, start: '08:00', end: '08:55' })}
            >
              + Ajouter un cours
            </button>
          </div>
        </div>

        {ab && (
          <div className="ab-bar">
            <label>Semaine A : semaine du <input type="date" value={ab.referenceMonday} onChange={(e) => e.target.value && onChange({ ...agenda, calendar: { ...calendar, abWeeks: { ...ab, referenceMonday: mondayOf(e.target.value) } } })} /></label>
            <label className="check"><input type="checkbox" checked={ab.skipHolidayWeeks} onChange={(e) => onChange({ ...agenda, calendar: { ...calendar, abWeeks: { ...ab, skipHolidayWeeks: e.target.checked } } })} /> Les semaines de vacances ne comptent pas</label>
            {thisWeek && <span className="pill">Cette semaine : {thisWeek}</span>}
          </div>
        )}

        <p className="muted small hint" aria-live="polite">
          {hint ?? (selectedClass ? <>Cliquez-glissez dans un jour pour ajouter un cours de <strong>{selectedClass.name}</strong>. Cliquez sur un cours pour le modifier.</> : "Ajoutez d'abord une classe.")}
        </p>

        <div className="grid-scroll">
          <div className="week-grid" style={{ '--days': days.length } as CSSProperties}>
            <div className="corner" />
            {days.map((d) => <div key={d} className="day-head">{DAY_NAMES[d]}</div>)}
            <div className="hours" style={{ height: (last - first) * PX }}>
              {hours.map((h) => <span key={h} style={{ top: (h - first) * PX }}>{timeOf(h).replace(':00', ' h')}</span>)}
            </div>
            {days.map((d) => {
              const daySlots = layoutDay(timetable.filter((s) => s.weekday === d));
              return (
                <div
                  key={d}
                  ref={(el) => { if (el) columns.current.set(d, el); else columns.current.delete(d); }}
                  className={`day-col${selectedClass ? ' can-draw' : ''}`}
                  style={{ height: (last - first) * PX, '--hour': `${60 * PX}px` } as CSSProperties}
                  data-day={d}
                  onPointerDown={(e) => startDrawing(d, e)}
                  onPointerMove={moveDrawing}
                  onPointerUp={endDrawing}
                  onPointerCancel={() => setDrawing(undefined)}
                >
                  {daySlots.map(({ item: s, col, cols }) => (
                    <SlotBlock
                      key={s.id}
                      slot={s}
                      top={(minutes(s.start) - first) * PX}
                      height={(minutes(s.end) - minutes(s.start)) * PX}
                      col={col}
                      cols={cols}
                      name={classOf(s.classId)?.name ?? '?'}
                      color={classOf(s.classId)?.color}
                      ab={Boolean(ab)}
                      clash={slotConflicts(timetable, s).length > 0}
                      onOpen={() => setEditing(s)}
                    />
                  ))}
                  {drawing?.weekday === d && (
                    <div className="slot drawing" style={{ top: (drawing.from - first) * PX, height: Math.max(drawing.to - drawing.from, SNAP) * PX, '--class-color': selectedClass?.color } as CSSProperties}>
                      <span>{timeOf(drawing.from)}–{timeOf(Math.max(drawing.to, drawing.from + (drawing.to - drawing.from < 15 ? DEFAULT_LENGTH : 0)))}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {editing && (
        <SlotWindow
          agenda={agenda}
          slot={editing}
          onSave={saveSlot}
          onDelete={editing.id ? () => { onChange(removeSlot(agenda, editing.id!)); setEditing(undefined); } : undefined}
          onClose={() => setEditing(undefined)}
        />
      )}
    </div>
  );
}

function SlotBlock(props: { slot: TimetableSlot; top: number; height: number; col: number; cols: number; name: string; color?: string; ab: boolean; clash: boolean; onOpen: () => void }) {
  const { slot: s, top, height, col, cols, name, color, ab, clash } = props;
  const label = `${name}, ${DAY_NAMES[s.weekday].toLowerCase()} ${s.start}–${s.end}${s.room ? `, salle ${s.room}` : ''}${ab && s.week ? `, semaine ${s.week}` : ''}${clash ? ', en même temps qu\'un autre cours' : ''}`;
  return (
    <button
      type="button"
      className={`slot${clash ? ' clash' : ''}${ab && s.week ? ' alternate' : ''}`}
      style={{ top, height, left: `calc(${(col / cols) * 100}% + 2px)`, width: `calc(${100 / cols}% - 4px)`, '--class-color': color } as CSSProperties}
      aria-label={label}
      title={label}
      onClick={props.onOpen}
    >
      <strong>{name}</strong>
      <span>{s.start}–{s.end}</span>
      {(s.room || (ab && s.week)) && <span>{[s.room, ab && s.week ? `Sem. ${s.week}` : ''].filter(Boolean).join(' · ')}</span>}
      {(s.validFrom || s.validTo) && <span className="validity">{s.validFrom ? `dès ${s.validFrom.slice(8)}/${s.validFrom.slice(5, 7)}` : ''}{s.validTo ? ` → ${s.validTo.slice(8)}/${s.validTo.slice(5, 7)}` : ''}</span>}
    </button>
  );
}

