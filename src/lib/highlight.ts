/**
 * Finding and highlighting passages (extracts) in the rendered reader. Uses the CSS
 * Custom Highlight API, so the article's HTML is never modified.
 */

const BLOCK_TAGS = new Set([
  'P', 'LI', 'UL', 'OL', 'BLOCKQUOTE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'PRE', 'TABLE', 'TR', 'TD', 'TH', 'FIGURE', 'FIGCAPTION', 'DIV', 'HR', 'DT', 'DD',
]);

interface Boundary {
  node: Node;
  offset: number;
}

/** Visible text of `root` as written by the user (formulas as $…$), whitespace collapsed,
 *  with the DOM position before and after each character. */
function indexText(root: HTMLElement) {
  let text = '';
  const before: Boundary[] = [];
  const after: Boundary[] = [];
  const push = (ch: string, b: Boundary, a: Boundary) => {
    if (/\s/.test(ch)) {
      if (text === '' || text.endsWith(' ')) return;
      ch = ' ';
    }
    text += ch;
    before.push(b);
    after.push(a);
  };
  const space = (node: Node) => {
    const parent = node.parentNode;
    if (!parent) return;
    const index = Array.prototype.indexOf.call(parent.childNodes, node);
    push(' ', { node: parent, offset: index }, { node: parent, offset: index });
  };
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const value = node.textContent ?? '';
      for (let i = 0; i < value.length; i++) push(value[i], { node, offset: i }, { node, offset: i + 1 });
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as Element;
    const formula = el.classList.contains('katex-display') ? 'display' : el.classList.contains('katex') ? 'inline' : null;
    if (formula) {
      const tex = el.querySelector('annotation[encoding="application/x-tex"]')?.textContent ?? '';
      const parent = el.parentNode!;
      const index = Array.prototype.indexOf.call(parent.childNodes, el);
      const delimiter = formula === 'display' ? '$$' : '$';
      for (const ch of `${delimiter}${tex}${delimiter}`) push(ch, { node: parent, offset: index }, { node: parent, offset: index + 1 });
      return;
    }
    if (el.tagName === 'BR') {
      space(el);
      return;
    }
    const block = BLOCK_TAGS.has(el.tagName);
    if (block && el.firstChild) space(el.firstChild);
    el.childNodes.forEach(walk);
    if (block) push(' ', { node: el, offset: el.childNodes.length }, { node: el, offset: el.childNodes.length });
  };
  walk(root);
  return { text, before, after };
}

const normalize = (s: string) => s.replace(/\s+/g, ' ').trim();

/** DOM range of each passage found in `root` (null when not found), in one pass. */
export function findPassages(root: HTMLElement, passages: string[]): Array<Range | null> {
  const index = indexText(root);
  return passages.map((passage) => {
    const needle = normalize(passage);
    if (!needle) return null;
    const at = index.text.indexOf(needle);
    if (at < 0) return null;
    const range = document.createRange();
    const start = index.before[at];
    const end = index.after[at + needle.length - 1];
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    return range;
  });
}

const highlightsSupported = () => typeof CSS !== 'undefined' && 'highlights' in CSS && typeof Highlight !== 'undefined';

/** Highlights `ranges` under the CSS name `name` (see ::highlight() in index.css). */
export function setHighlight(name: string, ranges: Range[]): void {
  if (!highlightsSupported()) return;
  if (ranges.length === 0) CSS.highlights.delete(name);
  else CSS.highlights.set(name, new Highlight(...ranges));
}

export function clearHighlight(name: string): void {
  if (highlightsSupported()) CSS.highlights.delete(name);
}
