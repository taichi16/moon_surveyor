/**
 * Moon Surveyor PWA Service Worker (支援 100% 離線使用與快取優先策略)
 */

const CACHE_NAME = 'moon-surveyor-v1';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icon.svg',
  '/data/cwa_moon_compact.json'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((k) => {
          if (k !== CACHE_NAME) return caches.delete(k);
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  // 對於氣象署本地 JSON 資料使用 Stale-While-Revalidate 策略
  if (e.request.url.includes('/data/cwa_moon_compact.json')) {
    e.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(e.request);
        const networkFetch = fetch(e.request).then((resp) => {
          if (resp.ok) cache.put(e.request, resp.clone());
          return resp;
        }).catch(() => cached);
        return cached || networkFetch;
      })
    );
    return;
  }

  // 其他資源快取優先
  e.respondWith(
    caches.match(e.request).then((cached) => {
      return cached || fetch(e.request);
    })
  );
});
