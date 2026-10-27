/**
 * Building cloze cards from a selection: the card keeps the sentence(s) around the
 * selected words as context and hides only the selection.
 */

export type ClozeBuildResult =
  | { ok: true; text: string }
  | { ok: false; reason: 'empty' | 'syntax'; error: string }
  /** The selection is the whole sentence: `sentence` can be opened in the card editor. */
  | { ok: false; reason: 'whole-sentence'; error: string; sentence: string };

const CLOZE_PATTERN = /\{\{c\d+::/;

/** Start/end offsets of the sentences in `text`. */
function sentenceRanges(text: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  // A sentence ends with . ! ? or … (optionally followed by closing quotes/brackets) and
  // whitespace, or at a line break: the end of a block (heading, paragraph, list item).
  const re = /[.!?…]+["»”’)\]]*\s+|\n+/g;
  let start = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const end = m.index + m[0].length;
    // Don't split after common abbreviations or single initials ("M.", "p.", "J.")
    const before = text.slice(start, m.index + 1);
    if (!m[0].startsWith('\n') && /(?:^|\s)(?:[A-Za-zÀ-ÿ]|M|Mme|Dr|St|p|cf|etc|vol|éd|ex|fig|n°|e\.g|i\.e)\.$/.test(before)) continue;
    ranges.push([start, end]);
    start = end;
  }
  if (start < text.length) ranges.push([start, text.length]);
  return ranges;
}

const visibleLength = (s: string) => s.replace(/[\s\p{P}]/gu, '').length;

/**
 * @param context  Plain text of the paragraph (or extract) containing the selection.
 * @param start    Selection start offset in `context`.
 * @param end      Selection end offset in `context`.
 */
export function buildCloze(context: string, start: number, end: number): ClozeBuildResult {
  // Trim whitespace around the selection.
  while (start < end && /\s/.test(context[start])) start++;
  while (end > start && /\s/.test(context[end - 1])) end--;
  const answer = context.slice(start, end);
  if (!answer) return { ok: false, reason: 'empty', error: 'Sélectionnez le mot ou l’expression à masquer.' };
  if (CLOZE_PATTERN.test(context) || answer.includes('}}') || answer.includes('::')) {
    return { ok: false, reason: 'syntax', error: 'Ce texte contient déjà une syntaxe de carte à trou.' };
  }

  const ranges = sentenceRanges(context);
  const first = ranges.find(([s, e]) => start >= s && start < e) ?? [0, context.length];
  const last = ranges.find(([s, e]) => end > s && end <= e) ?? [first[0], context.length];
  const ctxStart = first[0];
  const ctxEnd = last[1];
  const sentence = context.slice(ctxStart, ctxEnd);

  if (visibleLength(answer) >= visibleLength(sentence) * 0.85) {
    return {
      ok: false,
      reason: 'whole-sentence',
      error: 'Choisissez dans l’éditeur le mot ou l’expression à masquer : la phrase sert de contexte à la question.',
      sentence: sentence.replace(/\s+/g, ' ').trim(),
    };
  }

  const text =
    context.slice(ctxStart, start) + `{{c1::${answer}}}` + context.slice(end, ctxEnd);
  return { ok: true, text: text.replace(/\s+/g, ' ').trim() };
}

/** Selection described relative to the plain text of its enclosing block. */
export interface BlockSelection {
  text: string;
  context: string;
  start: number;
  end: number;
}

const BLOCK_SELECTOR = 'p, li, blockquote, h1, h2, h3, h4, h5, h6, td, th, figcaption, dd, dt, pre';

/** LaTeX source of a rendered formula (KaTeX keeps it in a MathML annotation). */
function texOf(formula: Element): string | null {
  return formula.querySelector('annotation[encoding="application/x-tex"]')?.textContent ?? null;
}

/**
 * Text of a node as the user wrote it: formulas come back as $…$ / $$…$$ instead
 * of their rendered characters, line breaks as \n.
 */
export function serializeText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
  if (node.nodeType === Node.ELEMENT_NODE) {
    const el = node as Element;
    if (el.classList.contains('katex-display')) {
      const tex = texOf(el);
      if (tex !== null) return `$$${tex}$$`;
    }
    if (el.classList.contains('katex')) {
      const tex = texOf(el);
      if (tex !== null) return `$${tex}$`;
    }
    if (el.tagName === 'BR') return '\n';
    // Blocks end with a line break, so a heading and the paragraph after it never
    // merge into one sentence.
    if (SEPARATED_BLOCKS.has(el.tagName) || el.classList.contains('math-block')) {
      return Array.from(node.childNodes, serializeText).join('') + '\n';
    }
  } else if (node.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) {
    return '';
  }
  return Array.from(node.childNodes, serializeText).join('');
}

const SEPARATED_BLOCKS = new Set(['P', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'PRE', 'TD', 'TH', 'FIGCAPTION', 'DD', 'DT', 'TR']);

const formulaAround = (node: Node): Element | null => {
  const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  return el?.closest('.katex-display') ?? el?.closest('.katex') ?? null;
};

/**
 * Locates the current window selection inside `root`. `context` is the text of the
 * closest block element (paragraph, list item…) when the selection stays inside one
 * block, otherwise the text of `root`. A selection that starts or ends inside a
 * formula is widened to the whole formula; formulas are returned as LaTeX.
 */
export function getBlockSelection(root: HTMLElement | null): BlockSelection | null {
  const selection = window.getSelection();
  if (!root || !selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0).cloneRange();
  if (!root.contains(range.commonAncestorContainer)) return null;
  const startFormula = formulaAround(range.startContainer);
  const endFormula = formulaAround(range.endContainer);
  if (startFormula) range.setStartBefore(startFormula);
  if (endFormula) range.setEndAfter(endFormula);

  // The blocks (paragraphs, headings, items…) the selection really covers. A
  // triple-click or a drag often reaches the very start of the next block, or starts
  // at the end of the previous one, without selecting any of its text: those blocks
  // are left out, so their text (e.g. a heading) never ends up in the card.
  const selectedIn = (block: Element) => {
    const part = document.createRange();
    part.selectNodeContents(block);
    if (range.compareBoundaryPoints(Range.START_TO_START, part) > 0) part.setStart(range.startContainer, range.startOffset);
    if (range.compareBoundaryPoints(Range.END_TO_END, part) < 0) part.setEnd(range.endContainer, range.endOffset);
    return serializeText(part.cloneContents()).trim() !== '';
  };
  const blocks = Array.from(root.querySelectorAll(BLOCK_SELECTOR)).filter(
    (b) => !b.querySelector(BLOCK_SELECTOR) && range.intersectsNode(b) && selectedIn(b)
  );
  let contextRange: Range;
  if (blocks.length > 0) {
    const first = blocks[0];
    const last = blocks[blocks.length - 1];
    const firstStart = document.createRange();
    firstStart.selectNodeContents(first);
    if (range.compareBoundaryPoints(Range.START_TO_START, firstStart) < 0) range.setStart(first, 0);
    const lastEnd = document.createRange();
    lastEnd.selectNodeContents(last);
    if (range.compareBoundaryPoints(Range.END_TO_END, lastEnd) > 0) range.setEnd(last, last.childNodes.length);
    contextRange = document.createRange();
    contextRange.setStart(first, 0);
    contextRange.setEnd(last, last.childNodes.length);
  } else {
    // No block inside (e.g. an extract shown as plain text): the whole root.
    contextRange = document.createRange();
    contextRange.selectNodeContents(root);
  }

  const pre = document.createRange();
  pre.setStart(contextRange.startContainer, contextRange.startOffset);
  pre.setEnd(range.startContainer, range.startOffset);
  const start = serializeText(pre.cloneContents()).length;
  const text = serializeText(range.cloneContents()).replace(/\n+$/, '');
  const context = serializeText(contextRange.cloneContents()).replace(/\n+$/, '');
  return { text, context, start, end: start + text.length };
}
