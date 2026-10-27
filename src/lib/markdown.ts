import { marked, type TokenizerAndRendererExtension } from 'marked';
import DOMPurify from 'dompurify';
import { renderTex } from './math';

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

marked.use({ extensions: [blockMath, inlineMath] });

const SANITIZE = {
  FORBID_TAGS: ['style', 'form', 'input', 'button', 'iframe', 'object', 'embed'],
  // <semantics>/<annotation> hold the LaTeX source of formulas (text only), used to
  // copy formulas as LaTeX when text is extracted. annotation-xml stays forbidden.
  ADD_TAGS: ['semantics', 'annotation'],
  ADD_ATTR: ['target', 'encoding'],
};

/** Markdown → HTML that is safe to insert in the page (no scripts, event handlers, iframes…). */
export function renderMarkdown(markdown: string): string {
  const html = marked.parse(markdown, { async: false }) as string;
  return DOMPurify.sanitize(html, SANITIZE);
}

/** Sanitizes HTML produced by our own renderers (cards, extracts) before display. */
export function safeHtml(html: string): string {
  return DOMPurify.sanitize(html, SANITIZE);
}
