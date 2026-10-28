/**
 * Importers: web pages, HTML files, PDF and EPUB → clean Markdown with local images.
 * Everything runs in the page; the local server only fetches URLs and stores images.
 */

import { Readability } from '@mozilla/readability';
import DOMPurify from 'dompurify';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';

export interface ImportedDocument {
  title: string;
  author?: string;
  sourceUrl?: string;
  format: 'article' | 'book' | 'pdf' | 'markdown' | 'note';
  content: string; // Markdown
}

export type ProgressCallback = (message: string) => void;

// ---- Local API ---------------------------------------------------------------

async function api<T>(path: string, init: { json?: unknown; body?: Blob; contentType?: string }): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: {
      'X-Saudade': '1',
      'Content-Type': init.contentType ?? 'application/json',
    },
    body: init.body ?? JSON.stringify(init.json),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);
  return data as T;
}

const fetchPage = (url: string) => api<{ html: string; url: string }>('/api/fetch-page', { json: { url } });
export const fetchImage = (url: string, referer?: string) =>
  api<{ path: string }>('/api/media/fetch', { json: { url, referer } }).then((r) => r.path);
export const uploadImage = (bytes: Uint8Array, mime: string) =>
  api<{ path: string }>('/api/media/upload', { body: new Blob([bytes as BlobPart], { type: mime }), contentType: mime }).then(
    (r) => r.path
  );

// ---- HTML → Markdown -----------------------------------------------------------

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
  emDelimiter: '*',
});
turndown.use(gfm);
// Drop elements that carry no reading value.
turndown.remove(['script', 'style', 'noscript', 'iframe', 'form', 'button', 'nav', 'footer', 'input', 'select']);
// Keep figure captions under their image.
turndown.addRule('figcaption', {
  filter: 'figcaption',
  replacement: (content) => (content.trim() ? `\n\n*${content.trim()}*\n\n` : ''),
});

// Formulas in web pages and books (MathML with a TeX annotation, Wikipedia,
// KaTeX/MathJax output) are kept as LaTeX. Readability drops hidden elements and
// classes, and Turndown would escape the LaTeX, so each formula is first replaced
// by a marker and restored as $…$ / $$…$$ in the final Markdown.
const MATH_SELECTOR = [
  '.mwe-math-element',
  '.katex-display',
  '.katex',
  'math',
  'img.mwe-math-fallback-image-inline',
  'img.mwe-math-fallback-image-display',
  'script[type^="math/tex"]',
].join(', ');

function texFromElement(el: Element): { tex: string; display: boolean } | null {
  const tag = el.tagName.toLowerCase();
  const tex =
    (tag === 'script' ? el.textContent : null) ??
    el.querySelector('annotation[encoding="application/x-tex"]')?.textContent ??
    (tag === 'math' ? el.getAttribute('alttext') : null) ??
    el.querySelector('math[alttext]')?.getAttribute('alttext') ??
    (tag === 'img' ? el.getAttribute('alt') : el.querySelector('img[alt]')?.getAttribute('alt')) ??
    null;
  if (!tex?.trim()) return null;
  const display =
    el.matches('.katex-display, .mwe-math-fallback-image-display, math[display="block"], script[type*="mode=display"]') ||
    el.querySelector('.mwe-math-fallback-image-display, .katex-display, math[display="block"]') !== null;
  // Wikipedia wraps formulas in {\displaystyle …}
  const cleaned = tex
    .trim()
    .replace(/^\{\\(?:display|text)style\s*([\s\S]*)\}$/, '$1')
    .trim();
  return { tex: cleaned, display };
}

const mathMarker = (n: number) => `⟦saudade-math-${n}⟧`;

/** Replaces formulas in `root` by markers; returns the formulas in marker order. */
function protectMath(root: ParentNode, doc: Document): Array<{ tex: string; display: boolean }> {
  const formulas: Array<{ tex: string; display: boolean }> = [];
  for (const el of Array.from(root.querySelectorAll(MATH_SELECTOR))) {
    if (!el.isConnected || el.parentElement?.closest(MATH_SELECTOR)) continue; // inside another formula
    const math = texFromElement(el);
    if (!math) continue;
    formulas.push(math);
    el.replaceWith(doc.createTextNode(mathMarker(formulas.length - 1)));
  }
  return formulas;
}

