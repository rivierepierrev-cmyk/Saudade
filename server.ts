import express from 'express';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = Number(process.env.PORT) || 3000;
const host = process.env.HOST || '127.0.0.1';

app.use(express.json({ limit: '10mb' }));

// Where downloaded and imported images are stored. The desktop app points this to
// its data folder; `npm run dev` uses ./.foliole-data.
const dataDir = process.env.FOLIOLE_DATA_DIR || path.resolve(process.cwd(), '.foliole-data');
const mediaDir = path.join(dataDir, 'media');
fs.mkdirSync(mediaDir, { recursive: true });

const MAX_PAGE_BYTES = 15 * 1024 * 1024;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 20000;
const BROWSER_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

const IMAGE_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/svg+xml': 'svg',
  'image/bmp': 'bmp',
};

// The API is only for the Foliole page itself. Requiring a custom header makes
// browsers send a CORS preflight for any other website, which is never approved,
// so web pages you visit can't make the app fetch URLs or write files.
app.use('/api', (req, res, next) => {
  if (req.get('X-Foliole') !== '1') return res.status(403).json({ error: 'Requête refusée' });
  next();
});

function normalizeUrl(raw: unknown): URL {
  if (!raw || typeof raw !== 'string') throw new Error('Une URL valide est requise');
  let value = raw.trim();
  if (!/^https?:\/\//i.test(value)) value = 'https://' + value;
  const url = new URL(value);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Seules les adresses http(s) sont acceptées');
  return url;
}

async function fetchLimited(url: URL, accept: string, maxBytes: number, referer?: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': BROWSER_UA,
        Accept: accept,
        'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
        ...(referer ? { Referer: referer } : {}),
      },
    });
    if (!response.ok) throw new Error(`Échec du chargement : HTTP ${response.status}`);
    const declared = Number(response.headers.get('content-length') || 0);
    if (declared > maxBytes) throw new Error('Fichier trop volumineux');
    const chunks: Uint8Array[] = [];
    let total = 0;
    const reader = response.body!.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        controller.abort();
        throw new Error('Fichier trop volumineux');
      }
      chunks.push(value);
    }
    return { response, body: Buffer.concat(chunks) };
  } catch (e: any) {
    if (e?.name === 'AbortError') throw new Error('Délai dépassé');
    // Node reports network errors as "fetch failed"; the useful part is the cause.
    const cause = e?.cause;
    if (cause) {
      const reason: Record<string, string> = {
        ENOTFOUND: 'adresse introuvable',
        ECONNREFUSED: 'connexion refusée',
        ECONNRESET: 'connexion interrompue',
        ETIMEDOUT: 'délai dépassé',
        CERT_HAS_EXPIRED: 'certificat expiré',
      };
      throw new Error(`Connexion impossible (${reason[cause.code] || cause.code || cause.message})`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

function charsetOf(contentType: string, body: Buffer): string {
  const fromHeader = /charset=([\w-]+)/i.exec(contentType)?.[1];
  if (fromHeader) return fromHeader;
  const head = body.subarray(0, 4096).toString('latin1');
  return /<meta[^>]+charset=["']?([\w-]+)/i.exec(head)?.[1] || 'utf-8';
}

function saveMedia(bytes: Buffer, mime: string): string {
  const type = mime.split(';')[0].trim().toLowerCase();
  const ext = IMAGE_EXT[type];
  if (!ext) throw new Error(`Type d'image non pris en charge : ${type || 'inconnu'}`);
  const name = `${crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 32)}.${ext}`;
  const file = path.join(mediaDir, name);
  if (!fs.existsSync(file)) {
    fs.writeFileSync(`${file}.tmp`, bytes);
    fs.renameSync(`${file}.tmp`, file);
  }
  return `/media/${name}`;
}

// Fetch a web page's HTML; the article is extracted in the page with Readability.
app.post('/api/fetch-page', async (req, res) => {
  try {
    const url = normalizeUrl(req.body?.url);
    const { response, body } = await fetchLimited(url, 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8', MAX_PAGE_BYTES);
    const contentType = response.headers.get('content-type') || '';
    if (contentType && !/html|xml|text\/plain/i.test(contentType)) {
      throw new Error(`Cette adresse ne renvoie pas une page web (${contentType.split(';')[0]})`);
    }
    let html: string;
    try {
      html = new TextDecoder(charsetOf(contentType, body)).decode(body);
    } catch {
      html = new TextDecoder('utf-8').decode(body);
    }
    res.json({ html, url: response.url || url.href });
  } catch (error: any) {
    res.status(502).json({ error: error.message || "Impossible de récupérer la page" });
  }
});

// Download an image and keep a local copy, so documents display offline.
app.post('/api/media/fetch', async (req, res) => {
  try {
    const url = normalizeUrl(req.body?.url);
    const referer = typeof req.body?.referer === 'string' ? req.body.referer : undefined;
    const { response, body } = await fetchLimited(url, 'image/avif,image/webp,image/*;q=0.8', MAX_IMAGE_BYTES, referer);
    res.json({ path: saveMedia(body, response.headers.get('content-type') || '') });
  } catch (error: any) {
    res.status(502).json({ error: error.message || "Impossible de télécharger l'image" });
  }
});

// Store an image coming from an imported file (EPUB, HTML…). Body = raw bytes.
app.post('/api/media/upload', express.raw({ type: 'image/*', limit: MAX_IMAGE_BYTES }), (req, res) => {
  try {
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) throw new Error('Image vide');
    res.json({ path: saveMedia(req.body, req.get('content-type') || '') });
  } catch (error: any) {
    res.status(400).json({ error: error.message || "Impossible d'enregistrer l'image" });
  }
});

app.use(
  '/media',
  express.static(mediaDir, {
    immutable: true,
    maxAge: '365d',
    setHeaders: (res) => {
      // Images only: never let a stored file run scripts (e.g. an SVG opened directly).
      res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'");
      res.setHeader('X-Content-Type-Options', 'nosniff');
    },
  })
);

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
