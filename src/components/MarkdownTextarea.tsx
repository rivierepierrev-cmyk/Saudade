import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Search, X } from 'lucide-react';

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Where `query` occurs in `text` (case ignored): [start, end) pairs. */
export function findMatches(text: string, query: string): Array<[number, number]> {
  if (!query) return [];
  return Array.from(text.matchAll(new RegExp(escapeRegExp(query), 'gi')), (m) => [m.index, m.index + m[0].length]);
}

// Same box and font for the text area and the layer drawn behind it with the
// matches, so the highlights fall exactly under the words.
const TEXT_BOX = 'p-4 text-sm font-mono leading-relaxed whitespace-pre-wrap break-words [scrollbar-gutter:stable]';
const SMALL_BUTTON =
  'p-1 rounded-md text-[var(--fg-695f54)] hover:text-[var(--fg-28231d)] hover:bg-[var(--bg-e8e2d5)] disabled:opacity-40 disabled:cursor-default cursor-pointer';
const FIELD =
  'min-w-0 flex-1 px-2 py-1 text-xs bg-[var(--bg-ffffff)] border border-[var(--bd-d5cbbf)] rounded-md text-[var(--fg-28231d)] focus:outline-none focus:ring-1 focus:ring-[var(--bd-8c5e32)]';

interface Props {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  placeholder?: string;
  'aria-label'?: string;
  /** Incremented by the parent to open the search bar (Ctrl+F). */
  findRequest: number;
}

/** The Markdown editor's text area, with a search bar (Ctrl+F): matches highlighted, replace. */
export const MarkdownTextarea: React.FC<Props> = ({ id, value, onChange, rows = 16, placeholder, findRequest, ...rest }) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [replacement, setReplacement] = useState('');
  const [current, setCurrent] = useState(0);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const backRef = useRef<HTMLDivElement>(null);
  const findRef = useRef<HTMLInputElement>(null);

  const matches = useMemo(() => (open ? findMatches(value, query) : []), [open, query, value]);
  const index = matches.length > 0 ? Math.min(current, matches.length - 1) : -1;

  useEffect(() => {
    if (findRequest === 0) return;
    // The selected words (on one line) become the search.
    const area = areaRef.current;
    const selected = area ? area.value.slice(area.selectionStart, area.selectionEnd) : '';
    if (selected && !selected.includes('\n')) {
      setQuery(selected);
      setCurrent(0);
    }
    setOpen(true);
    requestAnimationFrame(() => {
      findRef.current?.focus();
      findRef.current?.select();
    });
  }, [findRequest]);

  const syncScroll = () => {
    if (backRef.current && areaRef.current) backRef.current.scrollTop = areaRef.current.scrollTop;
  };

  // Bring the current match into view.
  useEffect(() => {
    if (index < 0) return;
    const mark = backRef.current?.querySelector<HTMLElement>(`[data-match="${index}"]`);
    const area = areaRef.current;
    if (!mark || !area) return;
    if (mark.offsetTop < area.scrollTop || mark.offsetTop > area.scrollTop + area.clientHeight - 24) {
      area.scrollTop = Math.max(0, mark.offsetTop - area.clientHeight / 3);
    }
    syncScroll();
  }, [index, query]);

  const go = (step: number) => {
    if (matches.length === 0) return;
    setCurrent((index + step + matches.length) % matches.length);
  };

  const close = () => {
    setOpen(false);
    const area = areaRef.current;
    if (!area) return;
    area.focus();
    if (index >= 0) area.setSelectionRange(matches[index][0], matches[index][1]);
  };

  const replaceOne = () => {
    if (index < 0) return;
    const [s, e] = matches[index];
    onChange(value.slice(0, s) + replacement + value.slice(e));
  };

  const replaceAll = () => {
    if (matches.length === 0) return;
    onChange(value.replace(new RegExp(escapeRegExp(query), 'gi'), () => replacement));
  };

  const pieces: React.ReactNode[] = [];
  let last = 0;
  matches.forEach(([s, e], i) => {
    pieces.push(value.slice(last, s));
    pieces.push(
      <mark key={i} data-match={i} className={i === index ? 'find-current' : 'find-hit'}>
        {value.slice(s, e)}
      </mark>
    );
    last = e;
  });
  pieces.push(value.slice(last) + '\n');

  return (
    <div>
      {open && (
        <div
          role="search"
          className="flex flex-wrap items-center gap-1.5 px-3 py-2 border-b border-[var(--bd-f3efe8)] bg-[var(--bg-faf7f2)]"
        >
          <Search className="w-3.5 h-3.5 shrink-0 text-[var(--fg-8c8072)]" />
          <input
            ref={findRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setCurrent(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                go(e.shiftKey ? -1 : 1);
              } else if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                close();
              }
            }}
            aria-label="Rechercher dans le texte"
            placeholder="Rechercher…"
            className={FIELD}
          />
          <span className="text-[11px] tabular-nums text-[var(--fg-695f54)] whitespace-nowrap" aria-live="polite">
            {query ? (matches.length > 0 ? `${index + 1} / ${matches.length}` : 'Aucun résultat') : ''}
          </span>
          <button type="button" onClick={() => go(-1)} disabled={matches.length === 0} className={SMALL_BUTTON} title="Précédent (Maj+Entrée)" aria-label="Résultat précédent">
            <ChevronUp className="w-3.5 h-3.5" />
          </button>
          <button type="button" onClick={() => go(1)} disabled={matches.length === 0} className={SMALL_BUTTON} title="Suivant (Entrée)" aria-label="Résultat suivant">
            <ChevronDown className="w-3.5 h-3.5" />
          </button>
          <input
            value={replacement}
            onChange={(e) => setReplacement(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                replaceOne();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                close();
              }
            }}
            aria-label="Remplacer par"
            placeholder="Remplacer par…"
            className={FIELD}
          />
          <button type="button" onClick={replaceOne} disabled={index < 0} className={`${SMALL_BUTTON} px-2 text-xs`}>
            Remplacer
          </button>
          <button type="button" onClick={replaceAll} disabled={matches.length === 0} className={`${SMALL_BUTTON} px-2 text-xs`}>
            Tout remplacer
          </button>
          <button type="button" onClick={close} className={SMALL_BUTTON} title="Fermer (Échap)" aria-label="Fermer la recherche">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
      <div className="relative bg-[var(--bg-ffffff)]">
        {open && (
          <div ref={backRef} aria-hidden="true" className={`absolute inset-0 overflow-hidden pointer-events-none text-transparent ${TEXT_BOX}`}>
            {pieces}
          </div>
        )}
        <textarea
          ref={areaRef}
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onScroll={syncScroll}
          rows={rows}
          placeholder={placeholder}
          aria-label={rest['aria-label']}
          className={`relative block w-full ${TEXT_BOX} text-[var(--fg-28231d)] bg-transparent focus:outline-none resize-y`}
        />
      </div>
    </div>
  );
};
