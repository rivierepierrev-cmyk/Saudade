import React, { useState } from 'react';
import { PenLine } from 'lucide-react';
import { DocumentItem } from '../types/saudade';

/**
 * Incremental writing: sends a passage (an extract) to the end of a text being
 * written, as a quotation with its source. Hidden when no text is being written.
 */
export const AddToWriting: React.FC<{
  texts: DocumentItem[];
  onAdd: (documentId: string) => void;
  className?: string;
}> = ({ texts, onAdd, className = '' }) => {
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState('');
  if (texts.length === 0) return null;
  const chosen = texts.some((t) => t.id === target) ? target : texts[0].id;
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[var(--fg-3b3026)] bg-[var(--bg-f3efe8)] hover:bg-[var(--bg-eae4d9)] border border-[var(--bd-e8e2d5)] rounded-lg cursor-pointer ${className}`}
        title="Verser ce passage dans un texte que vous écrivez (citation avec sa source)"
      >
        <PenLine className="w-3.5 h-3.5 text-[var(--fg-8c5e32)]" />
        Ajouter à un texte…
      </button>
    );
  }
  return (
    <span className={`flex flex-wrap items-center gap-1.5 text-xs ${className}`}>
      <select
        value={chosen}
        onChange={(e) => setTarget(e.target.value)}
        aria-label="Texte en cours d'écriture"
        className="max-w-[16rem] px-2 py-1.5 rounded-lg border border-[var(--bd-e8e2d5)] bg-[var(--bg-ffffff)] text-[var(--fg-28231d)]"
      >
        {texts.map((t) => (
          <option key={t.id} value={t.id}>
            {t.title}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={() => {
          onAdd(chosen);
          setOpen(false);
        }}
        className="px-3 py-1.5 font-semibold text-white bg-[var(--bg-8c5e32)] hover:bg-[var(--bg-774d27)] rounded-lg cursor-pointer"
      >
        Ajouter
      </button>
      <button type="button" onClick={() => setOpen(false)} className="px-2 py-1.5 text-[var(--fg-695f54)] hover:bg-[var(--bg-f3efe8)] rounded-lg cursor-pointer">
        Annuler
      </button>
    </span>
  );
};
