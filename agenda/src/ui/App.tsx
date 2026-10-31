import { useCallback, useEffect, useState } from 'react';
import type { Agenda } from '../model.ts';
import { HolidaysWindow } from './HolidaysWindow.tsx';
import { TimetableView } from './TimetableView.tsx';
import { SequencesView } from './SequencesView.tsx';
import { AgendaView } from './AgendaView.tsx';
import { loadAgenda, saveAgenda } from './storage.ts';
import { LevelOptions } from './LevelFilter.tsx';
import { FileMenu } from './FileMenu.tsx';
import { record, redo, startHistory, undo, type History } from '../history.ts';

type Tab = 'agenda' | 'timetable' | 'sequences';
const TAB_KEY = 'agenda.tab';

function initialTab(): Tab {
  try {
    const t = localStorage.getItem(TAB_KEY);
    return t === 'timetable' || t === 'sequences' ? t : 'agenda';
  } catch {
    return 'agenda';
  }
}

const fieldIds = new WeakMap<Element, string>();
let fieldCount = 0;

/** The text field being typed in, if any: its changes are grouped into one undo step. */
function typingKey(): string | undefined {
  const el = document.activeElement;
  if (!el || !(el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && ['text', 'search', ''].includes(el.type)))) return undefined;
  if (!fieldIds.has(el)) fieldIds.set(el, `field${fieldCount++}`);
  return fieldIds.get(el);
}

/** Ctrl+Z in a text field undoes the typing there; with a window open, the window comes first. */
const keepNativeUndo = () => {
  const el = document.activeElement;
  return el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && el.type !== 'checkbox' && el.type !== 'radio') || Boolean(document.querySelector('dialog[open]'));
};

export function App() {
  const [history, setHistory] = useState<History<Agenda>>(() => startHistory(loadAgenda()));
  const agenda = history.present;
  const setAgenda = useCallback((next: Agenda | ((a: Agenda) => Agenda)) => {
    const key = typingKey();
    setHistory((h) => record(h, typeof next === 'function' ? next(h.present) : next, Date.now(), key));
  }, []);
  const [status, setStatus] = useState('');
  const [tab, setTab] = useState<Tab>(initialTab);
  const [holidaysOpen, setHolidaysOpen] = useState(false);

  const doUndo = useCallback(() => {
    setHistory((h) => {
      if (h.past.length) setStatus('Modification annulée');
      return undo(h);
    });
  }, []);
  const doRedo = useCallback(() => {
    setHistory((h) => {
      if (h.future.length) setStatus('Modification rétablie');
      return redo(h);
    });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || keepNativeUndo()) return;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) doUndo();
      else if ((k === 'z' && e.shiftKey) || k === 'y') doRedo();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [doUndo, doRedo]);
  useEffect(() => {
    if (!status) return;
    const t = setTimeout(() => setStatus(''), 2500);
    return () => clearTimeout(t);
  }, [status, history]);

  useEffect(() => saveAgenda(agenda), [agenda]);
  useEffect(() => {
    try {
      localStorage.setItem(TAB_KEY, tab);
    } catch {
      // Not remembered: fine.
    }
  }, [tab]);

  const { calendar } = agenda;
  const yearLabel = `${calendar.start.slice(0, 4)}-${calendar.end.slice(0, 4)}`;

  return (
    <div className="app">
      <header className="app-head">
        <div>
          <h1>Agenda</h1>
          <p className="muted">Année scolaire {yearLabel}</p>
        </div>
        <nav className="tabs" aria-label="Sections">
          <button type="button" aria-current={tab === 'agenda' ? 'page' : undefined} onClick={() => setTab('agenda')}>Agenda</button>
          <button type="button" aria-current={tab === 'timetable' ? 'page' : undefined} onClick={() => setTab('timetable')}>Emploi du temps</button>
          <button type="button" aria-current={tab === 'sequences' ? 'page' : undefined} onClick={() => setTab('sequences')}>Séquences</button>
        </nav>
        <div className="head-actions">
          <button type="button" className="ghost icon-btn" aria-label="Annuler la dernière modification" title="Annuler (Ctrl+Z)" disabled={!history.past.length} onClick={doUndo}>↶</button>
          <button type="button" className="ghost icon-btn" aria-label="Rétablir la modification" title="Rétablir (Ctrl+Maj+Z)" disabled={!history.future.length} onClick={doRedo}>↷</button>
          <button type="button" className="ghost" onClick={() => setHolidaysOpen(true)}>
            Vacances{calendar.closures.length ? ` (${calendar.closures.length})` : ''}
          </button>
          <FileMenu agenda={agenda} onRestore={setAgenda} onMessage={setStatus} />
        </div>
      </header>
      <p className="toast" role="status" aria-live="polite">{status}</p>

      <LevelOptions />
      <main>
        {tab === 'agenda' ? (
          <AgendaView agenda={agenda} onChange={setAgenda} onGoTo={setTab} />
        ) : tab === 'timetable' ? (
          <TimetableView agenda={agenda} onChange={setAgenda} />
        ) : (
          <SequencesView agenda={agenda} onChange={setAgenda} />
        )}
      </main>

      {holidaysOpen && (
        <HolidaysWindow
          calendar={calendar}
          onSave={(next) => {
            setAgenda((a) => ({ ...a, calendar: next }));
            setHolidaysOpen(false);
          }}
          onClose={() => setHolidaysOpen(false)}
        />
      )}
    </div>
  );
}
