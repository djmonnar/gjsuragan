(function manualSafetyRuntime() {
  'use strict';

  const PROJECT_ID = 'demo-gjsuragan-safety';
  const AUTH_URL = 'http://127.0.0.1:9099';
  const FIRESTORE_HOST = '127.0.0.1';
  const FIRESTORE_PORT = 8080;
  const FUNCTIONS_URL = 'http://127.0.0.1:5001';
  const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);
  const forbiddenFragments = [
    ['gjsuragan', '60505'].join('-'),
    ['cloudfunctions', 'net'].join('.'),
    ['firestore', 'googleapis', 'com'].join('.'),
    ['identitytoolkit', 'googleapis', 'com'].join('.'),
    ['securetoken', 'googleapis', 'com'].join('.'),
    ['firebasestorage', 'googleapis', 'com'].join('.'),
    ['firebaseio', 'com'].join('.')
  ];
  const blockedRequests = [];

  if (!LOCAL_HOSTS.has(location.hostname)) {
    throw new Error('MANUAL SAFETY PREVIEW는 localhost에서만 실행할 수 있습니다.');
  }

  function absoluteUrl(value) {
    try {
      const raw = value && typeof value === 'object' && 'url' in value ? value.url : value;
      return new URL(String(raw || ''), location.href);
    } catch (_) {
      return null;
    }
  }

  function forbiddenUrl(value) {
    const url = absoluteUrl(value);
    if (!url || LOCAL_HOSTS.has(url.hostname)) return false;
    const text = url.href.toLowerCase();
    return forbiddenFragments.some(fragment => text.includes(fragment));
  }

  function reportBlocked(kind, value) {
    const url = absoluteUrl(value);
    const entry = {
      kind,
      url: url ? url.href : String(value || ''),
      at: new Date().toISOString()
    };
    blockedRequests.push(entry);
    console.error('PRODUCTION ACCESS BLOCKED', entry);
    try {
      const payload = JSON.stringify(entry);
      if (navigator.sendBeacon) {
        navigator.sendBeacon('/__safety/report', new Blob([payload], { type: 'application/json' }));
      }
    } catch (_) {}
    return new Error(`운영 endpoint 요청을 차단했습니다: ${entry.url}`);
  }

  const nativeFetch = window.fetch ? window.fetch.bind(window) : null;
  if (nativeFetch) {
    window.fetch = function safetyFetch(input, init) {
      if (forbiddenUrl(input)) return Promise.reject(reportBlocked('fetch', input));
      return nativeFetch(input, init);
    };
  }

  const nativeXhrOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function safetyXhrOpen(method, url) {
    if (forbiddenUrl(url)) throw reportBlocked('xhr', url);
    return nativeXhrOpen.apply(this, arguments);
  };

  if (window.WebSocket) {
    const NativeWebSocket = window.WebSocket;
    window.WebSocket = function SafetyWebSocket(url, protocols) {
      if (forbiddenUrl(url)) throw reportBlocked('websocket', url);
      return protocols === undefined ? new NativeWebSocket(url) : new NativeWebSocket(url, protocols);
    };
    window.WebSocket.prototype = NativeWebSocket.prototype;
  }

  if (window.EventSource) {
    const NativeEventSource = window.EventSource;
    window.EventSource = function SafetyEventSource(url, config) {
      if (forbiddenUrl(url)) throw reportBlocked('eventsource', url);
      return new NativeEventSource(url, config);
    };
    window.EventSource.prototype = NativeEventSource.prototype;
  }

  const nativeBeacon = navigator.sendBeacon ? navigator.sendBeacon.bind(navigator) : null;
  if (nativeBeacon) {
    navigator.sendBeacon = function safetyBeacon(url, data) {
      if (forbiddenUrl(url)) {
        reportBlocked('beacon', url);
        return false;
      }
      return nativeBeacon(url, data);
    };
  }

  if (!window.firebase || typeof window.firebase.initializeApp !== 'function') {
    throw new Error('Firebase SDK가 로드되기 전에 MANUAL SAFETY PREVIEW가 실행되었습니다.');
  }

  const safeConfig = {
    apiKey: 'demo-manual-safety-key',
    authDomain: `${PROJECT_ID}.localhost`,
    projectId: PROJECT_ID,
    storageBucket: `${PROJECT_ID}.localhost`,
    messagingSenderId: '000000000000',
    appId: '1:000000000000:web:manualsafety'
  };
  const nativeInitializeApp = window.firebase.initializeApp.bind(window.firebase);
  window.firebase.initializeApp = function safetyInitializeApp(_config, name) {
    const app = nativeInitializeApp(safeConfig, name);
    if (typeof app.auth === 'function') {
      app.auth().useEmulator(AUTH_URL, { disableWarnings: true });
    }
    if (typeof app.firestore === 'function') {
      app.firestore().useEmulator(FIRESTORE_HOST, FIRESTORE_PORT);
    }
    if (typeof app.functions === 'function') {
      app.functions('asia-northeast3').useEmulator('127.0.0.1', 5001);
    }
    return app;
  };

  if (window.firebase.messaging && typeof window.firebase.messaging.isSupported === 'function') {
    window.firebase.messaging.isSupported = () => false;
  }

  if (navigator.serviceWorker) {
    try {
      navigator.serviceWorker.register = async function disabledPreviewServiceWorker() {
        console.info('MANUAL SAFETY PREVIEW: service worker registration skipped');
        return null;
      };
    } catch (_) {}
  }

  window.__MANUAL_SAFETY__ = {
    projectId: PROJECT_ID,
    authUrl: AUTH_URL,
    firestore: `${FIRESTORE_HOST}:${FIRESTORE_PORT}`,
    functionsUrl: FUNCTIONS_URL,
    blockedRequests,
    productionAccess: 'BLOCKED'
  };

  const lines = [
    'MANUAL SAFETY PREVIEW',
    `Firebase project: ${PROJECT_ID}`,
    'Auth: 127.0.0.1:9099',
    'Firestore: 127.0.0.1:8080',
    'Functions: 127.0.0.1:5001',
    'PRODUCTION ACCESS: BLOCKED'
  ];
  console.info(lines.join('\n'));

  window.addEventListener('DOMContentLoaded', () => {
    const banner = document.createElement('div');
    banner.id = 'manual-safety-banner';
    banner.textContent = '수동검증 환경 · Emulator 전용 · 운영 접근 차단';
    banner.style.cssText = [
      'position:fixed', 'left:0', 'right:0', 'bottom:0', 'z-index:2147483647',
      'background:#123b2b', 'color:#fff', 'padding:8px 12px', 'text-align:center',
      'font:700 12px/1.3 system-ui,sans-serif', 'letter-spacing:0'
    ].join(';');
    document.body.appendChild(banner);
    document.body.style.paddingBottom = '36px';
  });
})();
