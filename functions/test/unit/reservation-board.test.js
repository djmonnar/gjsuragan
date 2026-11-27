'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../../reservationBoardModel');
const { createReservationBoardHandler } = require('../../reservationBoard');
const { createBookingReader, normalizeCancellations } = require('../../attendanceBookings');

// 2026-11-21 12:00 KST
const now = Date.parse('2026-11-21T03:00:00Z');
const row = (id, data) => ({ id, data: { date: '2026-11-21', name: `가상 ${id}`, status: 'booked', revision: 1, ...data } });
const naverRow = extra => ({ id: 'n1', time: '18:30', name: '네이버 손님', itemName: '룸 예약', origin: 'naver', seat: '',
  menuItems: [{ name: '한우 코스', count: 4 }], adults: 3, children: 1, status: 'confirmed', active: true, ...extra });
const feed = bookings => ({ value: { state: 'ready', date: '2026-11-21', storeName: '돌담명가', bookings, sourceUpdatedAt: now - 60000, syncFailed: false } });

test('reservation input keeps the sheet columns, trims text and rejects what would break the day list', () => {
  const value = M.reservationInput({ date: '2026-11-23', time: '12:00', name: '  가상   단체 ', phone: '1234-5678', people: '34',
    menu: '차돌쌈밥', room: '2층', route: '전화', memo: '22명 6T\r\n\r\n\r\n12명 3T  ', staff: '홍길동', extra: 'ignored' }, now);
  assert.deepEqual(value, { date: '2026-11-23', time: '12:00', meal: 'lunch', name: '가상 단체', phone: '1234-5678', people: 34,
    menu: '차돌쌈밥', room: '2층', route: '전화', status: 'booked', memo: '22명 6T\n\n12명 3T', staff: '홍길동' });
  // 시간이 없으면 밤으로, 인원을 모르면 비워 둔다.
  assert.equal(M.reservationInput({ date: '2026-11-23', name: '가상' }, now).meal, 'dinner');
  assert.equal(M.reservationInput({ date: '2026-11-23', name: '가상', people: '' }, now).people, null);
  assert.equal(M.reservationInput({ date: '2026-11-23', name: '가상', time: '15:59' }, now).meal, 'lunch');
  assert.equal(M.reservationInput({ date: '2026-11-23', name: '가상', time: '16:00' }, now).meal, 'dinner');
  for (const bad of [{ name: '' }, { name: '   ' }, { date: '2026-02-30' }, { time: '24:00' }, { people: 0 }, { people: 1000 },
    { people: 2.5 }, { route: '카톡' }, { status: 'done' }, { date: '2029-01-01' }, { memo: 'x'.repeat(1001) }, { name: ['배열'] }]) {
    assert.throws(() => M.reservationInput({ date: '2026-11-23', name: '가상', ...bad }, now), { status: 400 }, JSON.stringify(bad));
  }
});

test('day view merges sheet-style and Naver rows by 낮/밤 and time, keeps cancelled rows last and out of the totals', () => {
  const manual = [
    row('a', { time: '19:00', meal: 'dinner', people: 20, route: '전화' }),
    row('b', { time: '12:30', meal: 'lunch', people: 5 }),
    row('c', { time: '17:00', meal: 'dinner', people: 8, status: 'cancelled' }),
    row('d', { time: '18:00', people: 4, deleted: true }),
    row('e', { date: '2026-11-22', time: '18:00', people: 9 }),
  ];
  const view = M.dayView('2026-11-21', manual, feed([naverRow(), naverRow({ id: 'n2', time: '12:00', status: 'cancelled', active: false, adults: 2, children: 0 })]),
    { n1: { room: '3번 룸', memo: '창가 요청', revision: 2 } }, { n2: '2026-11-21T01:00:00.000Z' });
  assert.deepEqual(view.items.map(item => item.key), ['m:b', 'n:n2', 'n:n1', 'm:a', 'm:c']);
  const naver = view.items.find(item => item.key === 'n:n1');
  assert.equal(naver.route, '네이버예약');
  assert.equal(naver.people, 4);
  assert.equal(naver.menu, '한우 코스 4');
  assert.equal(naver.room, '3번 룸');
  assert.equal(naver.memo, '창가 요청');
  assert.equal(naver.revision, 2);
  assert.equal(view.items.find(item => item.key === 'n:n2').cancelledToday, true);
  assert.deepEqual(view.summary, { teams: 3, people: 29, lunch: { teams: 1, people: 5 }, dinner: { teams: 2, people: 24 }, cancelled: 2, unknownPeople: 0 });
  assert.equal(view.naver.state, 'ready');
});

