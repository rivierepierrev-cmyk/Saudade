/**
 * Finding an extract's passage in the Markdown of its document, so that editing the
 * extract also edits the document. Extracts are plain text (formulas as $…$) taken
 * from the rendered page, so the search ignores Markdown markup (emphasis, links,
 * headings, list markers…) and differences in whitespace.
 */

interface Projection {
  text: string; // visible text, whitespace collapsed to single spaces
  map: number[]; // map[i] = index in the source of text[i]
}

/** Visible text of Markdown, with the position of each character in the source. */
export function projectMarkdown(md: string): Projection {
  let text = '';
  const map: number[] = [];
  const push = (ch: string, at: number) => {
    if (/\s/.test(ch)) {
      if (text.length === 0 || text.endsWith(' ')) return;
      text += ' ';
    } else {
      text += ch;
    }
    map.push(at);
  };
  let i = 0;
  let lineStart = true;
  while (i < md.length) {
    const rest = md.slice(i);
    if (lineStart) {
      // Block markers at the start of a line: headings, quotes, list items.
      const m = /^[ \t]*(?:#{1,6}[ \t]+|>[ \t]?|[-*+][ \t]+|\d+[.)][ \t]+)/.exec(rest);
      if (m && m[0].length > 0) {
        i += m[0].length;
        lineStart = false;
        continue;
      }
    }
    lineStart = false;
    const ch = md[i];
    if (ch === '\n') {
      push(' ', i);
      i++;
      lineStart = true;
      continue;
    }
    // Formulas are kept verbatim ($…$ in the extract too).
    const math = /^(\$\$[\s\S]+?\$\$|\$(?!\s)(?:\\.|[^\\$\n])+?(?<!\s)\$(?!\d))/.exec(rest);
    if (math) {
      for (let k = 0; k < math[0].length; k++) push(math[0][k], i + k);
      i += math[0].length;
      continue;
    }
    const image = /^!\[[^\]]*\]\([^)]*\)/.exec(rest);
    if (image) {
      i += image[0].length;
      continue;
    }
    if (ch === '\\' && i + 1 < md.length && /[\\`*_{}[\]()#+\-.!$>~|]/.test(md[i + 1])) {
      push(md[i + 1], i + 1);
      i += 2;
      continue;
    }
    const link = /^\[([^\]]*)\]\([^)]*\)/.exec(rest);
    if (link) {
      for (let k = 0; k < link[1].length; k++) push(link[1][k], i + 1 + k);
      i += link[0].length;
      continue;
    }
    const tag = /^<\/?[a-zA-Z][^>]*>/.exec(rest);
    if (tag) {
      i += tag[0].length;
      continue;
    }
    if (ch === '*' || ch === '`' || ch === '~' || (ch === '_' && !/\w/.test(md[i - 1] ?? '') ) || (ch === '_' && !/\w/.test(md[i + 1] ?? ''))) {
      i++;
      continue;
    }
    push(ch, i);
    i++;
  }
  // Drop a trailing collapsed space.
  if (text.endsWith(' ')) {
    text = text.slice(0, -1);
    map.pop();
  }
  return { text, map };
}

const normalize = (s: string) => s.replace(/\s+/g, ' ').trim();
// Like normalize, but a whitespace run containing a line break stays a line break
// (same length as the space it becomes in `normalize`).
const normalizeKeepLines = (s: string) =>
  s.trim().replace(/\s+/g, (ws) => (ws.includes('\n') ? '\n' : ' '));

/** Occurrence of `needle` (already normalized) in the projection, closest to `hint`. */
function findInProjection(proj: Projection, needle: string, hint?: number): number | null {
  let best: number | null = null;
  for (let at = proj.text.indexOf(needle); at >= 0; at = proj.text.indexOf(needle, at + 1)) {
    if (best === null || (hint !== undefined && Math.abs(proj.map[at] - hint) < Math.abs(proj.map[best] - hint))) best = at;
    if (hint === undefined) break;
  }
  return best;
}

/**
 * Range of `passage` in `source` (Markdown or plain text), or null. When the
 * passage appears several times, the occurrence closest to `hint` is chosen.
 */
export function locatePassage(source: string, passage: string, hint?: number): { start: number; end: number } | null {
  const needle = normalize(passage);
  if (!needle) return null;
  const proj = projectMarkdown(source);
  const at = findInProjection(proj, needle, hint);
  if (at === null) return null;
  return { start: proj.map[at], end: proj.map[at + needle.length - 1] + 1 };
}

/** Text to insert in Markdown: line breaks of the extract become paragraph breaks. */
export function toMarkdownParagraphs(text: string): string {
  return text.replace(/\n/g, '\n\n');
}

/**
 * Applies the change from `oldText` to `newText` to the same passage in `source`.
 * Only the part that actually changed is replaced, so formatting around it (bold,
 * links…) is kept. Returns the new source and where the passage starts, or null
 * when the passage can't be found.
 */
export function replacePassage(
  source: string,
  oldText: string,
  newText: string,
  hint?: number,
  markdown = true
): { source: string; start: number } | null {
  const oldN = normalizeKeepLines(oldText);
  const newN = normalizeKeepLines(newText);
  const needle = oldN.replace(/\n/g, ' ');
  if (!needle) return null;
  const proj = projectMarkdown(source);
  const at = findInProjection(proj, needle, hint);
  if (at === null) return null;
  const passageStart = proj.map[at];
  if (oldN === newN) return { source, start: passageStart };

  // Common beginning and end of the old and new text: only the middle changes.
  let prefix = 0;
  while (prefix < oldN.length && prefix < newN.length && oldN[prefix] === newN[prefix]) prefix++;
  let suffix = 0;
  while (
    suffix < oldN.length - prefix &&
    suffix < newN.length - prefix &&
    oldN[oldN.length - 1 - suffix] === newN[newN.length - 1 - suffix]
  )
    suffix++;

  const oldMiddleLength = oldN.length - prefix - suffix;
  let from: number;
  let to: number;
  if (oldMiddleLength > 0) {
    from = proj.map[at + prefix];
    to = proj.map[at + prefix + oldMiddleLength - 1] + 1;
  } else {
    // Pure insertion: right after the last unchanged character before it.
    from = to = prefix > 0 ? proj.map[at + prefix - 1] + 1 : proj.map[at];
  }
  let insert = newN.slice(prefix, newN.length - suffix);
  if (markdown) insert = toMarkdownParagraphs(insert);
  return { source: source.slice(0, from) + insert + source.slice(to), start: Math.min(passageStart, from) };
}
