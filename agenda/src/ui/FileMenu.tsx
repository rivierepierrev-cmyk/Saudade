import { useEffect, useRef, useState } from 'react';
import type { Agenda } from '../model.ts';
import { plan } from '../plan.ts';
import { toICS } from '../ics.ts';
import { backupName, fromBackup, toBackup } from '../backup.ts';

/** Gives the user a file to save. */
function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

interface Props {
  agenda: Agenda;
  /** Replaces the agenda (undoable). */
  onRestore: (agenda: Agenda) => void;
  onMessage: (text: string) => void;
}

/** Export to a calendar, print, back up and restore. */
export function FileMenu({ agenda, onRestore, onMessage }: Props) {
  const [open, setOpen] = useState(false);
  const menu = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !menu.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', close);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', close);
    };
  }, [open]);

  const act = (f: () => void) => () => {
    setOpen(false);
    f();
  };

  const restore = async (file: File) => {
    try {
      const next = fromBackup(await file.text());
      if (!window.confirm(`Remplacer l'agenda actuel par la sauvegarde « ${file.name} » ? (Vous pourrez annuler avec ↶.)`)) return;
      onRestore(next);
      onMessage('Sauvegarde restaurée');
    } catch (e) {
      window.alert((e as Error).message);
    }
  };

  return (
    <div className="file-menu" ref={menu}>
      <button type="button" className="ghost" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>Fichier ▾</button>
      {open && (
        <div className="menu" role="menu">
          <button type="button" role="menuitem" onClick={act(() => download('agenda.ics', toICS(agenda, plan(agenda)), 'text/calendar'))}>
            Exporter vers un calendrier (.ics)
            <span className="muted small">Google Agenda, Outlook, Apple Calendrier…</span>
          </button>
          <button type="button" role="menuitem" onClick={act(() => window.print())}>
            Imprimer / PDF
            <span className="muted small">La vue affichée</span>
          </button>
          <hr />
          <button type="button" role="menuitem" onClick={act(() => { download(backupName(), toBackup(agenda), 'application/json'); onMessage('Sauvegarde enregistrée'); })}>
            Sauvegarder dans un fichier
            <span className="muted small">Tout l'agenda, à garder ou à ouvrir sur un autre appareil</span>
          </button>
          <button type="button" role="menuitem" onClick={act(() => input.current?.click())}>
            Restaurer une sauvegarde…
          </button>
        </div>
      )}
      <input
        ref={input}
        type="file"
        accept=".json,application/json"
        hidden
        aria-label="Fichier de sauvegarde"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void restore(file);
        }}
      />
    </div>
  );
}