test('a failed Naver read still shows the staff reservations and says Naver is missing instead of zero', () => {
  const view = M.dayView('2026-11-21', [row('a', { people: null })], { error: '' });
  assert.deepEqual(view.items.map(item => item.key), ['m:a']);
  assert.equal(view.naver.state, 'error');
  assert.match(view.naver.error, /네이버 예약을 불러오지 못했습니다/);
  assert.equal(view.summary.unknownPeople, 1);
  assert.equal(Number.isNaN(view.summary.people), false);
});

test('a sheet row copied from Naver is flagged when the real Naver booking is on the same day', () => {
  const view = M.dayView('2026-11-21', [row('copy', { time: '12:30', name: '네이버 손님', route: '네이버', people: 5 }), row('phone', { name: '네이버 손님', route: '전화' })],
    feed([naverRow({ time: '12:30' })]));
  assert.equal(view.items.find(item => item.key === 'm:copy').maybeDuplicate, true);
  assert.equal(view.items.find(item => item.key === 'm:phone').maybeDuplicate, false);
  assert.equal(M.dayView('2026-11-21', [row('copy', { name: '네이버 손님', route: '네이버' })], feed([])).items[0].maybeDuplicate, false);
});

test('Naver guest phone from the OwnerVista date feed reaches the board card, and junk is dropped', () => {
  const { normalizeFeed } = require('../../attendanceBookings');
  const input = { version: 1, state: 'ready', date: '2026-11-21', storeName: '돌담명가', sourceUpdatedAt: new Date(now - 60000).toISOString(),
    bookings: [naverRow({ phone: '01012345678' }), naverRow({ id: 'n2', phone: '<script>' }), naverRow({ id: 'n3' })] };
  const parsed = normalizeFeed(input, now, '2026-11-21');
  assert.deepEqual(parsed.bookings.map(row => row.phone), ['01012345678', undefined, undefined]);
  const view = M.dayView('2026-11-21', [], { value: parsed });
  assert.equal(view.items.find(item => item.id === 'n1').phone, '01012345678');
  assert.equal(view.items.find(item => item.id === 'n2').phone, '');
});

test('Naver coupon names from OwnerVista reach the board card; a missing or odd coupon field never drops the day', () => {
  const { normalizeFeed, couponNames } = require('../../attendanceBookings');
  const input = { version: 1, state: 'ready', date: '2026-11-21', storeName: '돌담명가', sourceUpdatedAt: new Date(now - 60000).toISOString(),
    bookings: [naverRow({ coupons: ['네이버 리뷰 육사시미 증정 쿠폰', '  ', 7] }), naverRow({ id: 'n2' }), naverRow({ id: 'n3', coupons: 'not-a-list' })] };
  const parsed = normalizeFeed(input, now, '2026-11-21');
  assert.deepEqual(parsed.bookings.map(row => row.coupons), [['네이버 리뷰 육사시미 증정 쿠폰'], [], []]);
  assert.equal(couponNames(Array.from({ length: 9 }, (_, i) => `쿠폰 ${i}`)).length, 5);
  assert.equal(couponNames(['가'.repeat(200)])[0].length, 80);
  const view = M.dayView('2026-11-21', [], { value: parsed });
  assert.deepEqual(view.items.find(item => item.id === 'n1').coupons, ['네이버 리뷰 육사시미 증정 쿠폰']);
  assert.deepEqual(view.items.find(item => item.id === 'n2').coupons, []);
});

test('the Naver guest request from the OwnerVista date feed reaches the board card; blanks and odd values are dropped', () => {
  const { normalizeFeed } = require('../../attendanceBookings');
  const input = { version: 1, state: 'ready', date: '2026-11-21', storeName: '돌담명가', sourceUpdatedAt: new Date(now - 60000).toISOString(),
    bookings: [naverRow({ request: '  창가 자리 부탁드려요\n아기 의자 1  ' }), naverRow({ id: 'n2', request: '   ' }), naverRow({ id: 'n3', request: 7 }),
      naverRow({ id: 'n4', request: '가'.repeat(1500) }), naverRow({ id: 'n5' })] };
  const parsed = normalizeFeed(input, now, '2026-11-21');
  assert.deepEqual(parsed.bookings.map(row => row.request?.length ?? null), ['창가 자리 부탁드려요\n아기 의자 1'.length, null, null, 1000, null]);
  assert.equal(parsed.bookings[0].request, '창가 자리 부탁드려요\n아기 의자 1');
  const view = M.dayView('2026-11-21', [], { value: parsed });
  assert.equal(view.items.find(item => item.id === 'n1').request, '창가 자리 부탁드려요\n아기 의자 1');
  for (const id of ['n2', 'n3', 'n5']) assert.equal(view.items.find(item => item.id === id).request, '');
});

