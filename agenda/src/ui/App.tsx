import { useState } from 'react';
import type { Closure } from '../model.ts';
import { HolidaysWindow } from './HolidaysWindow.tsx';

const STORAGE_KEY = 'agenda.closures';

function load(): Closure[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Closure[]) : [];
  } catch {
    return [];
  }
}

function store(closures: Closure[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(closures));
  } catch {
    // Storage unavailable (private window): the list stays for this session only.
  }
}

/** School year containing today: from 1 September to 10 July (summer starts early July). */
function currentSchoolYear(today = new Date()) {
  const y = today.getMonth() >= 7 ? today.getFullYear() : today.getFullYear() - 1;
  return { start: `${y}-09-01`, end: `${y + 1}-07-10`, label: `${y}-${y + 1}` };
}

const longDate = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const show = (d: string) => longDate.format(new Date(`${d}T00:00:00Z`));

export function App() {
  const year = currentSchoolYear();
  const [closures, setClosures] = useState<Closure[]>(load);
  const [open, setOpen] = useState(false);

  const save = (next: Closure[]) => {
    setClosures(next);
    store(next);
    setOpen(false);
  };

  return (
    <main className="app">
      <header className="app-head">
        <div>
          <h1>Agenda</h1>
          <p className="muted">Année scolaire {year.label}</p>
        </div>
        <button type="button" className="primary" onClick={() => setOpen(true)}>
          Vacances{closures.length ? ` (${closures.length})` : ''}
        </button>
      </header>

      <section className="card">
        <h2>Jours sans cours</h2>
        {closures.length === 0 ? (
          <p className="muted">Aucune date. Ouvrez « Vacances » pour en ajouter.</p>
        ) : (
          <ul className="closures">
            {closures.map((c) => (
              <li key={`${c.start}-${c.end}-${c.label}`}>
                <span>{c.label}</span>
                <span className="muted">{c.start === c.end ? show(c.start) : `${show(c.start)} → ${show(c.end)}`}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {open && <HolidaysWindow closures={closures} yearStart={year.start} yearEnd={year.end} onSave={save} onClose={() => setOpen(false)} />}
    </main>
  );
}
