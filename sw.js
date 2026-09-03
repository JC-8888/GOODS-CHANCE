/* 易搜數碼 Easoug — service worker
   - precaches the app shell so the site opens offline
   - network-first for the item list with cache fallback (last seen list offline)
   - caches images as they are seen */
const CACHE = 'easoug-v4';
const SHELL = [
  '/',
  '/index.html',
  '/item.html',
  '/reserve.html',
  '/my-reservations.html',
  '/support.html',
  '/css/style.css',
  '/js/api.js',
  '/js/common.js',
  '/js/index.js',
  '/js/item.js',
  '/js/reserve.js',
  '/js/my-reservations.js',
  '/js/support.js',
  '/manifest.webmanifest',
  '/images/icons/icon-192.png',
  '/images/icons/icon-512.png',
  '/images/seed/default.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => Promise.all(
        SHELL.map((u) => fetch(u, { cache: 'reload' }).then((r) => cache.put(u, r)))
      ))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function handle(event) {
  const req = event.request;
  const url = new URL(req.url);

  // API: item list — network first, fall back to the last cached copy when offline.
  if (url.pathname === '/api/items') {
    const cache = await caches.open(CACHE);
    try {
      const res = await fetch(req);
      cache.put(req, res.clone());
      return res;
    } catch {
      const cached = await cache.match(req);
      if (cached) return cached;
      // No cached copy: serve a minimal empty-list JSON so the page still renders.
      return new Response(JSON.stringify([]), { headers: { 'Content-Type': 'application/json' } });
    }
  }

  // Images / seed artwork: cache-first.
  if (/\.(png|svg|jpg|jpeg|webp|gif)$/.test(url.pathname)) {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(req);
    if (cached) return cached;
    try {
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    } catch {
      return cached || new Response('', { status: 404 });
    }
  }

  // Navigation & static shell: network first, fall back to cache (offline PWA).
  const cache = await caches.open(CACHE);
  const cached = await cache.match(req);
  try {
    const res = await fetch(req);
    if (res.ok && (req.mode === 'navigate' || res.type === 'basic')) cache.put(req, res.clone());
    return res;
  } catch {
    if (cached) return cached;
    if (req.mode === 'navigate') {
      const index = await cache.match('/index.html');
      if (index) return index;
    }
    return new Response('offline', { status: 503 });
  }
}

self.addEventListener('fetch', (event) => {
  // Only intercept same-origin GETs. Calling respondWith for other requests
  // (POST/PATCH/DELETE or cross-origin) would reject them with "Failed to fetch".
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  event.respondWith(handle(event));
});
