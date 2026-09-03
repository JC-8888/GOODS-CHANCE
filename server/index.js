import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JsonStore } from './store.js';
import { AdminAuth } from './auth.js';
import { routeApi, runExpirySweep } from './api.js';
import { HttpError } from './util.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = path.resolve(__dirname, '..');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8'
};

/** Files allowed to be served from the repo root (everything else is app code / tooling). */
const BASE_PUBLIC = new Set([
  'index.html', 'item.html', 'reserve.html', 'my-reservations.html', 'support.html',
  'manifest.webmanifest', 'sw.js', 'robots.txt'
]);
const PUBLIC_DIRS = new Set(['css', 'js', 'images', 'admin']);

function isPublicPath(relPath) {
  const first = relPath.split('/')[0];
  return PUBLIC_DIRS.has(first) || BASE_PUBLIC.has(relPath);
}

export function createApp({ dbPath, adminPassword } = {}) {
  const store = new JsonStore(dbPath || path.join(PROJECT_ROOT, 'db.json'));
  const auth = new AdminAuth(adminPassword || process.env.ADMIN_PASSWORD || 'easoug1234');

  // Periodic expiry sweep (24h reservation window).
  const sweepTimer = setInterval(() => runExpirySweep({ store, auth }), 60_000);
  sweepTimer.unref?.();

  const server = http.createServer(async (req, res) => {
    try {
      await handle(req, res);
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      if (status >= 500) console.error('[server]', err);
      sendJson(res, status, { error: status >= 500 ? '伺服器錯誤，請稍後再試。' : err.message });
    }
  });

  async function handle(req, res) {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const parts = url.pathname.split('/').filter(Boolean);

    if (parts[0] === 'api') {
      const body = await readBody(req);
      const token = bearerToken(req.headers.authorization);
      const result = routeApi({
        store, auth, method: req.method,
        parts, query: url.searchParams, body,
        ip: req.socket.remoteAddress || '', token
      });
      if (!result) { sendJson(res, 404, { error: '找不到此 API 路徑。' }); return; }
      if (result.raw !== undefined) {
        const headers = {
          'Content-Type': result.contentType || 'text/plain; charset=utf-8',
          'X-Content-Type-Options': 'nosniff',
          'Cache-Control': 'no-store'
        };
        if (result.downloadName) {
          headers['Content-Disposition'] = `attachment; filename="${result.downloadName}"`;
        }
        res.writeHead(result.status, headers);
        res.end(result.raw);
        return;
      }
      sendJson(res, result.status, result.data);
      return;
    }

    serveStatic(res, url.pathname);
  }

  async function serveStatic(res, pathname) {
    let rel = decodeURIComponent(pathname).replace(/^\/+/, '');
    if (rel === '' || rel === 'index.html') rel = 'index.html';
    const filePath = path.resolve(PROJECT_ROOT, rel);
    if (!filePath.startsWith(PROJECT_ROOT + path.sep) || !isPublicPath(rel)) {
      sendText(res, 404, 'Not found');
      return;
    }
    fs.stat(filePath, (err, stat) => {
      if (err) { sendText(res, 404, 'Not found'); return; }
      if (stat.isDirectory()) {
        // Directory URLs (/admin/) serve the directory's index.html.
        const index = path.join(filePath, 'index.html');
        fs.stat(index, (err2, stat2) => {
          if (err2 || !stat2.isFile()) { sendText(res, 404, 'Not found'); return; }
          sendFile(res, index, pathname);
        });
        return;
      }
      if (!stat.isFile()) { sendText(res, 404, 'Not found'); return; }
      sendFile(res, filePath, pathname);
    });
  }

  function sendFile(res, filePath, pathname) {
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      // HTML revalidates every load (dynamic shell); sw.js never caches; assets can be cached.
      'Cache-Control': (pathname === '/sw.js' || path.extname(filePath) === '.html')
        ? 'no-cache'
        : 'public, max-age=3600',
      'X-Content-Type-Options': 'nosniff'
    });
    fs.createReadStream(filePath).pipe(res);
  }

  return {
    server, store, auth,
    close() {
      store.flushSync();
      clearInterval(sweepTimer);
      return new Promise((resolve) => server.close(resolve));
    }
  };
}

function bearerToken(header) {
  if (!header) return null;
  const m = /^Bearer\s+(.+)$/i.exec(header);
  return m ? m[1] : null;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 4 * 1024 * 1024) {
        reject(new HttpError(413, '請求內容過大。'));
        req.destroy();
        return;
      }
      raw += chunk;
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch { reject(new HttpError(400, '請求格式不正確。')); }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function sendText(res, status, text) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(text);
}

/** Start the server (exported so any launcher — including node -e and launchd — can boot it). */
export function start({ port = Number(process.env.PORT) || 8787 } = {}) {
  const app = createApp();
  app.server.listen(port, () => {
    const db = app.store.file;
    const seeded = app.store.data.actions.length === 0 && app.store.data.items.some((i) => i.id.startsWith('itm_seed'));
    console.log(`\n  易搜數碼 Easoug — MVP`);
    console.log(`  ➜ 網站:   http://localhost:${port}`);
    console.log(`  ➜ 後台:   http://localhost:${port}/admin/`);
    console.log(`  ➜ 資料:   ${db}`);
    console.log(`  ➜ 後台密碼: ${process.env.ADMIN_PASSWORD ? '(自 ADMIN_PASSWORD)' : 'easoug1234'}\n`);
    if (seeded) console.log('  （首次啟動已建立示範資料，可在後台或直接編輯 db.json 修改）\n');
  });
  const shutdown = () => {
    app.close().then(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  return app;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  start();
}
