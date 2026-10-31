import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import type { Agenda, Seance, Sequence } from '../model.ts';
import {
  addSeance, addSequence, duplicateSeance, duplicateSequence, moveSeance, removeSeance, removeSequence,
  sequenceLessons, updateSeance, updateSequence, weeklyLessons,
} from '../edit.ts';
import { number, plural, shortDate } from './format.ts';
import { plan } from '../plan.ts';
import { today } from '../dates.ts';
import { trackName, visibleTracks } from '../tracks.ts';
import { removePlacement } from '../placements.ts';
import { PlacementWindow, type PlacementRequest } from './PlacementWindow.tsx';
import { SeanceWindow } from './SeanceWindow.tsx';
import { TrashIcon } from './Window.tsx';

interface Props {
  agenda: Agenda;
  onChange: (agenda: Agenda) => void;
}

const summary = (s: Sequence) => {
  const lessons = sequenceLessons(s);
  return `${plural(s.seances.length, 'séance')}${lessons !== s.seances.length ? ` · ${plural(lessons, 'cours', 'cours')}` : ''}`;
};

/** The séquence library, and the builder where séances are blocks to order, duplicate and open. */
export function SequencesView({ agenda, onChange }: Props) {
  const { sequences } = agenda;
  const [selectedId, setSelectedId] = useState<string | undefined>(sequences[0]?.id);
  const [newTitle, setNewTitle] = useState('');
  const [editing, setEditing] = useState<{ seance: Seance; isNew: boolean } | undefined>();
  const [placing, setPlacing] = useState<PlacementRequest | undefined>();
  const selected = sequences.find((s) => s.id === selectedId) ?? sequences[0];

  const create = () => {
    const r = addSequence(agenda, newTitle);
    onChange(r.agenda);
    setSelectedId(r.id);
    setNewTitle('');
  };

  return (
    <div className="sequences-page">
      <aside className="card library" aria-label="Séquences">
        <h2>Séquences</h2>
        {sequences.length === 0 && <p className="muted">Une séquence est une suite de séances. Créez la première :</p>}
        <ul>
          {sequences.map((s) => (
            <li key={s.id}>
              <button type="button" className="seq-pick" aria-pressed={s.id === selected?.id} style={{ '--seq-color': s.color } as CSSProperties} onClick={() => setSelectedId(s.id)}>
                <span className="dot" aria-hidden="true" />
                <span className="seq-text">
                  <span className="seq-title">{s.title}</span>
                  <span className="muted small">{[s.subject, summary(s)].filter(Boolean).join(' · ')}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
        <form className="add-class" onSubmit={(e) => { e.preventDefault(); create(); }}>
          <input aria-label="Nouvelle séquence" placeholder="Titre de la séquence" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} />
          <button type="submit" className="ghost">Créer</button>
        </form>
      </aside>

      {selected ? (
        <Builder
          key={selected.id}
          agenda={agenda}
          sequence={selected}
          onChange={onChange}
          onOpen={(seance, isNew) => setEditing({ seance, isNew })}
          onDuplicated={setSelectedId}
          onDeleted={() => setSelectedId(sequences.find((s) => s.id !== selected.id)?.id)}
          onAssign={setPlacing}
        />
      ) : (
        <section className="card empty-builder">
          <p className="muted">Aucune séquence. Donnez-lui un titre à gauche, puis ajoutez ses séances comme des blocs.</p>
        </section>
      )}

      {placing && (
        <PlacementWindow
          key={JSON.stringify(placing)}
          agenda={agenda}
          request={placing}
          today={today()}
          onConfirm={(next) => { onChange(next); setPlacing(undefined); }}
          onRemove={placing.placementId ? () => { onChange(removePlacement(agenda, placing.placementId!)); setPlacing(undefined); } : undefined}
          onClose={() => setPlacing(undefined)}
        />
      )}

      {editing && selected && (
        <SeanceWindow
          seance={editing.seance}
          number={editing.isNew ? undefined : selected.seances.findIndex((s) => s.id === editing.seance.id) + 1}
          sequence={selected}
          others={sequences.filter((s) => s.id !== selected.id)}
          onSave={(seance) => {
            const { id, ...fields } = seance;
            onChange(editing.isNew ? addSeance(agenda, selected.id, fields).agenda : updateSeance(agenda, selected.id, id, fields));
            setEditing(undefined);
          }}
          onDelete={editing.isNew ? undefined : () => { onChange(removeSeance(agenda, selected.id, editing.seance.id)); setEditing(undefined); }}
          onCopyTo={(seance, to) => {
            const { id, ...fields } = seance;
            onChange(addSeance(agenda, to, fields).agenda);
          }}
          onClose={() => setEditing(undefined)}
        />
      )}
    </div>
  );
}

interface BuilderProps {
  agenda: Agenda;
  sequence: Sequence;
  onChange: (agenda: Agenda) => void;
  onOpen: (seance: Seance, isNew: boolean) => void;
  onDuplicated: (id: string) => void;
  onDeleted: () => void;
  onAssign: (request: PlacementRequest) => void;
}

interface Drag {
  from: number;
  over: number;
  startY: number;
  dy: number;
  /** Vertical middle of each block when the drag started. */
  mids: number[];
  height: number;
}

function Builder({ agenda, sequence, onChange, onOpen, onDuplicated, onDeleted, onAssign }: BuilderProps) {
  const [drag, setDrag] = useState<Drag | undefined>();
  const list = useRef<HTMLOListElement>(null);
  const { seances } = sequence;
  const lessons = sequenceLessons(sequence);

  const estimates = visibleTracks(agenda)
    .map((t) => ({ t, perWeek: weeklyLessons(agenda, t).lessons }))
    .filter((x) => x.perWeek > 0 && lessons > 0)
    .map(({ t, perWeek }) => `${trackName(agenda, t)} : ≈ ${plural(Math.ceil((lessons / perWeek) * 2) / 2, 'semaine')} (${number(perWeek)} cours/sem.)`);
  // Where this séquence is assigned, each class or group with its own dates.
  const result = useMemo(() => plan(agenda), [agenda]);
  const assigned = result.sequences.filter((s) => s.sequence.id === sequence.id);

  // Moving a block in the page can take the focus off its handle: put it back as soon as the list is redrawn,
  // before the next key press.
  const focusHandle = useRef<number | undefined>(undefined);
  useLayoutEffect(() => {
    if (focusHandle.current === undefined) return;
    list.current?.querySelectorAll<HTMLElement>('.handle')[focusHandle.current]?.focus();
    focusHandle.current = undefined;
  });
  const move = (from: number, to: number) => {
    if (to < 0 || to >= seances.length || from === to) return;
    focusHandle.current = to;
    onChange(moveSeance(agenda, sequence.id, from, to));
  };

  // Reordering with the pointer (mouse, pen or finger) on the handle.
  const startDrag = (index: number, e: ReactPointerEvent<HTMLElement>) => {
    if (e.button !== 0 || !list.current) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const cards = [...list.current.querySelectorAll<HTMLElement>(':scope > li')];
    const rects = cards.map((c) => c.getBoundingClientRect());
    const gap = rects.length > 1 ? rects[1].top - rects[0].bottom : 8;
    setDrag({ from: index, over: index, startY: e.clientY, dy: 0, mids: rects.map((r) => r.top + r.height / 2), height: rects[index].height + gap });
  };
  const moveDrag = (e: ReactPointerEvent<HTMLElement>) => {
    if (!drag) return;
    const dy = e.clientY - drag.startY;
    const center = drag.mids[drag.from] + dy;
    const over = drag.mids.filter((m, i) => i !== drag.from && m < center).length;
    setDrag({ ...drag, dy, over });
  };
  const endDrag = () => {
    if (!drag) return;
    const { from, over } = drag;
    setDrag(undefined);
    if (from !== over) onChange(moveSeance(agenda, sequence.id, from, over));
  };
  const shift = (i: number) => {
    if (!drag || i === drag.from) return 0;
    if (drag.from < drag.over && i > drag.from && i <= drag.over) return -drag.height;
    if (drag.from > drag.over && i >= drag.over && i < drag.from) return drag.height;
    return 0;
  };
  const onHandleKey = (index: number, e: KeyboardEvent) => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      move(index, index + (e.key === 'ArrowUp' ? -1 : 1));
    }
  };

  const deleteSeance = (s: Seance, i: number) => {
    const filled = [s.objectives, s.activities, s.materials, s.homework].some((t) => t?.trim());
    if (filled && !window.confirm(`Supprimer la séance ${i + 1}, « ${s.title} », et son contenu ?`)) return;
    onChange(removeSeance(agenda, sequence.id, s.id));
  };

  const deleteSequence = () => {
    const placed = agenda.placements.filter((p) => p.sequenceId === sequence.id).length;
    if (!window.confirm(`Supprimer « ${sequence.title} »${placed ? `, placée sur ${plural(placed, 'classe')}` : ''} ?`)) return;
    onChange(removeSequence(agenda, sequence.id));
    onDeleted();
  };

  return (
    <section className="card builder" aria-label={`Séquence ${sequence.title}`} style={{ '--seq-color': sequence.color } as CSSProperties}>
      <div className="builder-head">
        <input className="seq-title-input" aria-label="Titre de la séquence" value={sequence.title} onChange={(e) => onChange(updateSequence(agenda, sequence.id, { title: e.target.value }))} />
        <div className="builder-meta">
          <input aria-label="Matière ou niveau" placeholder="Matière, niveau…" value={sequence.subject ?? ''} onChange={(e) => onChange(updateSequence(agenda, sequence.id, { subject: e.target.value || undefined }))} />
          <input type="color" className="swatch" aria-label="Couleur de la séquence" value={sequence.color ?? '#4f7cff'} onChange={(e) => onChange(updateSequence(agenda, sequence.id, { color: e.target.value }))} />
          <button type="button" className="ghost" onClick={() => { const r = duplicateSequence(agenda, sequence.id); onChange(r.agenda); onDuplicated(r.id); }}>Dupliquer</button>
          <button type="button" className="ghost danger-text" onClick={deleteSequence}>Supprimer</button>
        </div>
        <p className="muted small">
          {seances.length ? summary(sequence) : 'Aucune séance.'}
          {estimates.length > 0 && <> — {estimates.join(' · ')}</>}
        </p>
        <div className="assigned" aria-label="Assignée à">
          <span className="muted small">Assignée à :</span>
          {assigned.length === 0 && <span className="muted small">aucune classe pour l'instant.</span>}
          {assigned.map((a) => {
            const t = { classId: a.placement.classId, groupId: a.placement.groupId };
            return (
              <span key={a.placement.id} className="assigned-chip">
                <button type="button" onClick={() => onAssign({ sequenceId: sequence.id, target: t, start: a.start, placementId: a.placement.id })}>
                  <b>{trackName(agenda, t)}</b> {a.start && a.end ? `${shortDate(a.start)} → ${shortDate(a.end)}` : 'sans cours'}
                </button>
              </span>
            );
          })}
          <button type="button" className="ghost small-btn" disabled={agenda.classes.length === 0} onClick={() => onAssign({ sequenceId: sequence.id })}>Assigner à des classes…</button>
        </div>
      </div>

      <ol className={`blocks${drag ? ' dragging' : ''}`} ref={list}>
        {seances.map((s, i) => {
          const isDragged = drag?.from === i;
          const slots = Math.max(1, s.slots ?? 1);
          return (
            <li
              key={s.id}
              className={`block${isDragged ? ' lifted' : ''}`}
              style={{ transform: `translateY(${isDragged ? drag!.dy : shift(i)}px)` }}
            >
              <button
                type="button"
                className="handle"
                aria-label={`Déplacer la séance ${i + 1} (flèches haut et bas)`}
                title="Glisser pour déplacer"
                onPointerDown={(e) => startDrag(i, e)}
                onPointerMove={moveDrag}
                onPointerUp={endDrag}
                onPointerCancel={() => setDrag(undefined)}
                onKeyDown={(e) => onHandleKey(i, e)}
              >
                <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><g fill="currentColor"><circle cx="9" cy="6" r="1.6" /><circle cx="15" cy="6" r="1.6" /><circle cx="9" cy="12" r="1.6" /><circle cx="15" cy="12" r="1.6" /><circle cx="9" cy="18" r="1.6" /><circle cx="15" cy="18" r="1.6" /></g></svg>
              </button>
              <span className="block-number" aria-hidden="true">{i + 1}</span>
              <button type="button" className="block-body" onClick={() => onOpen(s, false)}>
                <span className="block-title">{s.title}{slots > 1 && <span className="pill">{slots} cours</span>}</span>
                {s.objectives && <span className="muted small block-preview">{s.objectives}</span>}
              </button>
              <div className="block-actions">
                <button type="button" className="icon" aria-label={`Monter la séance ${i + 1}`} title="Monter" disabled={i === 0} onClick={() => move(i, i - 1)}>↑</button>
                <button type="button" className="icon" aria-label={`Descendre la séance ${i + 1}`} title="Descendre" disabled={i === seances.length - 1} onClick={() => move(i, i + 1)}>↓</button>
                <button type="button" className="icon" aria-label={`Dupliquer la séance ${i + 1}`} title="Dupliquer" onClick={() => onChange(duplicateSeance(agenda, sequence.id, s.id).agenda)}>
                  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M8 8h11v11H8zM5 16V5h11" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /></svg>
                </button>
                <button type="button" className="icon delete" aria-label={`Supprimer la séance ${i + 1}`} title="Supprimer" onClick={() => deleteSeance(s, i)}>
                  <TrashIcon />
                </button>
              </div>
            </li>
          );
        })}
      </ol>

      <button type="button" className="add-block" onClick={() => onOpen({ id: '', title: '' }, true)}>+ Ajouter une séance</button>
    </section>
  );
}

