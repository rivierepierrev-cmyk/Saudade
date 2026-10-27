/**
 * LaTeX formulas (KaTeX): $…$ / \(…\) inline, $$…$$ / \[…\] on their own line.
 * Also renders cloze cards, where a deletion can hide a whole formula
 * ({{c1::$E=mc^2$}}) or a part of one ($E={{c1::mc^2}}$).
 */

import katex from 'katex';

export interface TextSegment {
  type: 'text';
  value: string;
}
export interface MathSegment {
  type: 'math';
  tex: string;
  display: boolean;
}
export type Segment = TextSegment | MathSegment;

/**
 * Splits text into plain text and formulas. Inline `$` follows the usual rules so
 * prices aren't taken for formulas: the opening `$` is not followed by a space, the
 * closing `$` is not preceded by a space nor followed by a digit. `\$` is a dollar sign.
 */
export function splitMath(text: string): Segment[] {
  const segments: Segment[] = [];
  let buffer = '';
  let i = 0;
  const flush = () => {
    if (buffer) segments.push({ type: 'text', value: buffer });
    buffer = '';
  };
  const tryDelimited = (open: string, close: string, display: boolean): boolean => {
    if (!text.startsWith(open, i)) return false;
    const end = text.indexOf(close, i + open.length);
    if (end < 0) return false;
    const tex = text.slice(i + open.length, end);
    if (!tex.trim()) return false;
    flush();
    segments.push({ type: 'math', tex, display });
    i = end + close.length;
    return true;
  };
  while (i < text.length) {
    const ch = text[i];
    if (ch === '\\' && text[i + 1] === '$') {
      buffer += '$';
      i += 2;
      continue;
    }
    if (tryDelimited('$$', '$$', true) || tryDelimited('\\[', '\\]', true) || tryDelimited('\\(', '\\)', false)) continue;
    if (ch === '$' && text[i + 1] && !/\s/.test(text[i + 1])) {
      let end = i + 1;
      let found = -1;
      while (end < text.length) {
        if (text[end] === '\\') {
          end += 2;
          continue;
        }
        if (text[end] === '\n' && text[end + 1] === '\n') break; // not across paragraphs
        if (text[end] === '$') {
          if (!/\s/.test(text[end - 1]) && !/\d/.test(text[end + 1] ?? '')) found = end;
          break;
        }
        end++;
      }
      if (found > 0) {
        flush();
        segments.push({ type: 'math', tex: text.slice(i + 1, found), display: false });
        i = found + 1;
        continue;
      }
    }
    buffer += ch;
    i++;
  }
  flush();
  return segments;
}

// Only \htmlClass with our own class is trusted (used to highlight cloze answers).
const KATEX_OPTIONS: katex.KatexOptions = {
  throwOnError: false,
  strict: 'ignore',
  maxSize: 50,
  maxExpand: 500,
  trust: (context) => context.command === '\\htmlClass' && context.class === 'cloze-answer',
};

export function renderTex(tex: string, display: boolean): string {
  return katex.renderToString(tex, { ...KATEX_OPTIONS, displayMode: display });
}

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** Plain text (no Markdown) with formulas → HTML. Line breaks are kept. */
export function renderTextWithMath(text: string): string {
  return splitMath(text)
    .map((s) => (s.type === 'math' ? renderTex(s.tex, s.display) : escapeHtml(s.value).replace(/\n/g, '<br>')))
    .join('');
}

// ---- Cloze cards -------------------------------------------------------------

export interface ClozePart {
  type: 'text' | 'cloze';
  value: string; // the text, or the hidden answer
  hint?: string;
  /** Deletion number (the N of cN): deletions with the same number form one card. */
  number?: number;
}

/**
 * Parses {{cN::answer}} and {{cN::answer::hint}}. Braces inside the answer are
 * counted, so LaTeX such as {{c1::$\frac{1}{x^{2}}$}} isn't cut at the first "}}".
 */
