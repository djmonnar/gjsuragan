'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeFeed, createBookingReader, createBookingsHandler } = require('../../attendanceBookings');
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
