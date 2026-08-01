const CACHE_NAME = 'drowsyguard-v2';

const APP_SHELL = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './icon.svg',
  './icon-192.png',
  './icon-512.png'
];

// These are loaded via <script crossorigin="anonymous">, which requests them
// in 'cors' mode. jsdelivr sends proper CORS headers, so we fetch/cache them
// the same way — caching them in 'no-cors' (opaque) mode instead would make
// the browser silently reject the cached script when the real cors-mode
// request comes in, breaking FaceMesh/Camera entirely after install.
const CDN_ASSETS = [
  'https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/face_mesh.js',
  'https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils/camera_utils.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      await cache.addAll(APP_SHELL);
      await Promise.all(
        CDN_ASSETS.map((url) =>
          fetch(url, { mode: 'cors' })
            .then((res) => {
              if (res.ok) return cache.put(url, res);
            })
            .catch(() => { /* offline on first install — will retry on next online fetch */ })
        )
      );
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Cache-first for the app shell and any known CDN asset; network-first
// fallback to cache for everything else (e.g. Overpass API calls, which
// should always try live first and simply fail gracefully if offline).
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const isAppShell = APP_SHELL.some((a) => req.url.endsWith(a.replace('./', '')));
  const isCdn = CDN_ASSETS.some((a) => req.url === a);

  if (isAppShell || isCdn) {
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req).then((res) => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
          return res;
        });
      })
    );
  }
});
