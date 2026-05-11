// ============================================================
//  Fileshift Service Worker
//  Caches the app shell for full offline use
// ============================================================

const CACHE_NAME = 'fileshift-v1';

// All files that make up the app shell
const APP_SHELL = [
  '/index.html',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',

  // External libraries — cached on first load so app works offline
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
  'https://cdn.jsdelivr.net/npm/xlsx-js-style@1.2.0/dist/xlsx.bundle.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
  'https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=DM+Mono:wght@400;500&display=swap'
];

// ── INSTALL: cache everything ────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      console.log('[SW] Caching app shell...');
      // Cache local files strictly; external ones best-effort
      const local  = APP_SHELL.filter(u => u.startsWith('/'));
      const remote = APP_SHELL.filter(u => !u.startsWith('/'));

      return cache.addAll(local).then(() =>
        Promise.allSettled(remote.map(url =>
          fetch(url, { mode: 'cors' })
            .then(res => { if (res.ok) cache.put(url, res) })
            .catch(() => console.warn('[SW] Could not pre-cache:', url))
        ))
      );
    }).then(() => self.skipWaiting())
  );
});

// ── ACTIVATE: delete old caches ─────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => {
            console.log('[SW] Deleting old cache:', key);
            return caches.delete(key);
          })
      )
    ).then(() => self.clients.claim())
  );
});

// ── FETCH: cache-first for shell, network-first for the rest ─
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle GET requests
  if (request.method !== 'GET') return;

  // Skip chrome-extension and non-http requests
  if (!request.url.startsWith('http')) return;

  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) {
        // Serve from cache, revalidate in background
        const fetchPromise = fetch(request)
          .then(networkRes => {
            if (networkRes && networkRes.ok) {
              caches.open(CACHE_NAME).then(cache => cache.put(request, networkRes.clone()));
            }
            return networkRes;
          })
          .catch(() => {});
        return cached;
      }

      // Not in cache — fetch from network and cache response
      return fetch(request).then(networkRes => {
        if (!networkRes || !networkRes.ok || networkRes.type === 'opaque') {
          return networkRes;
        }
        const toCache = networkRes.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(request, toCache));
        return networkRes;
      }).catch(() => {
        // Offline fallback — return the main app for navigation requests
        if (request.mode === 'navigate') {
          return caches.match('/index.html');
        }
      });
    })
  );
});

// ── MESSAGE: force update from app ──────────────────────────
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
