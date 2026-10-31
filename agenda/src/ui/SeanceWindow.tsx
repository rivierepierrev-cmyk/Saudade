import { useState } from 'react';
import type { Seance, Sequence } from '../model.ts';
import { Window } from './Window.tsx';

interface Props {
  seance: Seance;
  /** Position in its séquence, 1-based; undefined for a séance not added yet. */
  number?: number;
  sequence: Sequence;
  /** Other séquences it can be copied into. */
  others: Sequence[];
  onSave: (seance: Seance) => void;
  onDelete?: () => void;
  onCopyTo?: (seance: Seance, sequenceId: string) => void;
  onClose: () => void;
}

/** What happens during a séance: objectives, activities, materials, homework. The same page opens from the séquence and, later, from the agenda. */
export function SeanceWindow({ seance, number, sequence, others, onSave, onDelete, onCopyTo, onClose }: Props) {
  const [draft, setDraft] = useState<Seance>(seance);
  const [copyTarget, setCopyTarget] = useState(others[0]?.id ?? '');
  const [copied, setCopied] = useState<string | undefined>();
  const set = (change: Partial<Seance>) => setDraft((d) => ({ ...d, ...change }));
  const clean = (): Seance => ({ ...draft, title: draft.title.trim() || `Séance ${number ?? sequence.seances.length + 1}` });

  return (
    <Window
      title={number ? `Séance ${number} · ${sequence.title}` : `Nouvelle séance · ${sequence.title}`}
      className="window-medium"
      onClose={onClose}
      footer={
        <>
          {onDelete && <button type="button" className="danger" onClick={onDelete}>Supprimer</button>}
          <span className="spacer" />
          <button type="button" className="ghost" onClick={onClose}>Annuler</button>
          <button type="button" className="primary" onClick={() => onSave(clean())}>Enregistrer</button>
        </>
      }
    >
      <div className="form">
        <div className="form-pair title-pair">
          <label>
            <span>Titre</span>
            <input autoFocus value={draft.title} onChange={(e) => set({ title: e.target.value })} />
          </label>
          <label>
            <span>Durée</span>
            <select value={draft.slots ?? 1} onChange={(e) => set({ slots: Number(e.target.value) === 1 ? undefined : Number(e.target.value) })}>
              <option value={1}>1 cours</option>
              <option value={2}>2 cours</option>
              <option value={3}>3 cours</option>
              <option value={4}>4 cours</option>
            </select>
          </label>
        </div>
        <label>
          <span>Objectifs</span>
          <textarea rows={2} value={draft.objectives ?? ''} placeholder="Ce que les élèves sauront faire à la fin" onChange={(e) => set({ objectives: e.target.value })} />
        </label>
        <label>
          <span>Déroulé</span>
          <textarea rows={6} value={draft.activities ?? ''} placeholder={'10 min : rappel\n20 min : activité\n…'} onChange={(e) => set({ activities: e.target.value })} />
        </label>
        <div className="form-pair">
          <label>
            <span>Matériel, documents</span>
            <textarea rows={3} value={draft.materials ?? ''} onChange={(e) => set({ materials: e.target.value })} />
          </label>
          <label>
            <span>Devoirs</span>
            <textarea rows={3} value={draft.homework ?? ''} onChange={(e) => set({ homework: e.target.value })} />
          </label>
        </div>
        {onCopyTo && others.length > 0 && (
          <div className="copy-to">
            <label>
              <span>Réutiliser dans une autre séquence</span>
              <select value={copyTarget} onChange={(e) => { setCopyTarget(e.target.value); setCopied(undefined); }}>
                {others.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
              </select>
            </label>
            <button
              type="button"
              className="ghost"
              onClick={() => {
                onCopyTo(clean(), copyTarget);
                setCopied(others.find((s) => s.id === copyTarget)?.title);
              }}
            >
              Copier
            </button>
            {copied && <span className="note" role="status">Copiée à la fin de « {copied} ».</span>}
          </div>
        )}
      </div>
    </Window>
  );
}
