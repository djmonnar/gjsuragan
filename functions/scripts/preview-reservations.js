'use strict';

// 직원 예약장(reservations.html) 로컬 미리보기. Firestore Emulator 와 가상 네이버 예약만 쓴다.
// 운영 Firestore·오너비스타에는 연결하지 않는다.
//   firebase emulators:exec --only firestore --project demo-gjsuragan-board-preview "node scripts/preview-reservations.js"
// 또는 에뮬레이터를 따로 띄운 뒤 FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node scripts/preview-reservations.js
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { createReservationBoardService, createReservationBoardHandler } = require('../reservationBoard');
const { kstDate, addDays } = require('../reservationBoardModel');

if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '')) throw new Error('Set FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 first.');
const root = path.resolve(__dirname, '../..');
const port = Number(process.env.BOARD_PREVIEW_PORT || 8766);
const db = getFirestore(initializeApp({ projectId: 'demo-gjsuragan-board-preview' }, 'board-preview'));
const today = () => kstDate(Date.now());
const sample = date => {
  const offset = Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today()}T00:00:00Z`)) / 86400000);
  const rows = {
    0: [{ id: 'nv-a', time: '12:00', name: '가상 네이버', itemName: '점심 룸', menuItems: [{ name: '한우 정식', count: 4 }], adults: 4, children: 0, status: 'confirmed' },
      { id: 'nv-b', time: '18:30', name: '가상 가족', itemName: '저녁 룸', menuItems: [{ name: '돼지갈비', count: 5 }], adults: 4, children: 1, status: 'requested' },
      { id: 'nv-c', time: '19:00', name: '가상 취소', itemName: '저녁 룸', menuItems: [], adults: 3, children: 0, status: 'cancelled' }],
    3: [{ id: 'nv-d', time: '18:00', name: '가상 다음주', itemName: '저녁 룸', menuItems: [{ name: '소(명품)', count: 6 }], adults: 6, children: 0, status: 'cancelled' }],
  }[offset] || [];
  return rows.map(row => ({ origin: 'naver', seat: '', active: ['requested', 'confirmed', 'completed'].includes(row.status), ...row }));
};
const service = createReservationBoardService({ db, timestamp: () => FieldValue.serverTimestamp(), naver: {
  day: async date => ({ state: 'ready', date, storeName: '돌담명가', sourceUpdatedAt: Date.now() - 120000, syncFailed: false, menuOptions: ['한우 정식', '돼지갈비'], bookings: sample(date) }),
  calendar: async month => {
    const last = new Date(`${month}-01T00:00:00Z`); last.setUTCMonth(last.getUTCMonth() + 1, 0);
    return { state: 'calendar', month, days: Array.from({ length: last.getUTCDate() }, (_, i) => {
      const date = `${month}-${String(i + 1).padStart(2, '0')}`, rows = sample(date).filter(row => row.active);
      return { date, activeCount: rows.length, headcount: rows.reduce((sum, row) => sum + row.adults + row.children, 0), verified: true };
    }) };
  },
  cancellations: async () => ({ state: 'ready', date: today(), bookings: [
    { id: 'nv-c', useDate: today(), time: '19:00', name: '가상 취소', itemName: '저녁 룸', menuItems: [], adults: 3, children: 0, seat: '', cancelledAt: new Date(Date.now() - 3600000).toISOString() },
    { id: 'nv-d', useDate: addDays(today(), 3), time: '18:00', name: '가상 다음주', itemName: '저녁 룸', menuItems: [{ name: '소(명품)', count: 6 }], adults: 6, children: 0, seat: '', cancelledAt: new Date(Date.now() - 600000).toISOString() }] }),
} });
const handler = createReservationBoardHandler({ service, authorizeAdmin: async () => ({ email: 'local-preview@example.invalid' }) });

async function seed() {
  const { token } = await service.rotateShare({ email: 'local-preview@example.invalid' });
  const add = (n, item) => service.save({ token, item, requestId: `22222222-2222-4222-8222-${String(n).padStart(12, '0')}`, by: '가상 직원' });
  await add(1, { date: today(), time: '12:30', name: '가상 단체', phone: '0000-1111', people: 34, menu: '차돌쌈밥', room: '2층', route: '전화', memo: '22명 6T(의원)\n12명 3T(직원)', staff: '가상 직원' });
  await add(2, { date: today(), time: '18:00', name: '가상 병원', phone: '0000 2222', people: 20, menu: '돼지+식사권', room: '7-9R', route: '전화' });
  await add(3, { date: today(), time: '19:30', name: '가상 취소 손님', people: 100, menu: '명품50진품50', route: '기타', status: 'cancelled', memo: '유아용의자1개 요청' });
  await add(4, { date: addDays(today(), 1), time: '17:40', name: '가상 회사', people: 35, menu: '소(명품)', room: '2층', route: '전화', memo: '육회서비스' });
  await add(5, { date: addDays(today(), 2), time: '18:00', name: '가상 모임', menu: '고기', route: '전화' });
  await service.saveNotice({ token, text: '단체 예약(20명 이상)은 2층으로 받아 주세요.', author: '사장', pinned: true, requestId: '33333333-3333-4333-8333-000000000001' });
  await service.saveNotice({ token, text: '12월 25일은 저녁 영업만 합니다.', author: '실장', requestId: '33333333-3333-4333-8333-000000000002' });
  return token;
}

const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json' };
seed().then(token => {
  http.createServer((req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    if (url.pathname === '/api/reservationBoard') {
      let raw = '';
      req.on('data', chunk => { raw += chunk; });
      req.on('end', () => {
        const shim = { statusCode: 200, set: (key, value) => res.setHeader(key, value), status(code) { this.statusCode = code; return this; },
          json(body) { res.writeHead(this.statusCode, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); }, send(body) { res.writeHead(this.statusCode); res.end(body); } };
        let body = {};
        try { body = raw ? JSON.parse(raw) : {}; } catch (_) { /* empty */ }
        handler({ method: req.method, headers: req.headers, body }, shim);
      });
      return;
    }
    const file = path.resolve(root, `.${decodeURIComponent(url.pathname === '/' ? '/reservations.html' : url.pathname)}`);
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('not found'); return; }
    let content = fs.readFileSync(file);
    if (file.endsWith('reservations.html')) content = Buffer.from(String(content).replace(/data-api="[^"]+"/, 'data-api="/api/reservationBoard"'));
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(content);
  }).listen(port, '127.0.0.1', () => console.log(`Reservation board preview: http://127.0.0.1:${port}/reservations.html#token=${token}`));
});
