import { useEffect, useRef, useState } from 'react';
import type { Closure } from '../model.ts';
import { publicHolidaysBetween } from '../holidays.ts';
import { closuresToRows, emptyRow, rowDays, rowError, rowErrorText, rowsToClosures, setMode, setStart, sortRows, type ClosureRow } from '../closureRows.ts';
import type { ISODate } from '../dates.ts';

interface Props {
  closures: Closure[];
  /** School year, used by « Ajouter les jours fériés ». */
  yearStart: ISODate;
  yearEnd: ISODate;
  onSave: (closures: Closure[]) => void;
  onClose: () => void;
}

/**
 * Window listing the days without lessons: one line per holiday, a single day or from one date to another.
 * Mount it to open it: it edits a copy of `closures`, which only changes through `onSave`.
 */
export function HolidaysWindow({ closures, yearStart, yearEnd, onSave, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [rows, setRows] = useState<ClosureRow[]>(() => sortRows(closuresToRows(closures)));
  const [showErrors, setShowErrors] = useState(false);
  const focusRow = useRef<string | null>(null);

  useEffect(() => {
    const d = dialog.current;
    if (d && !d.open) d.showModal();
    return () => d?.close();
  }, []);

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
  const addPublicHolidays = () => {
    const taken = new Set(rows.map((r) => r.start));
    const missing = closuresToRows(publicHolidaysBetween(yearStart, yearEnd).filter((c) => !taken.has(c.start)));
    setRows((rs) => sortRows([...rs, ...missing]));
  };

  const invalid = rows.filter((r) => rowError(r));
  const save = () => {
    if (invalid.length) {
      setShowErrors(true);
      document.querySelector<HTMLInputElement>(`[data-row="${invalid[0].id}"] input[type=date]`)?.focus();
      return;
    }
    onSave(rowsToClosures(rows));
  };

  return (
    <dialog ref={dialog} className="window" aria-labelledby="holidays-title" onCancel={(e) => { e.preventDefault(); onClose(); }}>
      <header className="window-head">
        <h2 id="holidays-title">Vacances et jours sans cours</h2>
        <p>Aucune séance n'est placée ces jours-là : les séquences sont décalées après.</p>
      </header>

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
                <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </button>
            </div>
          );
        })}
      </div>

      <div className="add-bar">
        <button type="button" className="ghost" onClick={add}>+ Ajouter une ligne</button>
        <button type="button" className="ghost" onClick={addPublicHolidays}>Ajouter les jours fériés</button>
      </div>

      <footer className="window-foot">
        {showErrors && invalid.length > 0 && <span className="error">{invalid.length === 1 ? 'Une ligne est incomplète.' : `${invalid.length} lignes sont incomplètes.`}</span>}
        <button type="button" className="ghost" onClick={onClose}>Annuler</button>
        <button type="button" className="primary" onClick={save}>Enregistrer</button>
      </footer>
    </dialog>
  );
}
