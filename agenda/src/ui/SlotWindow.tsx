import { useState } from 'react';
import type { Agenda, TimetableSlot } from '../model.ts';
import type { Weekday } from '../dates.ts';
import { minutes } from '../dates.ts';
import { slotConflicts } from '../edit.ts';
import { DAY_NAMES } from './format.ts';
import { Window } from './Window.tsx';

export type SlotDraft = Omit<TimetableSlot, 'id'> & { id?: string };

interface Props {
  agenda: Agenda;
  slot: SlotDraft;
  onSave: (slot: SlotDraft) => void;
  onDelete?: () => void;
  onClose: () => void;
}

/** Edits one lesson of the timetable: class, day, times, room, A/B week, and the period it is valid. */
export function SlotWindow({ agenda, slot, onSave, onDelete, onClose }: Props) {
  const [draft, setDraft] = useState<SlotDraft>(slot);
  const [showErrors, setShowErrors] = useState(false);
  const set = (change: Partial<SlotDraft>) => setDraft((d) => ({ ...d, ...change }));
  const ab = Boolean(agenda.calendar.abWeeks);
  const groups = agenda.classes.find((c) => c.id === draft.classId)?.groups ?? [];

  const timesOk = /^\d{1,2}:\d{2}$/.test(draft.start) && /^\d{1,2}:\d{2}$/.test(draft.end);
  const error = !draft.classId
    ? 'Choisissez une classe.'
    : !timesOk
      ? "Choisissez l'heure de début et de fin."
      : minutes(draft.end) <= minutes(draft.start)
        ? 'La fin est avant le début.'
        : draft.validFrom && draft.validTo && draft.validTo < draft.validFrom
          ? 'La période de validité est inversée.'
          : undefined;
  const conflicts = !error ? slotConflicts(agenda.timetable, draft) : [];
  const className = (id: string) => agenda.classes.find((c) => c.id === id)?.name ?? '?';

  const save = () => {
    if (error) return setShowErrors(true);
    onSave({ ...draft, room: draft.room?.trim() || undefined, week: ab ? draft.week : undefined, groupId: groups.some((g) => g.id === draft.groupId) ? draft.groupId : undefined });
  };

  return (
    <Window
      title={slot.id ? 'Modifier le cours' : 'Nouveau cours'}
      className="window-narrow"
      onClose={onClose}
      footer={
        <>
          {onDelete && <button type="button" className="danger" onClick={onDelete}>Supprimer</button>}
          <span className="spacer" />
          <button type="button" className="ghost" onClick={onClose}>Annuler</button>
          <button type="button" className="primary" onClick={save}>Enregistrer</button>
        </>
      }
    >
      <div className="form">
        <label>
          <span>Classe</span>
          <select value={draft.classId} onChange={(e) => set({ classId: e.target.value, groupId: undefined })}>
            {!draft.classId && <option value="">Choisir…</option>}
            {agenda.classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        {groups.length > 0 && (
          <label>
            <span>Groupe</span>
            <select value={draft.groupId ?? ''} onChange={(e) => set({ groupId: e.target.value || undefined })}>
              <option value="">Classe entière</option>
              {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </label>
        )}
        <label>
          <span>Jour</span>
          <select value={draft.weekday} onChange={(e) => set({ weekday: Number(e.target.value) as Weekday })}>
            {[1, 2, 3, 4, 5, 6].map((d) => <option key={d} value={d}>{DAY_NAMES[d]}</option>)}
          </select>
        </label>
        <div className="form-pair">
          <label>
            <span>Début</span>
            <input type="time" step={300} value={draft.start} onChange={(e) => set({ start: e.target.value })} />
          </label>
          <label>
            <span>Fin</span>
            <input type="time" step={300} value={draft.end} onChange={(e) => set({ end: e.target.value })} />
          </label>
        </div>
        <label>
          <span>Salle</span>
          <input value={draft.room ?? ''} placeholder="Facultatif" onChange={(e) => set({ room: e.target.value })} />
        </label>
        {ab && (
          <label>
            <span>Semaines</span>
            <select value={draft.week ?? ''} onChange={(e) => set({ week: (e.target.value || undefined) as SlotDraft['week'] })}>
              <option value="">Toutes les semaines</option>
              <option value="A">Semaine A seulement</option>
              <option value="B">Semaine B seulement</option>
            </select>
          </label>
        )}
        <fieldset>
          <legend>Si l'emploi du temps change en cours d'année</legend>
          <div className="form-pair">
            <label>
              <span>À partir du</span>
              <input type="date" value={draft.validFrom ?? ''} onChange={(e) => set({ validFrom: e.target.value || undefined })} />
            </label>
            <label>
              <span>Jusqu'au</span>
              <input type="date" value={draft.validTo ?? ''} min={draft.validFrom} onChange={(e) => set({ validTo: e.target.value || undefined })} />
            </label>
          </div>
        </fieldset>
        {showErrors && error && <p className="error" role="alert">{error}</p>}
        {conflicts.length > 0 && (
          <p className="warning" role="status">
            Même heure que : {conflicts.map((c) => `${className(c.classId)} (${DAY_NAMES[c.weekday].toLowerCase()} ${c.start}–${c.end})`).join(', ')}.
          </p>
        )}
      </div>
    </Window>
  );
}
