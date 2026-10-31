import { useEffect, useRef, useState } from 'react';
import type { SchoolCalendar } from '../model.ts';
import { publicHolidaysBetween } from '../holidays.ts';
import { closuresToRows, emptyRow, rowDays, rowError, rowErrorText, rowsToClosures, setMode, setStart, sortRows, type ClosureRow } from '../closureRows.ts';
import { TrashIcon, Window } from './Window.tsx';

interface Props {
  calendar: SchoolCalendar;
  onSave: (calendar: SchoolCalendar) => void;
  onClose: () => void;
}

/**
 * The school year and its days without lessons: one line per holiday, a single day or from one date to another.
 * Mount it to open it: it edits a copy of the calendar, which only changes through `onSave`.
 */
export function HolidaysWindow({ calendar, onSave, onClose }: Props) {
  const [yearStart, setYearStart] = useState(calendar.start);
  const [yearEnd, setYearEnd] = useState(calendar.end);
  const [rows, setRows] = useState<ClosureRow[]>(() => sortRows(closuresToRows(calendar.closures)));
  const [showErrors, setShowErrors] = useState(false);
  const focusRow = useRef<string | null>(null);

  useEffect(() => {
    if (!focusRow.current) return;
    document.querySelector<HTMLInputElement>(`[data-row="${focusRow.current}"] input`)?.focus();
    focusRow.current = null;
  });

  const update = (id: string, change: (r: ClosureRow) => ClosureRow) => setRows((rs) => rs.map((r) => (r.id === id ? change(r) : r)));
  const remove = (id: string) => setRows((rs) => rs.filter((r) => r.id !== id));
  const add = () => {
    const r = emptyRow();
    focusRow.current = r.id;
    setRows((rs) => [...rs, r]);
  };
  const yearError = !yearStart || !yearEnd ? 'Choisissez le premier et le dernier jour de cours.' : yearEnd <= yearStart ? "La fin de l'année est avant son début." : undefined;
  const addPublicHolidays = () => {
    if (yearError) return;
    const taken = new Set(rows.map((r) => r.start));
    const missing = closuresToRows(publicHolidaysBetween(yearStart, yearEnd).filter((c) => !taken.has(c.start)));
    setRows((rs) => sortRows([...rs, ...missing]));
  };

  const invalid = rows.filter((r) => rowError(r));
  const save = () => {
    if (yearError || invalid.length) {
      setShowErrors(true);
      const target = yearError ? '.year input' : `[data-row="${invalid[0].id}"] input[type=date]`;
      document.querySelector<HTMLInputElement>(target)?.focus();
      return;
    }
    onSave({ ...calendar, start: yearStart, end: yearEnd, closures: rowsToClosures(rows) });
  };

  const errorCount = invalid.length + (yearError ? 1 : 0);
  return (
    <Window
      title="Vacances et jours sans cours"
      subtitle="Aucune séance n'est placée ces jours-là : les séquences sont décalées après."
      onClose={onClose}
      footer={
        <>
          {showErrors && errorCount > 0 && <span className="error">{errorCount === 1 ? 'Une ligne est incomplète.' : `${errorCount} lignes sont incomplètes.`}</span>}
          <button type="button" className="ghost" onClick={onClose}>Annuler</button>
          <button type="button" className="primary" onClick={save}>Enregistrer</button>
        </>
      }
    >
      <div className={`year${showErrors && yearError ? ' has-error' : ''}`}>
        <span>Année scolaire : du</span>
        <input type="date" aria-label="Premier jour de cours" value={yearStart} onChange={(e) => setYearStart(e.target.value)} />
        <span>au</span>
        <input type="date" aria-label="Dernier jour de cours" value={yearEnd} min={yearStart || undefined} onChange={(e) => setYearEnd(e.target.value)} />
        {showErrors && yearError && <span className="note error">{yearError}</span>}
      </div>

      <div className="rows">
        {rows.length === 0 && <p className="empty">Aucune ligne. Ajoutez des vacances, un jour férié ou un pont.</p>}
        {rows.map((r) => {
          const error = showErrors ? rowError(r) : undefined;
          const days = rowDays(r);
          return (
            <div className={`row${error ? ' has-error' : ''}`} key={r.id} data-row={r.id}>
              <input
                className="label"
                aria-label="Nom"
                placeholder={r.mode === 'day' ? 'Jour férié, pont…' : 'Vacances de…'}
                value={r.label}
                onChange={(e) => update(r.id, (x) => ({ ...x, label: e.target.value }))}
              />
              <div className="mode" role="radiogroup" aria-label="Durée">
                <button type="button" role="radio" aria-checked={r.mode === 'day'} onClick={() => update(r.id, (x) => setMode(x, 'day'))}>Un jour</button>
                <button type="button" role="radio" aria-checked={r.mode === 'range'} onClick={() => update(r.id, (x) => setMode(x, 'range'))}>Période</button>
              </div>
              <div className="dates">
                {r.mode === 'range' && <span className="word">du</span>}
                {r.mode === 'day' && <span className="word">le</span>}
                <input type="date" aria-label={r.mode === 'day' ? 'Date' : 'Date de début'} value={r.start} onChange={(e) => update(r.id, (x) => setStart(x, e.target.value))} />
                {r.mode === 'range' && (
                  <>
                    <span className="word">au</span>
                    <input type="date" aria-label="Date de fin" value={r.end} min={r.start || undefined} onChange={(e) => update(r.id, (x) => ({ ...x, end: e.target.value }))} />
                  </>
                )}
              </div>
              <span className={error ? 'note error' : 'note'} aria-live="polite">
                {error ? rowErrorText[error] : days ? `${days} jour${days > 1 ? 's' : ''}` : ''}
              </span>
              <button type="button" className="delete" aria-label={`Supprimer ${r.label || 'la ligne'}`} title="Supprimer" onClick={() => remove(r.id)}>
                <TrashIcon />
              </button>
            </div>
          );
        })}
      </div>

      <div className="add-bar">
        <button type="button" className="ghost" onClick={add}>+ Ajouter une ligne</button>
        <button type="button" className="ghost" onClick={addPublicHolidays} disabled={Boolean(yearError)}>Ajouter les jours fériés</button>
      </div>
    </Window>
  );
}
