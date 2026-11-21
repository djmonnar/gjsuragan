'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { createReservationBoardService, ITEMS, NOTES, CONFIG } = require('../../reservationBoard');

const projectId = 'demo-gjsuragan-safety';
let app, db, service, clock, naverCalls, cancelledFeed;
const requestId = n => `11111111-1111-4111-8111-${String(n).padStart(12, '0')}`;
const naverFeed = date => ({ state: 'ready', date, storeName: '돌담명가', sourceUpdatedAt: clock - 60000, syncFailed: false, menuOptions: ['한우 코스'],
  bookings: date === '2026-11-28' ? [{ id: 'nv1', time: '18:00', name: '네이버 가상', itemName: '룸', origin: 'naver', seat: '', menuItems: [],
    adults: 4, children: 0, status: 'cancelled', active: false }] : [] });
const sheet = `google.visualization.Query.setResponse(${JSON.stringify({ status: 'ok', table: {
  cols: ['날짜', '낮/밤', '예약시간', '예약자명', '연락처', '인원', '메뉴', '예약경로', '비고', '예약상태', '룸', '예약자'].map(label => ({ label })),
  rows: [
    { c: [{ v: 'Date(2026,10,28)' }, { v: '밤' }, { v: 'Date(1899,11,30,17,30,0)' }, { v: '시트 가상' }, { v: '0000-1111' }, { v: 8 }, { v: '돼지' }, { v: '전화' }, { v: '콜키지' }, { v: '예약' }, null, null] },
    { c: [{ v: 'Date(2026,11,5)' }, { v: '밤' }, { v: 'Date(1899,11,30,18,0,0)' }, { v: '인원 모름' }, null, null, { v: '고기' }, { v: '전화' }, null, null, null, null] },
  ] } })});`;

