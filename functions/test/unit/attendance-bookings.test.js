'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeFeed, createBookingReader, createBookingsHandler, createBookingWriter, bookingInput } = require('../../attendanceBookings');
const start = Date.parse('2026-09-10T23:59:40+09:00');
const row = { id: 'one', name: '가상예약', time: '18:00', menuItems: [{ name: '메뉴', count: 2 }], adults: 2, children: 1, status: 'confirmed' };
const feed = overrides => ({ version: 1, state: 'ready', date: '2026-09-10', storeName: '테스트 매장', sourceUpdatedAt: new Date(start - 60000).toISOString(), bookings: [row], ...overrides });

test('feed keeps only tablet fields and derives attendance status independently', () => {
  const data = normalizeFeed(feed({ bookings: [{ ...row, customerPhone: 'secret', staffNote: 'private', active: false },
    { ...row, id: 'two', time: '12:00', status: 'cancelled', active: true }] }), start);
  assert.equal(data.bookings[0].id, 'two');
  assert.equal(data.bookings[0].active, false);
  assert.equal(data.bookings[1].active, true);
  assert.equal(data.bookings[1].children, 1);
  assert.doesNotMatch(JSON.stringify(data), /secret|private|customerPhone|staffNote/);
});

test('incomplete, malformed and yesterday responses cannot become valid today counts', () => {
  for (const input of [feed({ date: '2026-09-09' }), feed({ sourceUpdatedAt: null }), feed({ state: 'waiting' }),
    feed({ bookings: [row, row] }), feed({ bookings: [{ ...row, adults: -1 }] }),
    feed({ bookings: [{ ...row, time: '28:99' }] })]) assert.throws(() => normalizeFeed(input, start));
  assert.equal(normalizeFeed(feed({ bookings: [] }), start).bookings.length, 0);
});

test('reader uses fixed HTTPS endpoint, never follows redirects and shares short in-flight cache', async () => {
  let now = start, calls = 0;
  const read = createBookingReader({ token: () => 'server-only-key', now: () => now, fetchImpl: async (url, options) => {
    calls++;
    assert.equal(url, 'https://ownervista.co.kr/api/integrations/attendance/today');
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, 'Bearer server-only-key');
    return Response.json(feed({ date: now > start ? '2026-09-11' : '2026-09-10' }));
  } });
  const results = await Promise.all([read(), read(), read()]);
  assert.equal(calls, 1);
  assert.doesNotMatch(JSON.stringify(results), /server-only-key/);
  now += 21000;
  assert.equal((await read()).date, '2026-09-11');
  assert.equal(calls, 2);
});

test('expired cache does not hide source failures or cache failed responses', async () => {
  let now = start, bad = false, calls = 0;
  const read = createBookingReader({ token: () => 'key', now: () => now, fetchImpl: async () => {
    calls++; return bad ? new Response('upstream-secret', { status: 503 }) : Response.json(feed());
  } });
  await read(); now += 20000; bad = true;
  await assert.rejects(read(), { status: 503 });
  await assert.rejects(read(), { status: 503 });
  assert.equal(calls, 3);
});

test('not configured is different from no reservations and never calls upstream', async () => {
  const read = createBookingReader({ token: () => '', now: () => start, fetchImpl: async () => assert.fail('must not fetch') });
  assert.equal((await read()).state, 'unconfigured');
});

test('tablet authorization is checked before reading or returning a cached list', async () => {
  let enabled = true, reads = 0;
  const handler = createBookingsHandler({ authorizeDevice: async token => {
    if (token !== 'paired' || !enabled) { const error = new Error('revoked'); error.status = 401; throw error; }
  }, readBookings: async () => { reads++; return normalizeFeed(feed(), start); } });
  async function call(token, action = 'kiosk.bookings') {
    const res = { code: 200, set() {}, status(code) { this.code = code; return this; }, json(body) { this.body = body; }, send() {} };
    await handler({ method: 'POST', headers: { 'x-attendance-device': token }, body: { action, organizationId: 'other', date: '1990-01-01' } }, res);
    return res;
  }
  assert.equal((await call('missing')).code, 401);
  assert.equal(reads, 0);
  assert.equal((await call('paired')).body.date, '2026-09-10');
  assert.equal((await call('paired', 'employee.save')).code, 400);
  enabled = false;
  assert.equal((await call('paired')).code, 401);
  assert.equal(reads, 1);
});