test('month view adds staff reservations to Naver daily totals and ignores cancelled/deleted rows', () => {
  const days = M.monthView('2026-11', [row('a', { people: 20 }), row('b', { people: 8, status: 'cancelled' }), row('c', { people: 3, deleted: true }), row('d', { date: '2026-11-30', people: null })],
    { days: [{ date: '2026-11-21', activeCount: 2, headcount: 6, verified: true }] });
  assert.equal(days.length, 30);
  assert.deepEqual(days[20], { date: '2026-11-21', teams: 3, people: 26, unknownPeople: 0, manualTeams: 1, naverTeams: 2, naverPeople: 6, naverVerified: true });
  assert.equal(days[29].teams, 1);
  assert.equal(days[29].people, 0);
  assert.equal(days[29].unknownPeople, 1);
  assert.throws(() => M.monthView('2026-13', [], null), { status: 400 });
});

test('range is at most one week so one screen never fans out to dozens of Naver reads', () => {
  assert.deepEqual(M.requireRange('2026-11-30', '2026-12-02'), ['2026-11-30', '2026-12-01', '2026-12-02']);
  assert.equal(M.requireRange('2026-11-16', '2026-11-22').length, 7);
  assert.throws(() => M.requireRange('2026-11-16', '2026-11-23'), { status: 400 });
  assert.throws(() => M.requireRange('2026-11-22', '2026-11-21'), { status: 400 });
});

// 실제 시트(직원 공용 예약장)와 같은 칸 구성. 이름과 번호는 가상이다.
const gviz = rows => `/*O_o*/\ngoogle.visualization.Query.setResponse(${JSON.stringify({ version: '0.6', status: 'ok', table: {
  cols: ['날짜', '낮/밤', '예약시간', '예약자명', '연락처', '인원', '메뉴', '예약경로', '비고', '예약상태', '룸', '예약자', ''].map((label, i) => ({ id: String(i), label })),
  rows: rows.map(c => ({ c })) } })});`;
const v = value => (value === null ? null : { v: value });
test('sheet import reads the typed gviz cells and maps 낮/밤·경로·상태 like the sheet dropdowns', () => {
  const source = M.sheetSource('https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-ab/htmlview#gid=0');
  assert.equal(source.url, 'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-ab/gviz/tq?tqx=out:json&headers=1&gid=0');
  const table = M.parseGviz(gviz([
    [v('Date(2026,10,20)'), v('밤'), v('Date(1899,11,30,19,30,0)'), v('가상 하나'), v('0000-1111'), { v: 100, f: '100' }, v('명품50진품50'), v('기타'), v('유아용의자1개 요청'), v('취소'), null, null],
    [v('Date(2026,10,23)'), v('낮'), v('Date(1899,11,30,12,0,0)'), v('가상 둘'), null, { v: 34, f: '34' }, v('차돌쌈밥'), v('전화'), v('22명6T\n12명3T'), v('예약'), v('2층'), v('직원')],
    [v('Date(2026,11,5)'), v('밤'), v('Date(1899,11,30,18,0,0)'), v('가상 셋'), v('0000 2222'), null, v('고기'), v('전화'), null, null, null, null],
    [v('Date(2026,11,9)'), v('밤'), null, null, null, null, null, null, null, null, null, null],
    [null, null, null, null, null, null, null, null, null, null, null, null],
  ]));
  const { rows, skipped } = M.sheetRows(table, source, now);
  assert.deepEqual(rows.map(item => [item.value.date, item.value.time, item.value.meal, item.value.name, item.value.people, item.value.route, item.value.status]), [
    ['2026-11-20', '19:30', 'dinner', '가상 하나', 100, '기타', 'cancelled'],
    ['2026-11-23', '12:00', 'lunch', '가상 둘', 34, '전화', 'booked'],
    ['2026-12-05', '18:00', 'dinner', '가상 셋', null, '전화', 'booked'],
  ]);
  assert.equal(rows[1].value.memo, '22명6T\n12명3T');
  assert.equal(rows[1].value.room, '2층');
  assert.equal(rows[1].value.staff, '직원');
  assert.equal(skipped.length, 1);
  assert.match(skipped[0], /예약자명/);
  // 같은 줄은 같은 문서 이름 → 다시 가져와도 두 번 생기지 않는다.
  assert.equal(M.sheetRows(table, source, now).rows[0].id, rows[0].id);
  assert.match(rows[0].id, /^s_[a-f0-9]{32}$/);
});

