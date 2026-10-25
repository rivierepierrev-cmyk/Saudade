import { marked } from 'marked';
import DOMPurify from 'dompurify';

// External links open in the system browser (the desktop app routes target=_blank there).
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A' && /^https?:/i.test(node.getAttribute('href') ?? '')) {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
  }
});

/** Markdown → HTML that is safe to insert in the page (no scripts, event handlers, iframes…). */
export function renderMarkdown(markdown: string): string {
  const html = marked.parse(markdown, { async: false }) as string;
  return DOMPurify.sanitize(html, {
    FORBID_TAGS: ['style', 'form', 'input', 'button', 'iframe', 'object', 'embed'],
    ADD_ATTR: ['target'],
  });
}
