/* NLS Print — Service Worker
   Strategiya:
   - App shell (offline.html, iconlar, manifest) oldindan cache qilinadi.
   - Navigatsiya (sahifa ochish): NETWORK-FIRST → muvaffaqiyatsiz bo'lsa cache → offline.html.
   - Bir xil domen static (icon/manifest): CACHE-FIRST.
   - Supabase API / realtime / boshqa CDN: hech qachon cache qilinmaydi (har doim onlayn).
   Versiyani o'zgartirsangiz (masalan v2 → v3), eski cache avtomatik tozalanadi. */
const VERSION = 'nls-print-v1';
const SHELL_CACHE = 'shell-' + VERSION;
const RUNTIME_CACHE = 'runtime-' + VERSION;

const APP_SHELL = [
  '/offline.html',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-192.png',
  '/icons/icon-maskable-512.png',
  '/icons/apple-touch-icon.png',
  '/icons/favicon-32.png'
];

// Bu hostlarga so'rovlar HECH QACHON cache qilinmaydi (dinamik ma'lumot)
function isDynamic(url) {
  return /supabase\.(co|in)/i.test(url.hostname) ||
         url.pathname.indexOf('/rest/v1/') !== -1 ||
         url.pathname.indexOf('/realtime/') !== -1 ||
         url.pathname.indexOf('/auth/v1/') !== -1;
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map((k) => {
        if (k !== SHELL_CACHE && k !== RUNTIME_CACHE) return caches.delete(k);
      }))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;               // faqat GET
  const url = new URL(req.url);

  if (isDynamic(url)) return;                      // Supabase/API — to'g'ridan to'g'ri tarmoqqa

  // 1) Sahifa navigatsiyasi — network-first
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(RUNTIME_CACHE).then((c) => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() =>
          caches.match(req)
            .then((c) => c || caches.match('/'))
            .then((c) => c || caches.match('/offline.html'))
        )
    );
    return;
  }

  // 2) Bir xil domen static fayllar — cache-first
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(req).then((cached) =>
        cached ||
        fetch(req).then((res) => {
          if (res && res.status === 200 && res.type === 'basic') {
            const copy = res.clone();
            caches.open(RUNTIME_CACHE).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        }).catch(() => cached)
      )
    );
    return;
  }

  // 3) Tashqi CDN (masalan Supabase JS kutubxonasi) — stale-while-revalidate
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req).then((res) => {
        if (res && (res.status === 200 || res.type === 'opaque')) {
          const copy = res.clone();
          caches.open(RUNTIME_CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