test('sheet import accepts copied text cells and refuses sheets it cannot read', () => {
  assert.equal(M.sheetDate({ v: null, f: ' 1월 3일 토' }, '2026-11-21'), '2027-01-03');
  assert.equal(M.sheetDate({ v: '2026. 11. 28' }, '2026-11-21'), '2026-11-28');
  assert.equal(M.sheetTime({ v: '오후 7:30' }), '19:30');
  assert.equal(M.sheetTime({ v: '12시' }), '12:00');
  assert.throws(() => M.sheetSource('https://example.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-ab'), { status: 400 });
  assert.throws(() => M.parseGviz('<html>로그인</html>'), { status: 400 });
  assert.throws(() => M.sheetRows({ cols: [{ label: '이름' }], rows: [] }, { id: 'x', gid: '0' }, now), /날짜/);
});

test('cancellation feed accepts only today-changed rows and the reader treats a missing OwnerVista route as unavailable', async () => {
  const start = Date.parse('2026-11-21T03:00:00Z');
  const body = extra => ({ version: 1, state: 'cancellations', date: '2026-11-21', bookings: [{ id: 'n1', useDate: '2026-11-28', time: '18:00',
    name: '가상', itemName: '룸', menuItems: [], adults: 2, children: 0, seat: '', cancelledAt: '2026-11-21T01:00:00.000Z', customerPhone: 'secret' }], ...extra });
  const parsed = normalizeCancellations(body(), start);
  assert.equal(parsed.bookings[0].useDate, '2026-11-28');
  assert.doesNotMatch(JSON.stringify(parsed), /secret/);
  assert.throws(() => normalizeCancellations(body({ date: '2026-11-20' }), start));
  assert.throws(() => normalizeCancellations(body({ bookings: [{ ...body().bookings[0], cancelledAt: '2026-11-20T10:00:00.000Z' }] }), start));
  let status = 404;
  const read = createBookingReader({ token: () => 'key', now: () => start, fetchImpl: async url => {
    assert.equal(url, 'https://ownervista.co.kr/api/integrations/attendance/cancellations');
    return status === 200 ? Response.json(body()) : new Response('not found', { status });
  } });
  assert.equal((await read.cancellations()).state, 'unavailable');
  status = 200;
  assert.equal((await read.cancellations()).bookings.length, 1);
  status = 503;
  await assert.rejects(read.cancellations(), { status: 503 });
  const unconfigured = createBookingReader({ token: () => '', fetchImpl: async () => assert.fail('must not fetch') });
  assert.equal((await unconfigured.cancellations()).state, 'unconfigured');
});

test('handler sends link actions to the service, keeps admin actions behind admin login and never leaks internal errors', async () => {
  const calls = [];
  const service = new Proxy({}, { get: (_target, name) => async body => {
    calls.push(name);
    if (name === 'read' && body.token === 'boom') throw new Error('internal secret detail');
    return { name };
  } });
  const logs = [];
  const handler = createReservationBoardHandler({ service, logError: (...args) => logs.push(args),
    authorizeAdmin: async req => { if (req.headers.authorization !== 'Bearer owner') throw Object.assign(new Error('no'), { status: 403 }); return { email: 'owner' }; } });
  async function call(body, headers = {}) {
    const res = { code: 200, set() {}, status(code) { this.code = code; return this; }, json(value) { this.body = value; }, send() {} };
    await handler({ method: 'POST', headers, body }, res);
    return res;
  }
  assert.equal((await call({ action: 'delete', token: 't' })).body.name, 'remove');
  assert.equal((await call({ action: 'adminShareRotate' })).code, 403);
  assert.equal((await call({ action: 'adminShareRotate' }, { authorization: 'Bearer owner' })).body.name, 'rotateShare');
  assert.equal((await call({ action: 'unknown' })).code, 400);
  const failed = await call({ action: 'read', token: 'boom', item: { name: '손님 이름', phone: '010-0000-0000' } });
  assert.equal(failed.code, 500);
  assert.doesNotMatch(JSON.stringify(failed.body), /internal secret/);
  assert.doesNotMatch(JSON.stringify(logs), /손님 이름|010-0000|boom/);
  assert.deepEqual(calls, ['remove', 'rotateShare', 'read']);
});

test('share link is the SHA-256 of a 64-hex key and anything else is refused before Firestore', () => {
  assert.match(M.shareHash('a'.repeat(64)), /^[a-f0-9]{64}$/);
  for (const bad of ['', 'A'.repeat(64), 'a'.repeat(63), null, { token: 'x' }]) assert.throws(() => M.shareHash(bad), { status: 403 });
});
