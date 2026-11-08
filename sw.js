// Bump this whenever the shell/update behavior changes. The versioned name
// guarantees old iOS home-screen workers are retired during activation.
const CACHE_NAME = 'quickie-shell-20261108-v3';
const APP_SHELL = [
  '/',
  '/offline.html',
  '/manifest.webmanifest',
  '/favicon.png',
  '/apple-touch-icon.png',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith('quickie-shell-') && key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

// Web Push becomes active after the backend stores subscriptions and sends
// VAPID payloads. Never cache notification payloads or user data here.
self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { body: event.data ? event.data.text() : '' };
  }
  const title = payload.title || 'Quickie';
  const options = {
    body: payload.body || 'Você tem uma nova notificação.',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    data: { url: typeof payload.url === 'string' && payload.url.startsWith('/') ? payload.url : '/' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/', self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const existing = clients.find((client) => client.url.startsWith(self.location.origin));
      if (existing) return existing.navigate(target).then(() => existing.focus());
      return self.clients.openWindow(target);
    })
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/socket.io/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            void caches.open(CACHE_NAME).then((cache) => cache.put('/', copy));
          }
          return response;
        })
        .catch(async () => (await caches.match('/')) || (await caches.match('/offline.html')))
    );
    return;
  }

  const isBuildAsset = url.pathname.startsWith('/_expo/') || url.pathname.startsWith('/assets/') ||
    url.pathname.startsWith('/icons/') || url.pathname.startsWith('/splash/') ||
    url.pathname === '/manifest.webmanifest' || url.pathname === '/favicon.png' ||
    url.pathname === '/apple-touch-icon.png' || url.pathname === '/offline.html';
  if (!isBuildAsset) return;

  event.respondWith(
    caches.match(request).then(async (cached) => {
      const isJavaScript = /\.(js|mjs)(\?|$)/i.test(url.pathname);
      if (cached && !isJavaScript) return cached;
      try {
        const response = await fetch(request);
        if (response.ok) {
          const copy = response.clone();
          void caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      } catch {
        return cached || Response.error();
      }
    })
  );
});
