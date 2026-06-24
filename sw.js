const CACHE = 'gjsuragan-v33-hide-closed-order-duplicate';
const PRECACHE = [
  './customer.html',
  './admin.html',
  './event-order.html',
  './links.html',
  './assets/img/event-lunch-banner.jpg',
  './assets/img/event-menu.jpg',
  './icons/icon.svg',
  './manifest.json',
  './admin-manifest.json'
];

try {
  importScripts('https://www.gstatic.com/firebasejs/9.22.0/firebase-app-compat.js');
  importScripts('https://www.gstatic.com/firebasejs/9.22.0/firebase-messaging-compat.js');

  firebase.initializeApp({
    apiKey: 'AIzaSyCWXHJfMLW2Cf7pjI2u6X5QVKeGW6oC_3A',
    authDomain: 'gjsuragan-60505.firebaseapp.com',
    projectId: 'gjsuragan-60505',
    storageBucket: 'gjsuragan-60505.firebasestorage.app',
    messagingSenderId: '1009198450175',
    appId: '1:1009198450175:web:4a55da7c2092dba42613ca'
  });

  const messaging = firebase.messaging();
  messaging.onBackgroundMessage((payload) => {
    const notification = payload.notification || {};
    const data = payload.data || {};
    const title = notification.title || '궁중수라간 알림';
    const body = notification.body || '새 알림이 있습니다.';

    self.registration.showNotification(title, {
      body,
      icon: './icons/icon.svg',
      badge: './icons/icon.svg',
      tag: data.requestId || data.type || 'gjsuragan-notification',
      renotify: true,
      data: {
        url: data.url || './admin.html#changeRequests',
        requestId: data.requestId || '',
        type: data.type || '',
        customerName: data.customerName || '',
        orderDate: data.orderDate || ''
      }
    });
  });
} catch (error) {
  console.warn('Firebase messaging service worker setup failed:', error);
}

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

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || './admin.html#changeRequests', self.location.origin).href;
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        if ('focus' in client && client.url.includes('admin.html')) {
          client.navigate(url);
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(url);
      return null;
    })
  );
});
