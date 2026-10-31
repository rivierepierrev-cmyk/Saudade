import { useState, type CSSProperties } from 'react';
import type { Agenda } from '../model.ts';
import type { AgendaEntry, Lesson } from '../plan.ts';
import { longDate } from './format.ts';
import { Window } from './Window.tsx';

interface Props {
  agenda: Agenda;
  lesson: Lesson;
  planned?: AgendaEntry['planned'];
  /** Set for a cancelled lesson. */
  cancelled?: { reason?: string };
  onEditSeance: () => void;
  onMoveSequence: () => void;
  onRemoveSequence: () => void;
  onCancelLesson: (reason: string) => void;
  onRestoreLesson: () => void;
  onClose: () => void;
}

/** One lesson of the agenda: what is done in it, and what can be done with it. */
export function LessonWindow({ agenda, lesson, planned, cancelled, onEditSeance, onMoveSequence, onRemoveSequence, onCancelLesson, onRestoreLesson, onClose }: Props) {
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');
  const cls = agenda.classes.find((c) => c.id === lesson.classId);
  const sequence = planned && agenda.sequences.find((s) => s.id === planned.sequenceId);
  const s = planned?.seance;
  const sections: [string, string | undefined][] = s
    ? [['Objectifs', s.objectives], ['Déroulé', s.activities], ['Matériel, documents', s.materials], ['Devoirs', s.homework]]
    : [];
  const filled = sections.filter(([, t]) => t?.trim());

  return (
    <Window
      title={`${cls?.name ?? '?'} · ${longDate(lesson.date)}`}
      subtitle={`${lesson.start}–${lesson.end}${lesson.room ? ` · salle ${lesson.room}` : ''}`}
      className="window-medium"
      onClose={onClose}
      footer={
        cancelled ? (
          <>
            <span className="spacer" />
            <button type="button" className="ghost" onClick={onClose}>Fermer</button>
            <button type="button" className="primary" onClick={onRestoreLesson}>Rétablir ce cours</button>
          </>
        ) : cancelling ? (
          <>
            <input className="reason" aria-label="Raison" placeholder="Raison (sortie, grève…)" value={reason} autoFocus onChange={(e) => setReason(e.target.value)} />
            <button type="button" className="ghost" onClick={() => setCancelling(false)}>Retour</button>
            <button type="button" className="danger" onClick={() => onCancelLesson(reason.trim())}>Confirmer l'annulation</button>
          </>
        ) : (
          <>
            {lesson.slotId && <button type="button" className="ghost danger-text" onClick={() => setCancelling(true)}>Annuler ce cours</button>}
            <span className="spacer" />
            <button type="button" className="primary" onClick={onClose}>Fermer</button>
          </>
        )
      }
    >
      {cancelled ? (
        <p className="warning">Cours annulé{cancelled.reason ? ` : ${cancelled.reason}` : ''}. Les séances ont été décalées au cours suivant.</p>
      ) : planned && s && sequence ? (
        <div className="lesson-detail" style={{ '--seq-color': sequence.color } as CSSProperties}>
          <p className="lesson-seq">
            <span className="dot" aria-hidden="true" />
            {sequence.title} · séance {planned.index + 1}/{planned.total}
            {planned.parts > 1 && ` · partie ${planned.part}/${planned.parts}`}
          </p>
          <h3>{s.title}</h3>
          {filled.length ? (
            filled.map(([title, text]) => (
              <section key={title}>
                <h4>{title}</h4>
                <p className="prewrap">{text}</p>
              </section>
            ))
          ) : (
            <p className="muted">Rien n'est encore noté pour cette séance.</p>
          )}
          <div className="lesson-actions">
            <button type="button" className="ghost" onClick={onEditSeance}>Modifier la séance</button>
            <button type="button" className="ghost" onClick={onMoveSequence}>Déplacer la séquence…</button>
            <button type="button" className="ghost danger-text" onClick={onRemoveSequence}>Retirer la séquence de {cls?.name}</button>
          </div>
        </div>
      ) : (
        <p className="muted">Cours libre : aucune séance prévue. Glissez une séquence sur ce cours pour la commencer ici.</p>
      )}
      {cancelling && <p className="muted small">Les séances de ce cours et des suivants passeront au cours d'après.</p>}
    </Window>
  );
}
