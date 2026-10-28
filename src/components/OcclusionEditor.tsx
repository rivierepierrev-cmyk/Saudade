import React, { useEffect, useRef, useState } from 'react';
import { ImagePlus, Trash2, X } from 'lucide-react';
import { OcclusionMask } from '../types/saudade';
import { uploadImage } from '../lib/importers';

export interface OcclusionNote {
  image: string;
  masks: OcclusionMask[];
  text: string;
  occlusionMode: 'all' | 'one';
}

interface OcclusionEditorProps {
  title: string;
  context?: string;
  initial: Partial<OcclusionNote>;
  saveLabel?: string;
  onSave: (note: OcclusionNote) => void;
  onClose: () => void;
}

const MIN_SIZE = 0.01; // a zone smaller than 1 % of the image is a slip of the mouse
const clamp = (v: number) => Math.min(1, Math.max(0, v));

/**
 * Image cards, as Anki's image occlusion: draw rectangles over an image. Each new
 * rectangle is a new card (its number); a zone can join another zone's card.
 */
export const OcclusionEditor: React.FC<OcclusionEditorProps> = ({ title, context, initial, saveLabel = 'Enregistrer', onSave, onClose }) => {
  const [image, setImage] = useState(initial.image ?? '');
  const [masks, setMasks] = useState<OcclusionMask[]>(initial.masks ?? []);
  const [text, setText] = useState(initial.text ?? '');
  const [mode, setMode] = useState<'all' | 'one'>(initial.occlusionMode ?? 'all');
  const [selected, setSelected] = useState<number | null>(null);
  const [draft, setDraft] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const canvasRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const numbers = [...new Set(masks.map((m) => m.n))].sort((a, b) => a - b);
  const nextNumber = numbers.length ? Math.max(...numbers) + 1 : 1;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement | null)?.closest('input, textarea, select');
      if (e.key === 'Escape' && !e.defaultPrevented) {
        e.preventDefault();
        onClose();
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selected !== null && !typing) {
        e.preventDefault();
        setMasks((list) => list.filter((_, i) => i !== selected));
        setSelected(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, selected]);

  const point = (e: React.PointerEvent) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: clamp((e.clientX - r.left) / r.width), y: clamp((e.clientY - r.top) / r.height) };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const p = point(e);
    canvasRef.current?.setPointerCapture?.(e.pointerId);
    setDraft({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
    setSelected(null);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!draft) return;
    const p = point(e);
    setDraft({ ...draft, x1: p.x, y1: p.y });
  };
  const onPointerUp = () => {
    if (!draft) return;
    const zone = {
      x: Math.min(draft.x0, draft.x1),
      y: Math.min(draft.y0, draft.y1),
      w: Math.abs(draft.x1 - draft.x0),
      h: Math.abs(draft.y1 - draft.y0),
    };
    setDraft(null);
    if (zone.w < MIN_SIZE || zone.h < MIN_SIZE) return;
    setMasks((list) => [...list, { ...zone, n: nextNumber }]);
    setSelected(masks.length);
    setError(null);
  };

  const pickFile = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      setImage(await uploadImage(new Uint8Array(await file.arrayBuffer()), file.type || 'image/png'));
      setMasks([]);
    } catch (e) {
      setError(`Image refusée : ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setUploading(false);
    }
  };

  const save = () => {
    if (!image) return setError('Choisissez une image.');
    if (masks.length === 0) return setError('Dessinez au moins une zone à masquer sur l’image.');
    onSave({ image, masks, text: text.trim(), occlusionMode: mode });
  };

  const box = (m: { x: number; y: number; w: number; h: number }) => ({
    left: `${m.x * 100}%`,
    top: `${m.y * 100}%`,
    width: `${m.w * 100}%`,
    height: `${m.h * 100}%`,
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onKeyDown={(e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
          e.preventDefault();
          save();
        }
      }}
    >
      <div className="bg-[var(--bg-ffffff)] border border-[var(--bd-e8e2d5)] rounded-2xl shadow-xl w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden">
        <div className="flex items-start justify-between gap-4 px-6 py-4 border-b border-[var(--bd-e8e2d5)]">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-[var(--fg-28231d)]">{title}</h2>
            {context && <p className="text-xs text-[var(--fg-695f54)] truncate">{context}</p>}
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg text-[var(--fg-695f54)] hover:bg-[var(--bg-f3efe8)] cursor-pointer" aria-label="Fermer">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-6 py-4 space-y-3 overflow-y-auto">
          <input ref={fileRef} type="file" accept="image/*" className="hidden" aria-label="Fichier image" onChange={(e) => pickFile(e.target.files?.[0])} />
          {!image ? (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="w-full flex flex-col items-center gap-2 p-10 border border-dashed border-[var(--bd-ddd6c8)] rounded-xl text-sm text-[var(--fg-695f54)] hover:bg-[var(--bg-faf7f2)] cursor-pointer"
            >
              <ImagePlus className="w-8 h-8 text-[var(--fg-8c5e32)]" />
              {uploading ? 'Import de l’image…' : 'Choisir une image…'}
            </button>
          ) : (
            <>
              <p className="text-xs text-[var(--fg-695f54)]">
                Tracez un rectangle sur chaque zone à masquer : chaque rectangle donne une carte. Pour masquer plusieurs zones sur la
                même carte, choisissez son numéro dans la liste. Cliquez sur une zone pour la sélectionner, Suppr pour l’effacer.
              </p>
              <div className="flex justify-center bg-[var(--bg-faf7f2)] rounded-xl p-2">
                <div
                  ref={canvasRef}
                  data-testid="io-canvas"
                  className="relative inline-block select-none touch-none cursor-crosshair leading-[0]"
                  onPointerDown={onPointerDown}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                >
                  <img src={image} alt="" draggable={false} className="max-w-full max-h-[55vh] rounded-md" />
                  {masks.map((m, i) => (
                    <div
                      key={i}
                      data-testid="io-zone"
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        setSelected(i);
                      }}
                      style={box(m)}
                      className={`absolute flex items-center justify-center rounded-[3px] border-2 text-xs font-bold leading-none cursor-pointer ${
                        selected === i ? 'bg-[#e8a33d] border-[#5c3a0c] text-[#2a1a05]' : 'bg-[#e8a33d]/80 border-[#9a5e14] text-[#2a1a05]'
                      }`}
                    >
                      c{m.n}
                    </div>
                  ))}
                  {draft && (
                    <div
                      className="absolute border-2 border-dashed border-[#9a5e14] bg-[#e8a33d]/30"
                      style={box({ x: Math.min(draft.x0, draft.x1), y: Math.min(draft.y0, draft.y1), w: Math.abs(draft.x1 - draft.x0), h: Math.abs(draft.y1 - draft.y0) })}
                    />
                  )}
                </div>
              </div>

              {masks.length > 0 && (
                <ul className="flex flex-wrap gap-2 text-xs" aria-label="Zones">
                  {masks.map((m, i) => (
                    <li
                      key={i}
                      className={`flex items-center gap-1.5 pl-2 pr-1 py-1 rounded-lg border ${
                        selected === i ? 'border-[var(--bd-8c5e32)] bg-[var(--bg-faf7f2)]' : 'border-[var(--bd-e8e2d5)]'
                      }`}
                    >
                      <span>Zone {i + 1} → carte</span>
                      <select
                        value={m.n}
                        aria-label={`Carte de la zone ${i + 1}`}
                        onChange={(e) => {
                          const n = Number(e.target.value);
                          setMasks((list) => list.map((z, j) => (j === i ? { ...z, n } : z)));
                        }}
                        className="px-1 py-0.5 rounded border border-[var(--bd-e8e2d5)] bg-[var(--bg-ffffff)]"
                      >
                        {[...new Set([...numbers, m.n])].sort((a, b) => a - b).map((n) => (
                          <option key={n} value={n}>
                            c{n}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => {
                          setMasks((list) => list.filter((_, j) => j !== i));
                          setSelected(null);
                        }}
                        className="p-1 rounded text-[var(--fg-8c8072)] hover:text-red-600 cursor-pointer"
                        title="Effacer cette zone"
                        aria-label={`Effacer la zone ${i + 1}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-[var(--fg-4a4137)]">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" name="io-mode" checked={mode === 'all'} onChange={() => setMode('all')} />
                  Tout masquer, en deviner une
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" name="io-mode" checked={mode === 'one'} onChange={() => setMode('one')} />
                  Masquer seulement la zone à deviner
                </label>
                <button type="button" onClick={() => fileRef.current?.click()} className="ml-auto text-xs text-[var(--fg-8c5e32)] hover:underline cursor-pointer">
                  Changer d’image…
                </button>
              </div>

              <label className="block text-xs text-[var(--fg-695f54)]">
                Consigne (facultatif)
                <input
                  type="text"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="Ex. : Nommez la zone en couleur"
                  className="mt-1 block w-full px-2.5 py-1.5 text-sm text-[var(--fg-28231d)] bg-[var(--bg-faf7f2)] border border-[var(--bd-e8e2d5)] rounded-md"
                />
              </label>
            </>
          )}
          {error && (
            <p role="alert" className="text-xs text-[var(--fg-a84236)]">
              {error}
            </p>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 px-6 py-3 border-t border-[var(--bd-e8e2d5)] bg-[var(--bg-faf7f2)]">
          <span className="text-[11px] text-[var(--fg-8c8072)]">
            {numbers.length > 0 ? `${numbers.length} carte${numbers.length > 1 ? 's' : ''} · ` : ''}
            <kbd className="font-mono">Ctrl+Entrée</kbd> enregistrer · <kbd className="font-mono">Échap</kbd> annuler
          </span>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose} className="px-3.5 py-2 text-xs text-[var(--fg-695f54)] hover:text-[var(--fg-28231d)] rounded-lg cursor-pointer">
              Annuler
            </button>
            <button
              type="button"
              onClick={save}
              className="px-4 py-2 text-xs font-semibold text-white bg-[var(--bg-8c5e32)] hover:bg-[var(--bg-774d27)] rounded-lg shadow-xs cursor-pointer"
            >
              {saveLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
