import { useMemo, useState } from 'react';
import type { Agenda } from '../model.ts';
import type { ISODate } from '../dates.ts';
import { newId } from '../edit.ts';
import { previewPlacement } from '../plan.ts';
import { closuresBetween, proposePlacement, putPlacement } from '../placements.ts';
import { longDate, plural, shortDate, shortDay } from './format.ts';
import { Window } from './Window.tsx';

export interface PlacementRequest {
  sequenceId: string;
  classId: string;
  /** undefined: after the class's previous séquence. */
  start?: ISODate;
  /** Set when moving a séquence already placed. */
  placementId?: string;
}

interface Props {
  agenda: Agenda;
  request: PlacementRequest;
  today: ISODate;
  onConfirm: (agenda: Agenda) => void;
  onRemove?: () => void;
  onClose: () => void;
}

/** What placing (or moving) a séquence on a class gives, before it is done: every séance with its date, the end, what moves. */
export function PlacementWindow({ agenda, request, today, onConfirm, onRemove, onClose }: Props) {
  const [classId, setClassId] = useState(request.classId);
  const [mode, setMode] = useState<'date' | 'after'>(request.start ? 'date' : 'after');
  const [date, setDate] = useState<ISODate>(request.start ?? today);
  const [id] = useState(() => request.placementId ?? newId('place'));
  const sequence = agenda.sequences.find((s) => s.id === request.sequenceId);
  const className = (cid: string) => agenda.classes.find((c) => c.id === cid)?.name ?? '?';

  const proposal = useMemo(
    () => proposePlacement(agenda, request.sequenceId, classId, mode === 'date' && date ? date : undefined, today, id),
    [agenda, request.sequenceId, classId, mode, date, today, id],
  );
  const preview = useMemo(() => previewPlacement(agenda, proposal.placement, proposal.index), [agenda, proposal]);
  const result = preview.result;
  const skipped = result?.start && result.end ? closuresBetween(agenda, result.start, result.end, classId) : [];
  const alone = mode === 'after' && !agenda.placements.some((p) => p.classId === classId && p.id !== id);

  if (!sequence) return null;
  const moving = Boolean(request.placementId);

  return (
    <Window
      title={`${moving ? 'Déplacer' : 'Placer'} « ${sequence.title} »`}
      className="window-medium"
      onClose={onClose}
      footer={
        <>
          {onRemove && <button type="button" className="danger" onClick={onRemove}>Retirer de la classe</button>}
          <span className="spacer" />
          <button type="button" className="ghost" onClick={onClose}>Annuler</button>
          <button
            type="button"
            className="primary"
            disabled={!result?.start}
            onClick={() => onConfirm(putPlacement(agenda, proposal.placement, proposal.index))}
          >
            {moving ? 'Déplacer' : 'Placer'}
          </button>
        </>
      }
    >
      <div className="form placement-form">
        <label>
          <span>Classe</span>
          <select value={classId} onChange={(e) => setClassId(e.target.value)}>
            {agenda.classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <div className="start-choice" role="radiogroup" aria-label="Début">
          <label className="check">
            <input type="radio" name="start" checked={mode === 'date'} onChange={() => setMode('date')} /> À partir du
          </label>
          <input type="date" aria-label="Date de début" value={date} min={agenda.calendar.start} max={agenda.calendar.end} onChange={(e) => { setDate(e.target.value); setMode('date'); }} />
          <label className="check">
            <input type="radio" name="start" checked={mode === 'after'} onChange={() => setMode('after')} /> À la suite de la séquence précédente
          </label>
        </div>
      </div>

      {sequence.seances.length === 0 ? (
        <p className="warning">Cette séquence n'a aucune séance : ajoutez-en dans l'onglet Séquences.</p>
      ) : result?.start && result.end ? (
        <div className="placement-summary" aria-live="polite">
          <p className="big">
            {plural(result.seances.length, 'séance')} pour {className(classId)}, du <strong>{shortDay(result.start)}</strong> au <strong>{shortDay(result.end)}</strong>
          </p>
          <p className="end-line">Fin de la séquence : <strong>{longDate(result.end)}</strong></p>
          {alone && <p className="muted small">{className(classId)} n'a pas d'autre séquence : elle commence au premier cours à partir d'aujourd'hui.</p>}
          {skipped.length > 0 && (
            <p className="skip-line">Saute : {skipped.map((c) => (c.start === c.end ? `${c.label} (${shortDate(c.start)})` : `${c.label} (${shortDate(c.start)} → ${shortDate(c.end)})`)).join(', ')}</p>
          )}
          {preview.shifted.length > 0 && (
            <p className="shift-line">
              Décale : {preview.shifted.map((s) => `${s.title} (fin ${s.endBefore ? shortDate(s.endBefore) : '—'} → ${s.endAfter ? shortDate(s.endAfter) : 'hors année'})`).join(', ')}
            </p>
          )}
          {preview.warnings.map((w) => <p key={w.kind} className="warning">{w.message}</p>)}
        </div>
      ) : (
        <p className="warning">Aucun cours de {className(classId)} après cette date avant la fin de l'année.</p>
      )}

      {result && result.seances.length > 0 && (
        <ol className="placement-list">
          {result.seances.map((s) => (
            <li key={s.seance.id}>
              <span className="when">
                {s.lessons.map((l, k) => (
                  <span key={k}>{shortDay(l.date)} · {l.start}</span>
                ))}
              </span>
              <span className="what">
                <strong>{s.index + 1}. {s.seance.title}</strong>
                {s.interrupted && <span className="pill warn">coupée par des vacances</span>}
                {s.seance.objectives && <span className="muted small">{s.seance.objectives}</span>}
              </span>
            </li>
          ))}
          {Array.from({ length: result.unscheduled }, (_, i) => {
            const s = sequence.seances[result.seances.length + i];
            return (
              <li key={s.id} className="unscheduled">
                <span className="when">Pas de cours</span>
                <span className="what"><strong>{result.seances.length + i + 1}. {s.title}</strong></span>
              </li>
            );
          })}
        </ol>
      )}
    </Window>
  );
}
