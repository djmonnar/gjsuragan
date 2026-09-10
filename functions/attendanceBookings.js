'use strict';

const { workDate, fail } = require('./attendanceModel');
const SOURCE = 'https://ownervista.co.kr/api/integrations/attendance/today';
const ACTIVE = new Set(['requested', 'confirmed', 'completed']);
const STATUSES = new Set([...ACTIVE, 'cancelled', 'cancelled_by_change', 'noshowed', 'unknown']);

function normalizeFeed(input, now) {
  if (input?.version !== 1 || input.date !== workDate(now) || !['ready', 'waiting'].includes(input.state)
    || typeof input.storeName !== 'string' || !Array.isArray(input.bookings) || input.bookings.length > 3000
    || (input.state === 'waiting' && input.bookings.length)) throw new Error('Invalid reservation feed');
  const text = (value, max) => typeof value === 'string' ? value.slice(0, max) : '';
  const whole = value => {
    if (!Number.isSafeInteger(value) || value < 0 || value > 10000) throw new Error('Invalid reservation count');
    return value;
  };
  const sourceTime = input.sourceUpdatedAt === null ? null : Date.parse(input.sourceUpdatedAt);
  if (sourceTime !== null && (!Number.isFinite(sourceTime) || sourceTime > now + 60000)) throw new Error('Invalid sync date');
  if (input.state === 'ready' && sourceTime === null) throw new Error('Missing sync date');
  const ids = new Set();
  const bookings = input.bookings.map(row => {
    if (!row || typeof row.id !== 'string' || !row.id || row.id.length > 128 || ids.has(row.id)
      || !STATUSES.has(row.status) || (row.time !== null && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(row.time))
      || !Array.isArray(row.menuItems) || row.menuItems.length > 20) throw new Error('Invalid booking');
    ids.add(row.id);
    return { id: row.id, time: row.time, name: text(row.name, 80), itemName: text(row.itemName, 200),
      menuItems: row.menuItems.map(menu => ({ name: text(menu.name, 120), count: whole(menu.count) })),
      adults: whole(row.adults), children: whole(row.children), status: row.status, active: ACTIVE.has(row.status) };
  }).sort((a, b) => (a.time || '99:99').localeCompare(b.time || '99:99') || a.id.localeCompare(b.id));
  return { state: input.state, date: input.date, storeName: text(input.storeName, 100), bookings,
    sourceUpdatedAt: sourceTime, syncFailed: input.syncFailed === true, fetchedAt: now, serverNow: now };
}

async function readJson(response) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Missing response body');
  const chunks = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 2 * 1024 * 1024) throw new Error('Reservation response too large');
      chunks.push(Buffer.from(value));
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } finally { await reader.cancel().catch(() => {}); }
}

function createBookingReader({ token, fetchImpl = fetch, now = Date.now }) {
  let cached = null, pending = null;
  return async () => {
    const secret = token();
    if (!secret) return { state: 'unconfigured', date: workDate(now()), serverNow: now(), bookings: [] };
    if (cached && cached.date === workDate(now()) && now() - cached.fetchedAt < 20000) return { ...cached, serverNow: now() };
    if (!pending) pending = (async () => {
      const response = await fetchImpl(SOURCE, {
        headers: { Authorization: `Bearer ${secret}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(8000), redirect: 'error', cache: 'no-store',
      });
      if ([401, 403].includes(response.status)) fail('오너비스타 예약 연결이 해제되었거나 연결키가 변경되었습니다.', 403);
      if (!response.ok) fail('오너비스타 예약 연결을 확인하지 못했습니다. 잠시 후 자동으로 다시 확인합니다.', 503);
      cached = normalizeFeed(await readJson(response), now());
      return cached;
    })().finally(() => { pending = null; });
    return pending;
  };
}

function createBookingsHandler({ authorizeDevice, readBookings }) {
  return async (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Headers', 'Content-Type, X-Attendance-Device');
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.set('Cache-Control', 'no-store');
    if (req.method === 'OPTIONS') return res.status(204).send('');
    if (req.method !== 'POST') return res.status(405).json({ error: 'POST 요청만 지원합니다.' });
    try {
      // Check revocation on EVERY request, including requests served from the short cache.
      await authorizeDevice(req.headers['x-attendance-device']);
      if (req.body?.action !== 'kiosk.bookings') fail('오늘 예약 조회만 지원합니다.', 400);
      return res.status(200).json({ ok: true, ...await readBookings() });
    } catch (error) {
      return res.status(error.status || 503).json({ error: error.status ? error.message
        : '예약을 불러오지 못했습니다. 잠시 후 자동으로 다시 확인합니다.' });
    }
  };
}

module.exports = { normalizeFeed, createBookingReader, createBookingsHandler };
