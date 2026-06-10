const CACHE = 'gjsuragan-v26-event-lunch-loading';
const PRECACHE = [
  './customer.html',
  './admin.html',
  './event-order.html',
  './links.html',
  './assets/img/event-lunch-banner.jpg',
  './assets/img/event-menu.jpg',
  './icons/icon.svg',
  './manifest.json',
  './admin-manifest.json',
  './firebase-messaging-sw.js'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});
