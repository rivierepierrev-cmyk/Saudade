import { useMemo, useState } from 'react';
import type { Agenda } from '../model.ts';
import type { ISODate } from '../dates.ts';
import { newId } from '../edit.ts';
import { previewPlacement } from '../plan.ts';
import { closuresBetween, proposePlacement, putPlacement } from '../placements.ts';
import { sameTrack, trackKey, trackName, visibleTracks, type Track } from '../tracks.ts';
import { longDate, plural, shortDate, shortDay } from './format.ts';
import { Window } from './Window.tsx';

export interface PlacementRequest {
  sequenceId: string;
  /** Where it was dropped (a class or one of its groups); none: the window asks. */
  target?: Track;
  /** undefined: after the previous séquence of each target. */
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

/**
 * What placing a séquence gives, before it is done, for each class or group it goes to: every séance
 * with its date, the end, what moves. Moving a placed séquence works the same way, for its one target.
 */
export function PlacementWindow({ agenda, request, today, onConfirm, onRemove, onClose }: Props) {
  const moving = Boolean(request.placementId);
  const tracks = visibleTracks(agenda);
  const [targets, setTargets] = useState<Track[]>(() => (request.target ? [request.target] : []));
  const [shown, setShown] = useState<string | undefined>(request.target && trackKey(request.target));
  const [mode, setMode] = useState<'date' | 'after'>(request.start ? 'date' : 'after');
  const [date, setDate] = useState<ISODate>(request.start ?? today);
  // One placement id per target, kept while the window is open.
  const [ids] = useState(() => new Map<string, string>());
  const idFor = (t: Track) => {
    if (moving) return request.placementId!;
    const key = trackKey(t);
    if (!ids.has(key)) ids.set(key, newId('place'));
    return ids.get(key)!;
  };
  const sequence = agenda.sequences.find((s) => s.id === request.sequenceId);
  const start = mode === 'date' && date ? date : undefined;

  const previews = useMemo(
    () =>
      targets.map((t) => {
        const id = idFor(t);
        const proposal = proposePlacement(agenda, request.sequenceId, t, start, today, id);
        const preview = previewPlacement(agenda, proposal.placement, proposal.index);
        const alone = !start && !agenda.placements.some((p) => sameTrack(p, t) && p.id !== id);
        return { track: t, key: trackKey(t), proposal, preview, alone };
      }),
    [agenda, request.sequenceId, targets, start, today],
  );
  const detail = previews.find((p) => p.key === shown) ?? previews[0];

  if (!sequence) return null;

  const toggle = (t: Track, on: boolean) => {
    setTargets((list) => (on ? [...list.filter((x) => !sameTrack(x, t)), t] : list.filter((x) => !sameTrack(x, t))));
    if (on) setShown(trackKey(t));
  };
  const confirm = () => {
    // Targets are independent (each has its own chain): place them one after the other.
    let next = agenda;
    for (const t of targets) {
      const { placement, index } = proposePlacement(next, request.sequenceId, t, start, today, idFor(t));
      next = putPlacement(next, placement, index);
    }
    onConfirm(next);
  };
  const ready = previews.length > 0 && previews.every((p) => p.preview.result?.start);
  const byClass = agenda.classes.map((c) => ({ c, tracks: tracks.filter((t) => t.classId === c.id) })).filter((x) => x.tracks.length);

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
          <button type="button" className="primary" disabled={!ready} onClick={confirm}>
            {moving ? 'Déplacer' : targets.length > 1 ? `Placer sur ${targets.length} classes ou groupes` : 'Placer'}
          </button>
        </>
      }
    >
      <div className="form placement-form">
        {moving ? (
          <label>
            <span>Pour</span>
            <select
              value={targets[0] ? trackKey(targets[0]) : ''}
              onChange={(e) => {
                const t = tracks.find((x) => trackKey(x) === e.target.value);
                if (t) {
                  setTargets([t]);
                  setShown(trackKey(t));
                }
              }}
            >
              {tracks.map((t) => <option key={trackKey(t)} value={trackKey(t)}>{trackName(agenda, t)}</option>)}
            </select>
          </label>
        ) : (
          <fieldset className="targets">
            <legend>Pour quelles classes ou quels groupes ?</legend>
            {byClass.map(({ c, tracks: own }) => (
              <div key={c.id} className="target-class">
                {own.map((t) => {
                  const on = targets.some((x) => sameTrack(x, t));
                  return (
                    <label key={trackKey(t)} className={`check target${on ? ' on' : ''}`}>
                      <input type="checkbox" checked={on} onChange={(e) => toggle(t, e.target.checked)} />
                      {t.groupId ? trackName(agenda, t) : own.length > 1 ? `${c.name} · classe entière` : c.name}
                    </label>
                  );
                })}
              </div>
            ))}
          </fieldset>
        )}
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

