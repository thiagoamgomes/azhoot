// Servidor estático mínimo (sem dependências) para a SPA do AZhoot.
// Serve os arquivos de ./dist com fallback de SPA para index.html.
// O proxy reverso do host (nginx) encaminha /api, /uploads e /socket.io para a API.
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';

const ROOT = join(process.cwd(), 'dist');
const PORT = Number(process.env.PORT ?? 8080);
const HOST = process.env.HOST ?? '0.0.0.0';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

function safePath(urlPath) {
  const clean = normalize(decodeURIComponent(urlPath.split('?')[0])).replace(/^(\.\.[/\\])+/, '');
  const full = join(ROOT, clean);
  return full.startsWith(ROOT) ? full : ROOT;
}

function send(res, status, file, { cache } = {}) {
  const ext = extname(file).toLowerCase();
  res.writeHead(status, {
    'Content-Type': TYPES[ext] ?? 'application/octet-stream',
    'Cache-Control': cache ?? 'no-cache',
    'X-Content-Type-Options': 'nosniff',
  });
  createReadStream(file).pipe(res);
}

const server = createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405).end('Method Not Allowed');
    return;
  }
  const target = safePath(req.url || '/');
  // Arquivo existente (assets com hash → cache longo; demais → no-cache).
  if (existsSync(target) && statSync(target).isFile()) {
    const longCache = target.includes(`${'assets'}/`) || /\.[0-9a-f]{8,}\./i.test(target);
    send(res, 200, target, {
      cache: longCache ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    return;
  }
  // Fallback de SPA.
  const index = join(ROOT, 'index.html');
  if (existsSync(index)) {
    send(res, 200, index, { cache: 'no-cache' });
    return;
  }
  res.writeHead(404).end('Not found');
});

server.listen(PORT, HOST, () => {
  // eslint-disable-next-line no-console
  console.log(`[azhoot-web] SPA servida em http://${HOST}:${PORT} (dir: ${ROOT})`);
});