function restoreMath(markdown: string, formulas: Array<{ tex: string; display: boolean }>): string {
  return markdown.replace(/⟦saudade-math-(\d+)⟧/g, (all, n) => {
    const math = formulas[Number(n)];
    if (!math) return all;
    return math.display ? `$$${math.tex}$$` : `$${math.tex}$`;
  });
}

export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    FORBID_TAGS: ['style', 'form', 'input', 'button', 'iframe', 'object', 'embed'],
    FORBID_ATTR: ['style'],
    // Keep the LaTeX source of formulas (see the "math" Turndown rule).
    ADD_TAGS: ['semantics', 'annotation'],
    ADD_ATTR: ['encoding', 'alttext', 'display'],
  });
}

export function htmlToMarkdown(html: string): string {
  return turndown
    .turndown(sanitizeHtml(html))
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ---- Images --------------------------------------------------------------------

const IMAGE_MD = /!\[([^\]]*)\]\((\S+?)(\s+"[^"]*")?\)/g;

/**
 * Downloads every remote image referenced in `markdown` and points the document
 * at the local copy. Images that can't be downloaded keep their original address.
 */
export async function localizeImages(
  markdown: string,
  referer: string | undefined,
  onProgress?: ProgressCallback
): Promise<{ markdown: string; saved: number; failed: number }> {
  const urls = Array.from(new Set(Array.from(markdown.matchAll(IMAGE_MD), (m) => m[2]))).filter((u) =>
    /^https?:\/\//i.test(u)
  );
  const mapping = new Map<string, string>();
  const missing = new Set<string>();
  let failed = 0;
  let done = 0;
  const queue = [...urls];
  const worker = async () => {
    for (let url = queue.shift(); url; url = queue.shift()) {
      try {
        mapping.set(url, await fetchImage(url, referer));
      } catch (e) {
        failed++;
        // The image doesn't exist (404…): drop it. Other errors (offline, timeout)
        // keep the original address so it can still display later.
        if (e instanceof Error && /HTTP 4\d\d/.test(e.message)) missing.add(url);
      }
      done++;
      onProgress?.(`Images : ${done}/${urls.length}`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, urls.length) }, worker));
  const result = markdown.replace(IMAGE_MD, (all, alt, url, title = '') =>
    mapping.has(url) ? `![${alt}](${mapping.get(url)}${title})` : missing.has(url) ? '' : all
  );
  return { markdown: result, saved: mapping.size, failed };
}

// ---- Web pages and HTML files -------------------------------------------------

function parseHtml(html: string, baseUrl?: string): Document {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  if (baseUrl) {
    doc.querySelector('base')?.remove();
    const base = doc.createElement('base');
    base.href = baseUrl;
    doc.head.prepend(base);
  }
  // Lazy-loaded images: promote the real source before extraction.
  doc.querySelectorAll('img').forEach((img) => {
    const lazy = img.getAttribute('data-src') || img.getAttribute('data-original') || img.getAttribute('data-lazy-src');
    if (lazy && (!img.getAttribute('src') || img.getAttribute('src')!.startsWith('data:'))) img.setAttribute('src', lazy);
    img.removeAttribute('srcset');
  });
  return doc;
}

function extractArticle(html: string, baseUrl?: string) {
  const doc = parseHtml(html, baseUrl);
  const formulas = protectMath(doc, doc);
  const fallbackTitle = doc.title?.trim();
  const metaAuthor = doc.querySelector('meta[name="author"]')?.getAttribute('content') ?? undefined;
  const mainHeading = doc.querySelector('h1')?.textContent?.replace(/\s+/g, ' ').trim();
  const article = new Readability(doc, { keepClasses: false }).parse();
  if (article?.content) {
    let title = article.title?.trim() || fallbackTitle || 'Sans titre';
    // "Article title - Site name": prefer the page's own heading when it matches.
    if (mainHeading && mainHeading.length > 3 && title !== mainHeading && title.startsWith(mainHeading)) {
      title = mainHeading;
    }
    return {
      title,
      author: article.byline?.trim() || metaAuthor || article.siteName || undefined,
      html: article.content,
      formulas,
    };
  }
  // Readability found no article: keep the whole body.
  const whole = parseHtml(html, baseUrl);
  return { title: fallbackTitle || 'Sans titre', author: metaAuthor, html: whole.body.innerHTML, formulas: protectMath(whole, whole) };
}

