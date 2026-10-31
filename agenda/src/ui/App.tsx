import { useEffect, useState } from 'react';
import type { Agenda } from '../model.ts';
import { HolidaysWindow } from './HolidaysWindow.tsx';
import { TimetableView } from './TimetableView.tsx';
import { SequencesView } from './SequencesView.tsx';
import { AgendaView } from './AgendaView.tsx';
import { loadAgenda, saveAgenda } from './storage.ts';

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

export function App() {
  const [agenda, setAgenda] = useState<Agenda>(loadAgenda);
  const [tab, setTab] = useState<Tab>(initialTab);
  const [holidaysOpen, setHolidaysOpen] = useState(false);

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
        <button type="button" className="ghost" onClick={() => setHolidaysOpen(true)}>
          Vacances{calendar.closures.length ? ` (${calendar.closures.length})` : ''}
        </button>
      </header>

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