test('registration sends a scoped whitelist and stable retry ID without trusting browser actor fields', async () => {
  const input = { requestId: '11111111-1111-4111-8111-111111111111', name: '가상 손님', date: '2026-09-11', time: '18:00', menu: '코스', seat: '홀 3번', people: 4, actorUid: 'spoof', alimtalkTemplateCode: 'send', deviceId: 'spoof' };
  const writer = createBookingWriter({ now: () => start, token: () => 'secret', fetchImpl: async (url, options) => {
    assert.equal(url, 'https://ownervista.co.kr/api/integrations/attendance/reservations');
    const body = JSON.parse(options.body);
    assert.equal(body.deviceId, 'server-device'); assert.equal(body.requestId, input.requestId);
    assert.equal(body.actorUid, undefined); assert.equal(body.alimtalkTemplateCode, undefined);
    assert.equal(options.redirect, 'error');
    return Response.json({ ok: true, bookingId: 'm_123456789012345678901234', useDate: input.date });
  } });
  await writer(input, 'server-device');
  assert.throws(() => bookingInput({ ...input, date: '2026-02-30' }, start), { status: 400 });
  assert.throws(() => bookingInput({ ...input, people: 0 }, start), { status: 400 });
});

test('tablet cannot read other dates through admin actions; verified admin can read and register', async () => {
  const calls = [];
  const handler = createBookingsHandler({ authorizeDevice: async () => 'device', verifyToken: async token => ({ uid: 'admin', email: token === 'owner' ? 'sun1562@naver.com' : 'other@example.invalid' }),
    readBookings: async date => { calls.push(date); return { date }; }, createBooking: async (_input, actor) => ({ actor }) });
  async function call(action, token) {
    const res = { code: 200, set() {}, status(code) { this.code = code; return this; }, json(body) { this.body = body; } };
    await handler({ method: 'POST', headers: { 'x-attendance-device': 'device', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: { action, date: '2026-09-20' } }, res);
    return res;
  }
  assert.equal((await call('admin.bookings')).code, 401);
  assert.equal((await call('admin.bookings', 'customer')).code, 403);
  assert.equal((await call('admin.bookings', 'owner')).body.date, '2026-09-20');
  assert.equal((await call('admin.booking.create', 'owner')).body.actor.length, 64);
  await call('kiosk.bookings');
  assert.deepEqual(calls, ['2026-09-20', undefined]);
});
test('calendar proxy validates a complete month, whitelists totals, and stays admin-only', async () => {
  const days = Array.from({ length: 29 }, (_, i) => ({ date: `2028-02-${String(i + 1).padStart(2, '0')}`, activeCount: 1, headcount: 3, cancelledCount: 0, noshowCount: 0, verified: false, customerName: 'private-name', totalPrice: 50000 }));
  const read = createBookingReader({ token: () => 'secret', now: () => start, fetchImpl: async (url, options) => {
    assert.equal(url, 'https://ownervista.co.kr/api/integrations/attendance/calendar?month=2028-02');
    assert.equal(options.redirect, 'error');
    return Response.json({ version: 1, state: 'calendar', month: '2028-02', storeName: '돌담명가', days, sourceUpdatedAt: null });
  } });
  const handler = createBookingsHandler({ readBookings: read, authorizeDevice: async () => 'device', verifyToken: async token => ({ uid: 'admin', email: token === 'owner' ? 'sun1562@naver.com' : 'customer@example.invalid' }) });
  async function call(token, month = '2028-02') {
    const res = { code: 200, set() {}, status(code) { this.code = code; return this; }, json(body) { this.body = body; } };
    await handler({ method: 'POST', headers: token ? { authorization: `Bearer ${token}` } : {}, body: { action: 'admin.bookings.calendar', month, organizationId: 'other' } }, res);
    return res;
  }
  assert.equal((await call()).code, 401); assert.equal((await call('customer')).code, 403);
  const response = await call('owner'); assert.equal(response.body.days.length, 29);
  assert.doesNotMatch(JSON.stringify(response.body), /secret|private-name|totalPrice|customerName/);
  assert.equal((await call('owner', '2028-13')).code, 400);
  days.pop(); assert.equal((await call('owner')).code, 503);
});