export async function importWebPage(url: string, onProgress?: ProgressCallback): Promise<ImportedDocument> {
  onProgress?.('Téléchargement de la page…');
  const page = await fetchPage(url);
  onProgress?.("Extraction de l'article…");
  const article = extractArticle(page.html, page.url);
  let content = restoreMath(htmlToMarkdown(article.html), article.formulas);
  if (!content) throw new Error("Aucun texte n'a pu être extrait de cette page.");
  content = (await localizeImages(content, page.url, onProgress)).markdown;
  return { title: article.title, author: article.author, sourceUrl: page.url, format: 'article', content };
}

export async function importHtmlFile(file: File, onProgress?: ProgressCallback): Promise<ImportedDocument> {
  const html = await file.text();
  const article = extractArticle(html);
  let content = restoreMath(htmlToMarkdown(article.html), article.formulas);
  content = (await localizeImages(content, undefined, onProgress)).markdown;
  return { title: article.title || stripExtension(file.name), author: article.author, format: 'article', content };
}

// ---- PDF -----------------------------------------------------------------------

interface PdfTextItem {
  str: string;
  transform: number[];
  height: number;
  hasEOL?: boolean;
}

/**
 * Rebuilds paragraphs from PDF text items: items are grouped into lines by their
 * vertical position, and a new paragraph starts after a larger vertical gap.
 */
function pdfPageToParagraphs(items: PdfTextItem[]): string[] {
  const lines: Array<{ y: number; h: number; text: string }> = [];
  for (const item of items) {
    if (!item.str) continue;
    const y = item.transform[5];
    const h = item.height || Math.abs(item.transform[3]) || 10;
    const last = lines[lines.length - 1];
    if (last && Math.abs(last.y - y) < h * 0.5) {
      last.text += (/\s$/.test(last.text) || /^\s/.test(item.str) ? '' : ' ') + item.str;
    } else {
      lines.push({ y, h, text: item.str });
    }
  }
  const paragraphs: string[] = [];
  let current = '';
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i].text.replace(/\s+/g, ' ').trim();
    if (!text) continue;
    if (current) {
      const gap = Math.abs(lines[i - 1].y - lines[i].y);
      if (gap > lines[i].h * 1.8) {
        paragraphs.push(current);
        current = text;
      } else if (/[\p{L}]-$/u.test(current)) {
        current = current.slice(0, -1) + text; // re-join hyphenated words
      } else {
        current += ' ' + text;
      }
    } else {
      current = text;
    }
  }
  if (current) paragraphs.push(current);
  return paragraphs;
}

export async function importPdf(file: File, onProgress?: ProgressCallback): Promise<ImportedDocument> {
  const pdfjs = await import('pdfjs-dist');
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const pdf = await loadingTask.promise;
  const meta = await pdf.getMetadata().catch(() => null);
  const info = (meta?.info ?? {}) as { Title?: string; Author?: string };
  const pages: string[] = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    onProgress?.(`Lecture de la page ${n}/${pdf.numPages}…`);
    const page = await pdf.getPage(n);
    const text = await page.getTextContent();
    const paragraphs = pdfPageToParagraphs(text.items as PdfTextItem[]);
    if (paragraphs.length) pages.push(paragraphs.join('\n\n'));
    page.cleanup();
  }
  await loadingTask.destroy();
  const content = pages.join('\n\n');
  if (!content.trim()) {
    throw new Error("Ce PDF ne contient pas de texte sélectionnable (document scanné ?).");
  }
  return {
    title: info.Title?.trim() || stripExtension(file.name),
    author: info.Author?.trim() || undefined,
    format: 'pdf',
    content: escapeMarkdownLineStarts(content),
  };
}

// ---- EPUB ----------------------------------------------------------------------

export interface ImportedBook {
  title: string;
  author?: string;
  chapters: ImportedDocument[];
}

function resolvePath(base: string, relative: string): string {
  const parts = base.split('/').slice(0, -1);
  for (const segment of decodeURIComponent(relative.split('#')[0]).split('/')) {
    if (segment === '..') parts.pop();
    else if (segment && segment !== '.') parts.push(segment);
  }
  return parts.join('/');
}

const MIME_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
};

