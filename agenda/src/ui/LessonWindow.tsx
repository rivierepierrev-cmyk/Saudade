import { useState, type CSSProperties } from 'react';
import type { Agenda } from '../model.ts';
import type { AgendaEntry, Lesson } from '../plan.ts';
import { longDate } from './format.ts';
import { trackName } from '../tracks.ts';
import { Window } from './Window.tsx';

interface Props {
  agenda: Agenda;
  lesson: Lesson;
  planned?: AgendaEntry['planned'];
  /** Set for a lesson that gives no séance: cancelled, or its séance postponed. */
  cancelled?: { reason?: string; postponed?: boolean };
  done: boolean;
  onEditSeance: () => void;
  onMoveSequence: () => void;
  onRemoveSequence: () => void;
  onToggleDone: () => void;
  onCancelLesson: (reason: string) => void;
  onPostpone: (reason: string) => void;
  onRestoreLesson: () => void;
  onClose: () => void;
}

/** One lesson of the agenda: what is done in it, and what can be done with it. */
export function LessonWindow(props: Props) {
  const { agenda, lesson, planned, cancelled, done, onClose } = props;
  const [asking, setAsking] = useState<'cancel' | 'postpone' | undefined>();
  const [reason, setReason] = useState('');
  const sequence = planned && agenda.sequences.find((s) => s.id === planned.sequenceId);
  const s = planned?.seance;
  const sections: [string, string | undefined][] = s
    ? [['Objectifs', s.objectives], ['Déroulé', s.activities], ['Matériel, documents', s.materials], ['Devoirs', s.homework]]
    : [];
  const filled = sections.filter(([, t]) => t?.trim());
  const name = trackName(agenda, lesson);

  return (
    <Window
      title={`${name} · ${longDate(lesson.date)}`}
      subtitle={`${lesson.start}–${lesson.end}${lesson.room ? ` · salle ${lesson.room}` : ''}`}
      className="window-medium"
      onClose={onClose}
      footer={
        cancelled ? (
          <>
            <span className="spacer" />
            <button type="button" className="ghost" onClick={onClose}>Fermer</button>
            <button type="button" className="primary" onClick={props.onRestoreLesson}>{cancelled.postponed ? 'Annuler le report' : 'Rétablir ce cours'}</button>
          </>
        ) : asking ? (
          <>
            <input
              className="reason"
              aria-label="Raison"
              placeholder={asking === 'cancel' ? 'Raison (sortie, grève…)' : 'Note (pas fini, absents…)'}
              value={reason}
              autoFocus
              onChange={(e) => setReason(e.target.value)}
            />
            <button type="button" className="ghost" onClick={() => setAsking(undefined)}>Retour</button>
            {asking === 'cancel' ? (
              <button type="button" className="danger" onClick={() => props.onCancelLesson(reason.trim())}>Confirmer l'annulation</button>
            ) : (
              <button type="button" className="primary" onClick={() => props.onPostpone(reason.trim())}>Reporter la séance</button>
            )}
          </>
        ) : (
          <>
            {lesson.slotId && <button type="button" className="ghost danger-text" onClick={() => setAsking('cancel')}>Annuler ce cours</button>}
            <span className="spacer" />
            <button type="button" className="primary" onClick={onClose}>Fermer</button>
          </>
        )
      }
    >
      {cancelled?.postponed ? (
        <p className="warning">Séance non faite{cancelled.reason ? ` : ${cancelled.reason}` : ''}. Elle est passée au cours suivant, et la suite a été décalée.</p>
      ) : cancelled ? (
        <p className="warning">Cours annulé{cancelled.reason ? ` : ${cancelled.reason}` : ''}. Les séances ont été décalées au cours suivant.</p>
      ) : planned && s && sequence ? (
        <div className="lesson-detail" style={{ '--seq-color': sequence.color } as CSSProperties}>
          <p className="lesson-seq">
            <span className="dot" aria-hidden="true" />
            {sequence.title} · séance {planned.index + 1}/{planned.total}
            {planned.parts > 1 && ` · partie ${planned.part}/${planned.parts}`}
            {done && <span className="pill done-pill">Faite</span>}
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
            <button type="button" className={done ? 'primary' : 'ghost'} aria-pressed={done} onClick={props.onToggleDone}>✓ {done ? 'Faite' : 'Marquer comme faite'}</button>
            {lesson.slotId && <button type="button" className="ghost" onClick={() => setAsking('postpone')}>Pas faite : reporter…</button>}
          </div>
          <div className="lesson-actions">
            <button type="button" className="ghost" onClick={props.onEditSeance}>Modifier la séance</button>
            <button type="button" className="ghost" onClick={props.onMoveSequence}>Déplacer la séquence…</button>
            <button type="button" className="ghost danger-text" onClick={props.onRemoveSequence}>Retirer la séquence de {name}</button>
          </div>
        </div>
      ) : (
        <p className="muted">Cours libre : aucune séance prévue. Glissez une séquence sur ce cours pour la commencer ici.</p>
      )}
      {asking === 'cancel' && <p className="muted small">Les séances de ce cours et des suivants passeront au cours d'après.</p>}
      {asking === 'postpone' && <p className="muted small">La séance n'a pas été faite (ou pas finie) : elle sera refaite au cours suivant, et tout ce qui suit se décale.</p>}
    </Window>
  );
}
