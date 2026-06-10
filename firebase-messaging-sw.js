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
  const title = notification.title || '궁중수라간 변경요청';
  const body = notification.body || '새 고객 변경요청이 접수되었습니다.';

  self.registration.showNotification(title, {
    body,
    icon: './icons/icon.svg',
    badge: './icons/icon.svg',
    tag: data.requestId ? `change-request-${data.requestId}` : 'gjsuragan-change-request',
    renotify: true,
    data: {
      url: data.url || './admin.html#changeRequests',
      requestId: data.requestId || '',
      type: data.type || '',
      customerName: data.customerName || ''
    }
  });
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || './admin.html#changeRequests', self.location.origin).href;
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
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