export async function importEpub(file: File, onProgress?: ProgressCallback): Promise<ImportedBook> {
  const { unzipSync, strFromU8 } = await import('fflate');
  onProgress?.('Décompression du livre…');
  const zip = unzipSync(new Uint8Array(await file.arrayBuffer()));
  const text = (path: string) => {
    const bytes = zip[path];
    if (!bytes) throw new Error(`Fichier manquant dans l'EPUB : ${path}`);
    return strFromU8(bytes);
  };
  const xml = (path: string) => new DOMParser().parseFromString(text(path), 'application/xml');

  const container = xml('META-INF/container.xml');
  const opfPath = container.querySelector('rootfile')?.getAttribute('full-path');
  if (!opfPath) throw new Error('EPUB invalide : container.xml sans rootfile');
  const opf = xml(opfPath);
  const title = opf.getElementsByTagName('dc:title')[0]?.textContent?.trim() || stripExtension(file.name);
  const author = opf.getElementsByTagName('dc:creator')[0]?.textContent?.trim() || undefined;

  const manifest = new Map<string, { href: string; type: string }>();
  opf.querySelectorAll('manifest > item').forEach((item) => {
    manifest.set(item.getAttribute('id') ?? '', {
      href: resolvePath(opfPath, item.getAttribute('href') ?? ''),
      type: item.getAttribute('media-type') ?? '',
    });
  });
  const spine = Array.from(opf.querySelectorAll('spine > itemref'))
    .map((ref) => manifest.get(ref.getAttribute('idref') ?? ''))
    .filter((item): item is { href: string; type: string } => !!item && /html/.test(item.type));

  const uploaded = new Map<string, string>();
  const chapters: ImportedDocument[] = [];
  for (let i = 0; i < spine.length; i++) {
    onProgress?.(`Chapitre ${i + 1}/${spine.length}…`);
    const chapterPath = spine[i].href;
    const doc = new DOMParser().parseFromString(text(chapterPath), 'text/html');

    // Images (HTML <img> and SVG <image>) are stored locally.
    const images = Array.from(doc.querySelectorAll('img, image'));
    for (const img of images) {
      const attr = img.tagName.toLowerCase() === 'img' ? 'src' : img.hasAttribute('href') ? 'href' : 'xlink:href';
      const src = img.getAttribute(attr);
      if (!src || /^(https?:|data:)/i.test(src)) continue;
      const imgPath = resolvePath(chapterPath, src);
      const bytes = zip[imgPath];
      const mime = MIME_BY_EXT[imgPath.split('.').pop()?.toLowerCase() ?? ''];
      if (!bytes || !mime) continue;
      try {
        if (!uploaded.has(imgPath)) uploaded.set(imgPath, await uploadImage(bytes, mime));
        const local = uploaded.get(imgPath)!;
        if (img.tagName.toLowerCase() === 'img') {
          img.setAttribute('src', local);
        } else {
          // Replace an SVG <image> by a plain <img> so it survives sanitizing.
          const replacement = doc.createElement('img');
          replacement.setAttribute('src', local);
          replacement.setAttribute('alt', '');
          (img.closest('svg') ?? img).replaceWith(replacement);
        }
      } catch {
        // Keep going without this image.
      }
    }

    const formulas = doc.body ? protectMath(doc.body, doc) : [];
    const content = restoreMath(htmlToMarkdown(doc.body?.innerHTML ?? ''), formulas);
    const plain = doc.body?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    // Skip near-empty pages: copyright, table of contents, and the cover image.
    const isShort = plain.length < 200;
    if (isShort && (!/!\[/.test(content) || (chapters.length === 0 && i < 3))) continue;
    const heading = doc.querySelector('h1, h2, h3')?.textContent?.replace(/\s+/g, ' ').trim();
    const number = String(chapters.length + 1).padStart(2, '0');
    chapters.push({
      title: `${number} · ${heading || doc.title?.trim() || `Chapitre ${chapters.length + 1}`}`,
      author,
      format: 'book',
      content,
    });
  }
  if (chapters.length === 0) throw new Error("Aucun chapitre lisible n'a été trouvé dans ce livre.");
  return { title, author, chapters };
}

// ---- Helpers -------------------------------------------------------------------

function stripExtension(name: string): string {
  return name.replace(/\.[^/.]+$/, '');
}

/** Plain text must not be read as Markdown structure (e.g. "1." lists, "#" titles). */
function escapeMarkdownLineStarts(text: string): string {
  return text.replace(/^(\s*)([#>*+-]|\d+[.)])(\s)/gm, '$1\\$2$3');
}