export function parseClozes(text: string): ClozePart[] {
  const parts: ClozePart[] = [];
  const open = /\{\{c(\d+)::/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = open.exec(text)) !== null) {
    let depth = 0;
    let j = m.index + m[0].length;
    let end = -1;
    for (; j < text.length; j++) {
      const c = text[j];
      if (c === '\\') {
        j++;
        continue;
      }
      if (c === '{') depth++;
      else if (c === '}') {
        if (depth === 0 && text[j + 1] === '}') {
          end = j;
          break;
        }
        depth = Math.max(0, depth - 1);
      }
    }
    if (end < 0) break; // unterminated: keep the rest as text
    if (m.index > last) parts.push({ type: 'text', value: text.slice(last, m.index) });
    const body = text.slice(m.index + m[0].length, end);
    const sep = body.lastIndexOf('::');
    const number = Number(m[1]);
    parts.push(
      sep > 0
        ? { type: 'cloze', value: body.slice(0, sep), hint: body.slice(sep + 2), number }
        : { type: 'cloze', value: body, number }
    );
    last = end + 2;
    open.lastIndex = last;
  }
  if (last < text.length) parts.push({ type: 'text', value: text.slice(last) });
  return parts;
}

const PLACEHOLDER = (n: number) => `\u0000${n}\u0000`;
const PLACEHOLDER_RE = /\u0000(\d+)\u0000/g;

/** Card numbers of a note: {{c1::…}} {{c1::…}} {{c2::…}} → [1, 2]. One card per number. */
export function clozeNumbers(text: string): number[] {
  const numbers = new Set<number>();
  for (const p of parseClozes(text)) if (p.type === 'cloze' && p.number !== undefined) numbers.add(p.number);
  return [...numbers].sort((a, b) => a - b);
}

/** Does deletion `p` belong to the card being shown? (no number = every deletion, older cards) */
const isActive = (p: ClozePart, activeNumber?: number) => activeNumber === undefined || p.number === activeNumber;

/**
 * Card text → HTML. On card N, deletions numbered N are hidden ([…] or their hint)
 * or, once revealed, highlighted; the other deletions are shown as plain text.
 * Works for deletions around or inside formulas.
 */
export function renderClozeCard(text: string, revealed: boolean, activeNumber?: number): string {
  const parts = parseClozes(text);
  const clozes: ClozePart[] = [];
  const skeleton = parts
    .map((p) => {
      if (p.type === 'text') return p.value;
      clozes.push(p);
      return PLACEHOLDER(clozes.length - 1);
    })
    .join('');

  return splitMath(skeleton)
    .map((segment) => {
      if (segment.type === 'math') {
        const tex = segment.tex.replace(PLACEHOLDER_RE, (_, n) => {
          const c = clozes[Number(n)];
          if (!isActive(c, activeNumber)) return c.value;
          return revealed ? `\\htmlClass{cloze-answer}{${c.value}}` : '\\boxed{\\;?\\;}';
        });
        return renderTex(tex, segment.display);
      }
      return escapeHtml(segment.value)
        .replace(/\n/g, '<br>')
        .replace(PLACEHOLDER_RE, (_, n) => {
          const c = clozes[Number(n)];
          if (!isActive(c, activeNumber)) return renderTextWithMath(c.value);
          return revealed
            ? `<span class="cloze-answer">${renderTextWithMath(c.value)}</span>`
            : `<span class="cloze-blank">${c.hint ? escapeHtml(c.hint) : '[…]'}</span>`;
        });
    })
    .join('');
}

/** Card text for previews with the card's answers hidden: "Paris est une ville de […]". */
export function clozePreviewText(text: string, activeNumber?: number): string {
  return parseClozes(text)
    .map((p) => (p.type === 'text' || !isActive(p, activeNumber) ? p.value : '[…]'))
    .join('');
}

/** Card text for lists, the card's answers in brackets: "Paris est une ville de [France]". */
export function clozeAnswerPreview(text: string, activeNumber?: number): string {
  return parseClozes(text)
    .map((p) => (p.type === 'text' || !isActive(p, activeNumber) ? p.value : `[${p.value}]`))
    .join('');
}