      {sequence.seances.length === 0 && <p className="warning">Cette séquence n'a aucune séance : ajoutez-en dans l'onglet Séquences.</p>}
      {previews.length === 0 && <p className="muted">Cochez au moins une classe ou un groupe.</p>}

      {previews.length > 1 && (
        <ul className="target-summaries" aria-label="Résumé par classe ou groupe">
          {previews.map((p) => {
            const r = p.preview.result;
            return (
              <li key={p.key}>
                <button type="button" aria-pressed={p.key === detail?.key} onClick={() => setShown(p.key)}>
                  <b>{trackName(agenda, p.track)}</b>
                  <span>{r?.start && r.end ? `${shortDay(r.start)} → ${shortDay(r.end)}` : 'aucun cours'}</span>
                  {(p.preview.warnings.length > 0 || p.preview.shifted.length > 0) && <span className="warn-icon" aria-label="À vérifier">!</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {detail && sequence.seances.length > 0 && <Detail agenda={agenda} name={trackName(agenda, detail.track)} track={detail.track} preview={detail.preview} alone={detail.alone} sequenceSeances={sequence.seances} />}
    </Window>
  );
}

function Detail({ agenda, name, track, preview, alone, sequenceSeances }: {
  agenda: Agenda;
  name: string;
  track: Track;
  preview: ReturnType<typeof previewPlacement>;
  alone: boolean;
  sequenceSeances: { id: string; title: string }[];
}) {
  const result = preview.result;
  if (!result?.start || !result.end) return <p className="warning">Aucun cours de {name} après cette date avant la fin de l'année.</p>;
  const skipped = closuresBetween(agenda, result.start, result.end, track.classId);
  return (
    <>
      <div className="placement-summary" aria-live="polite">
        <p className="big">
          {plural(result.seances.length, 'séance')} pour {name}, du <strong>{shortDay(result.start)}</strong> au <strong>{shortDay(result.end)}</strong>
        </p>
        <p className="end-line">Fin de la séquence : <strong>{longDate(result.end)}</strong></p>
        {alone && <p className="muted small">{name} n'a pas d'autre séquence : elle commence au premier cours à partir d'aujourd'hui.</p>}
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
      <ol className="placement-list">
        {result.seances.map((s) => (
          <li key={s.seance.id}>
            <span className="when">
              {s.lessons.map((l, k) => <span key={k}>{shortDay(l.date)} · {l.start}</span>)}
            </span>
            <span className="what">
              <strong>{s.index + 1}. {s.seance.title}</strong>
              {s.interrupted && <span className="pill warn">coupée par des vacances</span>}
              {s.seance.objectives && <span className="muted small">{s.seance.objectives}</span>}
            </span>
          </li>
        ))}
        {Array.from({ length: result.unscheduled }, (_, i) => {
          const s = sequenceSeances[result.seances.length + i];
          return (
            <li key={s.id} className="unscheduled">
              <span className="when">Pas de cours</span>
              <span className="what"><strong>{result.seances.length + i + 1}. {s.title}</strong></span>
            </li>
          );
        })}
      </ol>
    </>
  );
}
