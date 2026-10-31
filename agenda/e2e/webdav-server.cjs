// A small WebDAV server for the tests: what the app uses of Nextcloud (PROPFIND depth 1, GET with Range,
// PUT, MKCOL, DELETE), Basic authentication, and CORS so that a page can call it.
const http = require('node:http');

function startWebdav(port, { user = 'prof', password = 'app-pass' } = {}) {
  const files = new Map(); // path → Buffer
  const folders = new Set(['/remote.php/dav/files/prof']);
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, PUT, DELETE, PROPFIND, MKCOL, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Depth, Content-Type, Range',
    'Access-Control-Expose-Headers': 'Content-Range, Content-Length',
  };
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const send = (status, body = '', headers = {}) => {
        res.writeHead(status, { ...cors, ...headers });
        res.end(body);
      };
      if (req.method === 'OPTIONS') return send(204);
      if (req.headers.authorization !== `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`) return send(401);
      const path = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/\/+$/, '');
      const parent = path.slice(0, path.lastIndexOf('/'));
      const body = Buffer.concat(chunks);
      switch (req.method) {
        case 'PROPFIND': {
          if (!folders.has(path)) return send(404);
          const entries = [`<d:response><d:href>${path}/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response>`];
          for (const [p, b] of files) {
            if (p.slice(0, p.lastIndexOf('/')) !== path) continue;
            entries.push(`<d:response><d:href>${encodeURI(p)}</d:href><d:propstat><d:prop><d:getcontentlength>${b.length}</d:getcontentlength><d:resourcetype/></d:prop></d:propstat></d:response>`);
          }
          return send(207, `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:">${entries.join('')}</d:multistatus>`, { 'Content-Type': 'application/xml' });
        }
        case 'MKCOL':
          if (!folders.has(parent)) return send(409);
          folders.add(path);
          return send(201);
        case 'PUT':
          if (!folders.has(parent)) return send(409);
          files.set(path, body);
          return send(201);
        case 'GET': {
          const b = files.get(path);
          if (!b) return send(404);
          const m = /^bytes=(\d+)-$/.exec(req.headers.range ?? '');
          if (m) return send(206, b.subarray(Number(m[1])), { 'Content-Range': `bytes ${m[1]}-${b.length - 1}/${b.length}` });
          return send(200, b);
        }
        case 'DELETE':
          files.delete(path);
          return send(204);
        default:
          return send(405);
      }
    });
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({ files, folders, close: () => server.close() })));
}

module.exports = { startWebdav };
