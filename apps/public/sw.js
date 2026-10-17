// The service worker that makes Acadlas installable on a phone.
//
// It deliberately stores nothing about anyone. Phones in Indian homes are often shared,
// so no answer from the API — no child's attendance, fee or receipt — is ever written to
// the device. What it keeps is only what every visitor gets alike:
//   - the app's built files under /assets/ (their names change with every release), and
//   - one offline page, shown when there is no connection at all.
// Everything else goes to the network exactly as if this worker did not exist.
const VERSION = 'acadlas-v2';
const OFFLINE = '/offline.html';
const PRECACHE = [OFFLINE, '/offline.css', '/favicon-192x192.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // The API is never cached, never answered from a cache.
  if (url.pathname.startsWith('/api/')) return;

  // Pages: always the network. Only when there is none, the offline page.
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match(OFFLINE)));
    return;
  }

  // What the offline page itself needs: from the store, so it can show with no network.
  if (PRECACHE.includes(url.pathname)) {
    event.respondWith(caches.match(request).then((hit) => hit || fetch(request)));
    return;
  }

  // Built files are named by their contents, so a stored copy is never out of date.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches.open(VERSION).then((cache) => cache.put(request, copy));
            }
            return response;
          }),
      ),
    );
  }
});
