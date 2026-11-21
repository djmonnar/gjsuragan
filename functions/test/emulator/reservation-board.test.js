'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { createReservationBoardService, ITEMS, NOTES, CONFIG, SEEN } = require('../../reservationBoard');

const projectId = 'demo-gjsuragan-safety';
let app, db, service, clock, naverCalls, naver;
const requestId = n => `11111111-1111-4111-8111-${String(n).padStart(12, '0')}`;
// 오너비스타에 저장된 네이버 예약(가상). 테스트가 상태를 바꾸면 기존 연결의 날짜 목록·달력 합계가 그대로 따라 바뀐다.
const naverFeed = date => ({ state: 'ready', date, storeName: '돌담명가', sourceUpdatedAt: clock - 60000, syncFailed: false, menuOptions: ['한우 코스'],
  bookings: Object.entries(naver).filter(([, row]) => row.date === date).map(([id, row]) => ({ id, time: row.time, name: `네이버 ${id}`, itemName: '룸',
    origin: row.origin || 'naver', seat: '', menuItems: [], adults: row.people, children: 0, status: row.status, active: ['requested', 'confirmed', 'completed'].includes(row.status) })) });
const naverCalendar = month => {
  const last = new Date(`${month}-01T00:00:00Z`); last.setUTCMonth(last.getUTCMonth() + 1, 0);
  return { state: 'calendar', month, days: Array.from({ length: last.getUTCDate() }, (_, i) => {
    const date = `${month}-${String(i + 1).padStart(2, '0')}`, rows = Object.values(naver).filter(row => row.date === date);
    const active = rows.filter(row => ['confirmed', 'completed'].includes(row.status));
    return { date, verified: true, activeCount: active.length, headcount: active.reduce((sum, row) => sum + row.people, 0),
      cancelledCount: rows.filter(row => row.status === 'cancelled').length, noshowCount: 0 };
  }) };
};
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
    naver: { day: async date => { naverCalls += 1; return naverFeed(date); }, calendar: async month => naverCalendar(month) },
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
  naver = { nv1: { date: '2026-11-28', time: '18:00', people: 4, status: 'confirmed' }, nv2: { date: '2026-11-28', time: '19:00', people: 2, status: 'confirmed' } };
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
  assert.deepEqual(day.items.map(row => row.key), ['n:nv1', 'n:nv2']);
  await assert.rejects(service.save({ token, id: created.item.id, revision: 3, item, by: '직원D' }), { status: 404 });
});