test.before(() => {
  assert.ok(process.env.FIRESTORE_EMULATOR_HOST, 'Run with Firestore emulator only');
  app = initializeApp({ projectId }, `board-${Date.now()}`); db = getFirestore(app);
});
// 서비스는 오너비스타 응답을 1분 기억한다. 테스트마다 새로 만들어 앞 테스트의 기억을 끊는다.
function makeService() {
  service = createReservationBoardService({ db, timestamp: () => FieldValue.serverTimestamp(), now: () => clock,
    naver: { day: async date => { naverCalls += 1; return naverFeed(date); }, calendar: async month => ({ state: 'calendar', month, days: [{ date: '2026-11-28', activeCount: 1, headcount: 2, verified: true }] }),
      cancellations: async () => cancelledFeed },
    fetchImpl: async (url, options) => {
      assert.equal(url, 'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-ab/gviz/tq?tqx=out:json&headers=1&gid=0');
      assert.equal(options.redirect, 'error');
      return new Response(sheet);
    } });
}
test.after(async () => { await deleteApp(app); });
test.beforeEach(async () => {
  const response = await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${projectId}/databases/(default)/documents`, { method: 'DELETE' });
  assert.ok(response.ok);
  clock = Date.parse('2026-11-21T03:00:00Z'); naverCalls = 0; makeService();
  cancelledFeed = { state: 'ready', date: '2026-11-21', bookings: [{ id: 'nv1', useDate: '2026-11-28', time: '18:00', name: '네이버 가상', itemName: '룸', menuItems: [], adults: 4, children: 0, seat: '', cancelledAt: '2026-11-21T01:00:00.000Z' }] };
});
async function link() { return (await service.rotateShare({ email: 'admin@example.invalid' })).token; }

test('only the newest admin link opens the board; rotating closes the old link at once', async () => {
  await assert.rejects(service.read({ token: 'a'.repeat(64), from: '2026-11-21', to: '2026-11-21' }), { status: 403 });
  const first = await link();
  assert.equal((await service.read({ token: first, from: '2026-11-21', to: '2026-11-21' })).today, '2026-11-21');
  const second = await link();
  await assert.rejects(service.read({ token: first, from: '2026-11-21', to: '2026-11-21' }), { status: 403 });
  assert.equal((await service.read({ token: second, from: '2026-11-21', to: '2026-11-21' })).days.length, 1);
  assert.equal((await service.shareStatus()).token, second);
  assert.equal((await db.collection(CONFIG).doc('share').get()).get('hash').length, 64);
});

test('staff create, retry, edit, conflict and soft delete a reservation', async () => {
  const token = await link();
  const item = { date: '2026-11-28', time: '17:30', name: '가상 손님', people: 8, menu: '돼지', route: '전화', memo: '콜키지' };
  const created = await service.save({ token, item, requestId: requestId(1), by: '직원A' });
  const retried = await service.save({ token, item: { ...item, people: 9 }, requestId: requestId(1), by: '직원A' });
  assert.equal(retried.item.id, created.item.id);
  assert.equal(retried.item.people, 8);
  assert.equal((await db.collection(ITEMS).get()).size, 1);

  const edited = await service.save({ token, id: created.item.id, revision: 1, item: { ...item, people: 10, status: 'changed' }, by: '직원B' });
  assert.equal(edited.item.revision, 2);
  assert.equal(edited.item.statusLabel, '변경');
  await assert.rejects(service.save({ token, id: created.item.id, revision: 1, item, by: '직원C' }), err => err.status === 409 && /직원B/.test(err.message));
  await assert.rejects(service.remove({ token, id: created.item.id, revision: 1, by: '직원C' }), { status: 409 });
  await service.remove({ token, id: created.item.id, revision: 2, by: '직원C' });
  const stored = (await db.collection(ITEMS).doc(created.item.id).get()).data();
  assert.equal(stored.deleted, true);
  assert.equal(stored.deletedBy, '직원C');
  const day = (await service.read({ token, from: '2026-11-28', to: '2026-11-28' })).days[0];
  assert.deepEqual(day.items.map(row => row.key), ['n:nv1']);
  await assert.rejects(service.save({ token, id: created.item.id, revision: 3, item, by: '직원D' }), { status: 404 });
});

test('read merges staff rows, Naver rows with staff notes and today\'s Naver cancellations, caching Naver for a minute', async () => {
  const token = await link();
  await service.save({ token, item: { date: '2026-11-28', time: '18:30', name: '전화 가상', people: 20, route: '전화' }, requestId: requestId(2), by: '직원A' });
  const note = await service.saveNaverNote({ token, bookingId: 'nv1', date: '2026-11-28', room: '2층', memo: '애기의자 1', revision: 0, by: '직원A' });
  assert.equal(note.revision, 1);
  await assert.rejects(service.saveNaverNote({ token, bookingId: 'nv1', date: '2026-11-28', room: '', memo: '', revision: 0, by: '직원B' }), { status: 409 });
  const week = await service.read({ token, from: '2026-11-23', to: '2026-11-29' });
  assert.equal(week.days.length, 7);
  const day = week.days.find(row => row.date === '2026-11-28');
  assert.deepEqual(day.items.map(row => [row.key, row.route, row.active]), [['m:' + day.items[0].id, '전화', true], ['n:nv1', '네이버예약', false]]);
  assert.equal(day.items[1].room, '2층');
  assert.equal(day.items[1].memo, '애기의자 1');
  assert.equal(day.items[1].cancelledToday, true);
  assert.equal(week.cancellations.items[0].date, '2026-11-28');
  assert.equal(naverCalls, 7);
  await service.read({ token, from: '2026-11-28', to: '2026-11-28' });
  assert.equal(naverCalls, 7);
  clock += 61000;
  await service.read({ token, from: '2026-11-28', to: '2026-11-28' });
  assert.equal(naverCalls, 8);
  const month = await service.month({ token, month: '2026-11' });
  assert.deepEqual(month.days.find(row => row.date === '2026-11-28'), { date: '2026-11-28', teams: 2, people: 22, unknownPeople: 0, manualTeams: 1, naverTeams: 1, naverPeople: 2, naverVerified: true });
  assert.equal((await db.collection(NOTES).doc('nv1').get()).get('updatedBy'), '직원A');
});

test('notices can be added, edited, pinned and removed by anyone holding the link', async () => {
  const token = await link();
  const first = await service.saveNotice({ token, text: '12월 휴무 안내', author: '사장', requestId: requestId(3) });
  await service.saveNotice({ token, text: '단체 예약은 2층', author: '실장', pinned: true, requestId: requestId(4) });
  let read = await service.read({ token, from: '2026-11-21', to: '2026-11-21' });
  assert.deepEqual(read.notices.map(n => n.text), ['단체 예약은 2층', '12월 휴무 안내']);
  await service.saveNotice({ token, id: first.id, revision: 1, text: '12월 25일 휴무', author: '사장' });
  await assert.rejects(service.saveNotice({ token, id: first.id, revision: 1, text: '다른 내용', author: '실장' }), { status: 409 });
  await service.deleteNotice({ token, id: first.id });
  read = await service.read({ token, from: '2026-11-21', to: '2026-11-21' });
  assert.deepEqual(read.notices.map(n => n.text), ['단체 예약은 2층']);
});

test('sheet import previews, creates once and skips rows already imported', async () => {
  const url = 'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-ab/edit#gid=0';
  const preview = await service.importSheet({ url, dryRun: true }, { email: 'admin@example.invalid' });
  assert.equal(preview.total, 2); assert.equal(preview.created, 0); assert.equal(preview.newCount, 2);
  assert.equal((await db.collection(ITEMS).get()).size, 0);
  assert.equal(preview.warnings.length, 1);
  const imported = await service.importSheet({ url }, { email: 'admin@example.invalid' });
  assert.equal(imported.created, 2);
  const again = await service.importSheet({ url }, { email: 'admin@example.invalid' });
  assert.equal(again.created, 0); assert.equal(again.existing, 2);
  const token = await link();
  const day = (await service.read({ token, from: '2026-11-28', to: '2026-11-28' })).days[0];
  const row = day.items.find(item => item.kind === 'manual');
  assert.equal(row.name, '시트 가상'); assert.equal(row.source, 'sheet'); assert.equal(row.memo, '콜키지');
  // 가져온 예약도 직원이 그대로 고칠 수 있다.
  const edited = await service.save({ token, id: row.id, revision: 1, item: { ...row, people: 9 }, by: '직원A' });
  assert.equal(edited.item.people, 9);
  assert.equal((await service.importSheet({ url }, { email: 'admin@example.invalid' })).created, 0);
  assert.equal((await db.collection(ITEMS).doc(row.id).get()).get('people'), 9);
});
