import express from 'express';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = Number(process.env.PORT) || 3000;
const host = process.env.HOST || '127.0.0.1';

app.use(express.json({ limit: '10mb' }));

// Web Article Clipper API (avec extraction automatique des images, support Wikipédia & sites web)
app.post('/api/web-clip', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: 'Une URL valide est requise' });
    }

    const trimmedUrl = url.trim();
    let targetUrl = trimmedUrl;
    if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
      targetUrl = 'https://' + targetUrl;
    }

    const parsedUrl = new URL(targetUrl);
    const isWikipedia = /(?:^|\.)wikipedia\.org$/i.test(parsedUrl.hostname);

    let html = '';
    let title = '';
    let author = parsedUrl.hostname;

    if (isWikipedia) {
      author = 'Wikipédia';
      const wikiMatch = parsedUrl.pathname.match(/^\/wiki\/([^#?]+)/);
      const hostParts = parsedUrl.hostname.split('.');
      const lang = hostParts.length >= 3 ? hostParts[0] : 'fr';

      if (wikiMatch) {
        const rawSlug = wikiMatch[1];
        const pageTitle = decodeURIComponent(rawSlug.replace(/_/g, ' '));
        title = pageTitle;

        // Tenter l'API REST officielle de Wikipédia (HTML sémantique avec figures et images haute résolution)
        try {
          const restApiUrl = `https://${lang}.wikipedia.org/api/rest_v1/page/html/${encodeURIComponent(rawSlug)}`;
          const restRes = await fetch(restApiUrl, {
            headers: {
              'User-Agent': 'FolioleReader/1.0 (Incremental Reading App; mailto:contact@foliole.app)',
            },
          });
          if (restRes.ok) {
            html = await restRes.text();
          }
        } catch (e) {
          console.warn('Wikipedia REST API fallback vers HTML direct:', e);
        }
      }
    }

    // Si non-Wikipédia ou si le REST API échoue, charger directement la page
    if (!html) {
      const response = await fetch(targetUrl, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
        },
      });

      if (!response.ok) {
        throw new Error(`Échec du chargement de l'URL : HTTP ${response.status}`);
      }

      html = await response.text();
    }

    // Extraction du titre si non défini
    if (!title) {
      const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
      title = titleMatch
        ? titleMatch[1]
            .replace(/\s*[-–|•]\s*(?:Wikipédia|Wikipedia|Le Monde|Medium|Substack|The Verge|BBC|CNN).*$/i, '')
            .trim()
        : 'Article Web';
    }

    // Extraction d'auteur dans les balises meta
    const authorMatch =
      html.match(/<meta\s+name=["']author["']\s+content=["']([^"']+)["']/i) ||
      html.match(/<meta\s+property=["']article:author["']\s+content=["']([^"']+)["']/i);
    if (authorMatch && authorMatch[1]) {
      author = authorMatch[1].trim();
    }

    // Nettoyage des éléments d'interface non pertinents
    let clean = html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
      .replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, '')
      .replace(/<nav\b[^<]*(?:(?!<\/nav>)<[^<]*)*<\/nav>/gi, '')
      .replace(/<footer\b[^<]*(?:(?!<\/footer>)<[^<]*)*<\/footer>/gi, '')
      .replace(/<header\b[^<]*(?:(?!<\/header>)<[^<]*)*<\/header>/gi, '')
      .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, '')
      .replace(/<sup class=["'][^"']*reference[^"']*["'][^>]*>.*?<\/sup>/gi, '')
      .replace(/<span class=["'][^"']*mw-editsection[^"']*["'][^>]*>.*?<\/span>/gi, '')
      .replace(/<div class=["'][^"']*(?:navbox|ambox|catlinks|mw-jump-link|vector-menu)[^"']*["'][^>]*>.*?<\/div>/gi, '');

    // Fonction de résolution et validation d'URL d'image
    const resolveImgUrl = (rawSrc: string): string | null => {
      if (!rawSrc) return null;
      let src = rawSrc.trim();
      if (src.startsWith('data:') && !src.startsWith('data:image/')) return null;
      if (src.startsWith('//')) {
        src = 'https:' + src;
      } else if (!src.startsWith('http://') && !src.startsWith('https://') && !src.startsWith('data:')) {
        try {
          src = new URL(src, targetUrl).href;
        } catch {
          return null;
        }
      }

      // Filtrer les pixels espions et icônes parasites
      const lower = src.toLowerCase();
      if (
        lower.includes('1x1') ||
        lower.includes('pixel') ||
        lower.includes('tracker') ||
        lower.includes('spinner') ||
        lower.includes('edit-ltr') ||
        lower.includes('sprite') ||
        lower.includes('transparent.gif') ||
        lower.includes('wikimedia-button')
      ) {
        return null;
      }

      // Pour les vignettes Wikipédia, optimiser la résolution vers une largeur nette (ex. 500px)
      if (lower.includes('upload.wikimedia.org') && lower.includes('/thumb/')) {
        src = src.replace(/\/([0-9]{2,3})px-/, '/500px-');
      }

      return src;
    };

    const decodeEntities = (str: string): string => {
      return str
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&#x27;/g, "'")
        .replace(/&mdash;/g, '—')
        .replace(/&ndash;/g, '–');
    };

    const extractText = (chunk: string): string => {
      return decodeEntities(
        chunk
          .replace(/<br\s*\/?>/gi, '\n')
          .replace(/<[^>]+>/g, '')
          .replace(/\s+/g, ' ')
          .trim()
      );
    };

    // Analyse des blocs sémantiques ordonnés (Figures, Titres, Paragraphes, Listes, Citations)
    const blockRegex = /<(figure|div class=["'][^"']*(?:thumb|image|media)[^"']*["']|h[1-4]|p|li|blockquote)[^>]*>([\s\S]*?)<\/(?:figure|div|h[1-4]|p|li|blockquote)>/gi;

    const markdownBlocks: string[] = [];
    const seenImages = new Set<string>();
    let bMatch;

    while ((bMatch = blockRegex.exec(clean)) !== null) {
      const tagName = bMatch[1].toLowerCase();
      const innerHtml = bMatch[2];

      // 1. Figures ou conteneurs d'images avec légendes
      if (tagName.startsWith('figure') || tagName.startsWith('div')) {
        const imgMatch = innerHtml.match(/<img[^>]+(?:src|data-src)=["']([^"']+)["'][^>]*>/i);
        if (imgMatch) {
          const rawSrc = imgMatch[1];
          const resolved = resolveImgUrl(rawSrc);
          if (resolved && !seenImages.has(resolved)) {
            seenImages.add(resolved);
            const captionMatch = innerHtml.match(/<(?:figcaption|div class=["'][^"']*caption[^"']*["'])[^>]*>([\s\S]*?)<\/(?:figcaption|div)>/i);
            const altMatch = imgMatch[0].match(/alt=["']([^"']*)["']/i);
            const caption = captionMatch ? extractText(captionMatch[1]) : '';
            const alt = altMatch ? decodeEntities(altMatch[1].trim()) : caption || title;

            let mdImg = `![${alt}](${resolved})`;
            if (caption && caption !== alt) {
              mdImg += `\n*${caption}*`;
            }
            markdownBlocks.push(mdImg);
          }
        }
        continue;
      }

      // 2. Titres (h1 à h4)
      if (tagName.startsWith('h')) {
        const level = parseInt(tagName[1], 10) || 2;
        const text = extractText(innerHtml);
        if (text && text.length > 1) {
          if (/^(notes et références|références|voir aussi|liens externes|external links|see also|notes)$/i.test(text.trim())) {
            // Arrêter l'extraction avant les sections d'index bibliographiques
            break;
          }
          const hashes = '#'.repeat(level);
          markdownBlocks.push(`${hashes} ${text}`);
        }
        continue;
      }

      // 3. Paragraphes
      if (tagName === 'p') {
        const imgMatch = innerHtml.match(/<img[^>]+(?:src|data-src)=["']([^"']+)["'][^>]*>/i);
        if (imgMatch) {
          const resolved = resolveImgUrl(imgMatch[1]);
          if (resolved && !seenImages.has(resolved)) {
            seenImages.add(resolved);
            const altMatch = imgMatch[0].match(/alt=["']([^"']*)["']/i);
            const alt = altMatch ? decodeEntities(altMatch[1].trim()) : title;
            markdownBlocks.push(`![${alt}](${resolved})`);
          }
        }

        const text = extractText(innerHtml);
        if (text.length > 15) {
          markdownBlocks.push(text);
        }
        continue;
      }

      // 4. Éléments de liste
      if (tagName === 'li') {
        const text = extractText(innerHtml);
        if (text.length > 10) {
          markdownBlocks.push(`- ${text}`);
        }
        continue;
      }

      // 5. Citations
      if (tagName === 'blockquote') {
        const text = extractText(innerHtml);
        if (text.length > 10) {
          markdownBlocks.push(`> ${text}`);
        }
        continue;
      }
    }

    // Secours si les blocs complexes sont vides
    if (markdownBlocks.length === 0) {
      const pMatches = clean.match(/<p[^>]*>([\s\S]*?)<\/p>/gi) || [];
      for (const p of pMatches) {
        const text = extractText(p);
        if (text.length > 20) markdownBlocks.push(text);
      }
    }

    const content =
      markdownBlocks.join('\n\n') ||
      'Le contenu textuel n\'a pas pu être extrait automatiquement. Vous pouvez le coller ou l\'éditer directement dans Foliole.';

    return res.json({
      title,
      author,
      sourceUrl: targetUrl,
      content,
      imagesCount: seenImages.size,
    });
  } catch (error: any) {
    console.error('Erreur dans /api/web-clip:', error);
    return res.status(500).json({
      error: error.message || 'Impossible de récupérer l\'article web',
    });
  }
});

// Setup Vite middlewares and server
async function startServer() {
  const httpServer = http.createServer(app);

  if (process.env.NODE_ENV === 'production') {
    const staticDir = process.env.STATIC_DIR || path.resolve(__dirname, 'dist');
    app.use(express.static(staticDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(staticDir, 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const isHmrDisabled = process.env.DISABLE_HMR === 'true';

    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: isHmrDisabled ? false : { server: httpServer },
        watch: isHmrDisabled ? null : {},
      },
      appType: 'spa',
    });

    app.use(vite.middlewares);

    // Ensure SPA fallback serves transformed HTML
    app.use('*', async (req, res, next) => {
      const url = req.originalUrl;
      try {
        const indexPath = path.resolve(__dirname, 'index.html');
        if (fs.existsSync(indexPath)) {
          let template = fs.readFileSync(indexPath, 'utf-8');
          template = await vite.transformIndexHtml(url, template);
          res.status(200).set({ 'Content-Type': 'text/html' }).end(template);
        } else {
          next();
        }
      } catch (e) {
        next(e);
      }
    });
  }

  const listen = (p: number) =>
    new Promise<number>((resolve, reject) => {
      const onError = (err: NodeJS.ErrnoException) => {
        httpServer.off('listening', onListening);
        reject(err);
      };
      const onListening = () => {
        httpServer.off('error', onError);
        const addr = httpServer.address();
        resolve(typeof addr === 'object' && addr ? addr.port : p);
      };
      httpServer.once('error', onError);
      httpServer.once('listening', onListening);
      httpServer.listen(p, host);
    });

  let actualPort: number;
  try {
    actualPort = await listen(port);
  } catch (err: any) {
    // The desktop app no longer depends on a fixed port: pick any free one.
    if (err?.code !== 'EADDRINUSE' || process.env.PORT_FALLBACK !== '1') throw err;
    actualPort = await listen(0);
  }
  console.log(`Foliole: http://${host}:${actualPort}`);
  return actualPort;
}

// Resolves with the port once the server is accepting connections.
export const ready = startServer();