test('read merges staff rows, Naver rows with staff notes and today\'s Naver cancellations, caching Naver for a minute', async () => {
  const token = await link();
  await service.watchNaverCancellations();
  naver.nv1.status = 'cancelled';
  await service.watchNaverCancellations();
  naverCalls = 0;
  await service.save({ token, item: { date: '2026-11-28', time: '18:30', name: '전화 가상', people: 20, route: '전화' }, requestId: requestId(2), by: '직원A' });
  const note = await service.saveNaverNote({ token, bookingId: 'nv1', date: '2026-11-28', room: '2층', memo: '애기의자 1', revision: 0, by: '직원A' });
  assert.equal(note.revision, 1);
  await assert.rejects(service.saveNaverNote({ token, bookingId: 'nv1', date: '2026-11-28', room: '', memo: '', revision: 0, by: '직원B' }), { status: 409 });
  const week = await service.read({ token, from: '2026-11-23', to: '2026-11-29' });
  assert.equal(week.days.length, 7);
  const day = week.days.find(row => row.date === '2026-11-28');
  assert.deepEqual(day.items.map(row => [row.key.slice(0, 2), row.route, row.active]), [['m:', '전화', true], ['n:', '네이버예약', true], ['n:', '네이버예약', false]]);
  const cancelled = day.items.find(row => row.id === 'nv1');
  assert.equal(cancelled.room, '2층');
  assert.equal(cancelled.memo, '애기의자 1');
  assert.equal(cancelled.cancelledToday, true);
  assert.equal(day.items.find(row => row.id === 'nv2').cancelledToday, false);
  assert.deepEqual(week.cancellations.items.map(row => [row.id, row.date, row.people]), [['nv1', '2026-11-28', 4]]);
  assert.equal(week.cancellations.state, 'ready');
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

test('the watcher marks a Naver cancellation only on the day it first sees it, using the existing connection', async () => {
  const token = await link();
  naver.nv3 = { date: '2026-11-30', time: '12:00', people: 3, status: 'cancelled' };
  naver.nv4 = { date: '2026-12-20', time: '18:00', people: 6, status: 'requested' };
  naver.nv5 = { date: '2026-11-30', time: '18:00', people: 5, status: 'confirmed', origin: 'manual' };
  // 처음: 지금 상태를 적기만 한다. 처음부터 취소였던 nv3 는 경고하지 않는다.
  const first = await service.watchNaverCancellations();
  assert.equal(first.cancelled, 0);
  assert.equal((await db.collection(SEEN).doc('nv1').get()).get('status'), 'confirmed');
  // 신청(nv4)만 있는 날은 달력 합계에 안 잡혀도 차례로 다시 읽는 날짜에 들어가 두 시간 안에 적힌다.
  let runs = 1;
  while (!(await db.collection(SEEN).doc('nv4').get()).exists) {
    assert.ok(runs < 12, '신청만 있는 날짜를 두 시간 안에 읽지 못했습니다.');
    clock += 10 * 60000; runs += 1;
    assert.equal((await service.watchNaverCancellations()).cancelled, 0);
  }
  assert.equal((await db.collection(SEEN).get()).size, 5);
  // 확정·신청에서 취소: 경고. 직접 등록(오너비스타) 예약 취소와 확정 → 이용완료는 경고하지 않는다.
  naver.nv1.status = 'cancelled'; naver.nv4.status = 'cancelled'; naver.nv5.status = 'cancelled'; naver.nv2.status = 'completed';
  clock = Date.parse('2026-11-21T14:50:00Z'); // 23:50 KST
  const result = await service.watchNaverCancellations();
  assert.equal(result.cancelled, 2);
  let read = await service.read({ token, from: '2026-11-21', to: '2026-11-21' });
  assert.deepEqual(read.cancellations.items.map(row => row.id).sort(), ['nv1', 'nv4']);
  assert.equal(read.cancellations.items.find(row => row.id === 'nv4').date, '2026-12-20');
  // 다음 날(KST)이 되면 같은 취소는 경고하지 않는다. 확인이 30분 넘게 멈추면 stale 로 알린다.
  clock = Date.parse('2026-11-21T15:05:00Z'); // 다음 날 00:05 KST
  read = await service.read({ token, from: '2026-11-22', to: '2026-11-22' });
  assert.deepEqual(read.cancellations.items, []);
  assert.equal(read.cancellations.state, 'ready');
  clock += 31 * 60000;
  assert.equal((await service.read({ token, from: '2026-11-22', to: '2026-11-22' })).cancellations.state, 'stale');
  // 취소됐던 예약이 다시 살아나면 표시를 지운다.
  naver.nv1.status = 'confirmed';
  await service.watchNaverCancellations();
  assert.equal((await db.collection(SEEN).doc('nv1').get()).get('cancelledAt'), null);
});

test('the watcher stops quietly when the OwnerVista connection is not set', async () => {
  const quiet = createReservationBoardService({ db, timestamp: () => FieldValue.serverTimestamp(), now: () => clock,
    naver: { day: async () => assert.fail('must not read days'), calendar: async month => ({ state: 'unconfigured', month, days: [] }) } });
  assert.deepEqual(await quiet.watchNaverCancellations(), { state: 'unconfigured', checked: 0, cancelled: 0 });
  assert.equal((await db.collection(SEEN).get()).size, 0);
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
