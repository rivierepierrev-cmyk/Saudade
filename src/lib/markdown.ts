import { marked, type Token, type TokenizerAndRendererExtension } from 'marked';
import DOMPurify from 'dompurify';
import { renderTex } from './math';
import { withMediaUrls } from './media';

// External links open in the system browser (the desktop app routes target=_blank there).
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A' && /^https?:/i.test(node.getAttribute('href') ?? '')) {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
  }
});

// LaTeX formulas. They are tokenized before Markdown, so `_` or `*` inside a
// formula are never read as emphasis.
const blockMath: TokenizerAndRendererExtension = {
  name: 'blockMath',
  level: 'block',
  start: (src) => src.match(/^ {0,3}(\$\$|\\\[)/m)?.index,
  tokenizer(src) {
    const m = /^ {0,3}(?:\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]) *(?:\n+|$)/.exec(src);
    if (m) return { type: 'blockMath', raw: m[0], text: (m[1] ?? m[2]).trim() };
  },
  renderer: (token) => `<div class="math-block">${renderTex(token.text, true)}</div>\n`,
};

// A fenced block marked as LaTeX (```latex, ```tex, ```math, ```katex), as ChatGPT and
// others write formulas: shown as a formula, not as code.
const fencedMath: TokenizerAndRendererExtension = {
  name: 'fencedMath',
  level: 'block',
  start: (src) => src.match(/^ {0,3}(`{3,}|~{3,}) *(?:latex|tex|math|katex)\b/im)?.index,
  tokenizer(src) {
    const m = /^ {0,3}(`{3,}|~{3,}) *(?:latex|tex|math|katex)[^\n`]*\n([\s\S]*?)\n {0,3}\1[`~]* *(?:\n+|$)/i.exec(src);
    if (m && m[2].trim()) return { type: 'blockMath', raw: m[0], text: m[2].trim() };
  },
};

const inlineMath: TokenizerAndRendererExtension = {
  name: 'inlineMath',
  level: 'inline',
  start(src) {
    const m = /(?<!\\)(\$|\\\()/.exec(src);
    return m?.index;
  },
  tokenizer(src) {
    let m = /^\$\$([\s\S]+?)\$\$/.exec(src);
    if (m) return { type: 'inlineMath', raw: m[0], text: m[1], display: true };
    m = /^\\\(([\s\S]+?)\\\)/.exec(src);
    if (m) return { type: 'inlineMath', raw: m[0], text: m[1], display: false };
    // $…$: not "$ " at the start, not " $" at the end, not followed by a digit (prices).
    m = /^\$(?!\s)((?:\\.|[^\\$\n])+?)(?<!\s)\$(?!\d)/.exec(src);
    if (m) return { type: 'inlineMath', raw: m[0], text: m[1], display: false };
  },
  renderer: (token) => renderTex(token.text, token.display),
};

marked.use({ extensions: [fencedMath, blockMath, inlineMath] });

const SANITIZE = {
  FORBID_TAGS: ['style', 'form', 'input', 'button', 'iframe', 'object', 'embed'],
  // <semantics>/<annotation> hold the LaTeX source of formulas (text only), used to
  // copy formulas as LaTeX when text is extracted. annotation-xml stays forbidden.
  ADD_TAGS: ['semantics', 'annotation'],
  ADD_ATTR: ['target', 'encoding'],
  // DOMPurify's default list of allowed URLs, plus blob: (images in the phone app, see lib/media.ts).
  ALLOWED_URI_REGEXP: /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|matrix|blob):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
};

/** Markdown → HTML that is safe to insert in the page (no scripts, event handlers, iframes…). */
export function renderMarkdown(markdown: string): string {
  const html = marked.parse(markdown, { async: false }) as string;
  return withMediaUrls(DOMPurify.sanitize(html, SANITIZE));
}

/**
 * As renderMarkdown, with each top-level block marked with its place in the text:
 * data-src="start-end", offsets in `normalizeSource(markdown)`. Lets the reader find
 * the Markdown behind a selection (to edit only that passage).
 */
export function renderMarkdownMapped(markdown: string): string {
  const src = normalizeSource(markdown);
  const tokens = marked.lexer(src);
  let pos = 0;
  const html = tokens
    .map((token: Token) => {
      const start = src.indexOf(token.raw, pos);
      if (start < 0) return marked.parser(Object.assign([token], { links: tokens.links }));
      pos = start + token.raw.length;
      const part = marked.parser(Object.assign([token], { links: tokens.links }));
      return part.replace(/^(\s*<[a-z][a-z0-9-]*)/i, `$1 data-src="${start}-${pos}"`);
    })
    .join('');
  return withMediaUrls(DOMPurify.sanitize(html, SANITIZE));
}

/** The text as the Markdown reader sees it (line breaks \n). */
export const normalizeSource = (markdown: string) => markdown.replace(/\r\n?/g, '\n');

/**
 * The part of the text to edit for a selection covering the blocks [blockStart,
 * blockEnd): just the selected words when they appear once, as is, in those blocks;
 * otherwise (formatting, formulas, several blocks) the whole blocks.
 */
export function editableRange(source: string, blockStart: number, blockEnd: number, selected: string): { start: number; end: number } {
  const words = selected.trim();
  const blocks = source.slice(blockStart, blockEnd);
  const at = words ? blocks.indexOf(words) : -1;
  if (at >= 0 && blocks.indexOf(words, at + 1) < 0) return { start: blockStart + at, end: blockStart + at + words.length };
  let end = blockEnd;
  while (end > blockStart && /\s/.test(source[end - 1])) end--;
  return { start: blockStart, end };
}

/** Sanitizes HTML produced by our own renderers (cards, extracts) before display. */
export function safeHtml(html: string): string {
  return DOMPurify.sanitize(html, SANITIZE);
}
