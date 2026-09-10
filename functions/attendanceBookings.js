'use strict';

const { workDate, fail } = require('./attendanceModel');
const crypto = require('node:crypto');
const SOURCE = 'https://ownervista.co.kr/api/integrations/attendance/today';
const ACTIVE = new Set(['requested', 'confirmed', 'completed']);
const STATUSES = new Set([...ACTIVE, 'cancelled', 'cancelled_by_change', 'noshowed', 'unknown']);

function normalizeFeed(input, now, date = workDate(now)) {
  if (input?.version !== 1 || input.date !== date || !['ready', 'waiting', 'partial'].includes(input.state)
    || typeof input.storeName !== 'string' || !Array.isArray(input.bookings) || input.bookings.length > 3000
    || (input.state === 'waiting' && input.bookings.some(row => row?.origin !== 'manual'))) throw new Error('Invalid reservation feed');
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
      origin: row.origin === 'manual' ? 'manual' : 'naver', seat: text(row.seat, 60),
      menuItems: row.menuItems.map(menu => ({ name: text(menu.name, 120), count: whole(menu.count) })),
      adults: whole(row.adults), children: whole(row.children), status: row.status, active: ACTIVE.has(row.status) };
  }).sort((a, b) => (a.time || '99:99').localeCompare(b.time || '99:99') || a.id.localeCompare(b.id));
  return { state: input.state, date: input.date, storeName: text(input.storeName, 100), bookings,
    menuOptions: Array.isArray(input.menuOptions) ? input.menuOptions.slice(0, 25).map(value => text(value, 60)).filter(Boolean) : [],
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

function normalizeCalendar(input, now, month) {
  if (input?.version !== 1 || input.state !== 'calendar' || input.month !== month
    || typeof input.storeName !== 'string' || !Array.isArray(input.days)) throw new Error('Invalid calendar');
  const last = new Date(`${month}-01T00:00:00Z`); last.setUTCMonth(last.getUTCMonth() + 1, 0);
  if (input.days.length !== last.getUTCDate()) throw new Error('Incomplete calendar');
  const days = input.days.map((row, i) => {
    const date = `${month}-${String(i + 1).padStart(2, '0')}`;
    if (row?.date !== date || typeof row.verified !== 'boolean') throw new Error('Invalid calendar date');
    const result = { date, verified: row.verified };
    for (const key of ['activeCount', 'headcount', 'cancelledCount', 'noshowCount']) {
      if (!Number.isSafeInteger(row[key]) || row[key] < 0 || row[key] > 1000000000) throw new Error('Invalid calendar count');
      result[key] = row[key];
    }
    return result;
  });
  const sourceUpdatedAt = input.sourceUpdatedAt === null ? null : Date.parse(input.sourceUpdatedAt);
  if (sourceUpdatedAt !== null && (!Number.isFinite(sourceUpdatedAt) || sourceUpdatedAt > now + 60000)) throw new Error('Invalid calendar sync time');
  return { state: 'calendar', month, storeName: input.storeName.slice(0, 100), days, sourceUpdatedAt,
    syncFailed: input.syncFailed === true, fetchedAt: now };
}

function createBookingReader({ token, fetchImpl = fetch, now = Date.now }) {
  let cached = null, pending = null;
  const read = async (date) => {
    const secret = token();
    if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(`${date}T00:00:00Z`)) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date)) fail('조회 날짜를 확인해 주세요.', 400);
    if (!secret) return { state: 'unconfigured', date: date || workDate(now()), serverNow: now(), bookings: [] };
    if (date) {
      const url = new URL(SOURCE.replace(/today$/, 'reservations')); url.searchParams.set('date', date);
      const response = await fetchImpl(url.href, { headers: { Authorization: `Bearer ${secret}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(8000), redirect: 'error', cache: 'no-store' });
      if ([401, 403].includes(response.status)) fail('오너비스타 예약 연결을 확인해 주세요.', 403);
      if (!response.ok) fail('예약을 불러오지 못했습니다. 잠시 후 다시 확인해 주세요.', 503);
      return normalizeFeed(await readJson(response), now(), date);
    }
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
  read.invalidate = async () => { if (pending) await pending.catch(() => {}); cached = null; };
  read.calendar = async month => {
    if (typeof month !== 'string' || !/^20\d{2}-(0[1-9]|1[0-2])$/.test(month)) fail('조회 월을 확인해 주세요.', 400);
    const secret = token();
    if (!secret) return { state: 'unconfigured', month, days: [] };
    const url = new URL(SOURCE.replace(/today$/, 'calendar')); url.searchParams.set('month', month);
    const response = await fetchImpl(url.href, { headers: { Authorization: `Bearer ${secret}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(8000), redirect: 'error', cache: 'no-store' });
    if ([401, 403].includes(response.status)) fail('오너비스타 예약 연결을 확인해 주세요.', 403);
    if (!response.ok) fail('예약 캘린더를 불러오지 못했습니다. 잠시 후 다시 확인해 주세요.', 503);
    return normalizeCalendar(await readJson(response), now(), month);
  };
  return read;
}

function bookingInput(input, now = Date.now()) {
  const text = (value, label, required = true) => {
    if (typeof value !== 'string' || value.trim().length > 60 || (required && !value.trim())) fail(`${label}을(를) 확인해 주세요.`, 400);
    return value.trim();
  };
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(input.requestId || '')) fail('새 예약 등록 창을 열어 주세요.', 400);
  const date = input.date;
  const parsed = typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T00:00:00Z`) : null;
  if (!parsed || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date
    || date < workDate(now) || date > workDate(now + 365 * 86400000)) fail('예약 날짜는 오늘부터 1년 이내로 입력해 주세요.', 400);
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(input.time || '')) fail('예약 시간을 확인해 주세요.', 400);
  if (!Number.isInteger(input.people) || input.people < 1 || input.people > 999) fail('인원은 1명부터 999명까지 입력해 주세요.', 400);
  return { requestId: input.requestId, name: text(input.name, '이름'), date, time: input.time,
    menu: text(input.menu, '메뉴'), seat: text(input.seat ?? '', '좌석', false), people: input.people };
}

function createBookingWriter({ token, fetchImpl = fetch, now = Date.now }) {
  return async (input, deviceId) => {
    const value = bookingInput(input, now());
    const secret = token();
    if (!secret) fail('오너비스타 예약 연결을 먼저 설정해 주세요.', 503);
    const response = await fetchImpl(SOURCE.replace(/today$/, 'reservations'), {
      method: 'POST', headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...value, deviceId }), signal: AbortSignal.timeout(15000), redirect: 'error', cache: 'no-store',
    });
    if ([401, 403].includes(response.status)) fail('오너비스타 예약 연결을 확인해 주세요.', 403);
    if ([400, 409].includes(response.status)) fail(response.status === 409 ? '같은 등록 요청의 내용이 달라졌습니다. 저장 결과를 확인해 주세요.' : '예약 입력 내용을 확인해 주세요.', response.status);
    if (!response.ok) fail('저장 결과를 확인하지 못했습니다. 같은 내용으로 다시 눌러 주세요. 중복 등록되지 않습니다.', 503);
    const result = await readJson(response);
    if (result.ok !== true || !/^m_[0-9a-z]{16,32}$/.test(result.bookingId) || result.useDate !== value.date) throw new Error('Invalid registration response');
    return { bookingId: result.bookingId, useDate: result.useDate };
  };
}

function createBookingsHandler({ authorizeDevice, readBookings, createBooking, verifyToken }) {
  return async (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Attendance-Device');
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.set('Cache-Control', 'no-store');
    if (req.method === 'OPTIONS') return res.status(204).send('');
    if (req.method !== 'POST') return res.status(405).json({ error: 'POST 요청만 지원합니다.' });
    try {
      // Check revocation on EVERY request, including requests served from the short cache.
      const action = req.body?.action;
      const isAdmin = ['admin.bookings', 'admin.bookings.calendar', 'admin.booking.create'].includes(action);
      let deviceId;
      if (isAdmin) {
        const token = String(req.headers.authorization || '').match(/^Bearer (.+)$/i)?.[1];
        if (!token || !verifyToken) fail('관리자 로그인이 필요합니다.', 401);
        let user;
        try { user = await verifyToken(token); } catch { fail('관리자 로그인이 만료되었습니다.', 401); }
        if (user.email !== 'sun1562@naver.com') fail('관리자만 이용할 수 있습니다.', 403);
        deviceId = crypto.createHash('sha256').update(`admin:${user.uid}`).digest('hex');
      } else deviceId = await authorizeDevice(req.headers['x-attendance-device']);
      if (['kiosk.booking.create', 'admin.booking.create'].includes(action) && createBooking) {
        const result = await createBooking(req.body, deviceId);
        await readBookings.invalidate?.();
        return res.status(200).json({ ok: true, ...result });
      }
      if (action === 'admin.bookings.calendar') return res.status(200).json({ ok: true, ...await readBookings.calendar(req.body.month) });
      if (!['kiosk.bookings', 'admin.bookings'].includes(action)) fail('지원하지 않는 예약 요청입니다.', 400);
      if (isAdmin && typeof req.body.date !== 'string') fail('조회 날짜를 확인해 주세요.', 400);
      return res.status(200).json({ ok: true, ...await readBookings(isAdmin ? req.body.date : undefined) });
    } catch (error) {
      return res.status(error.status || 503).json({ error: error.status ? error.message
        : ['kiosk.booking.create', 'admin.booking.create'].includes(req.body?.action) ? '저장 결과를 확인하지 못했습니다. 같은 내용으로 다시 눌러 주세요. 중복 등록되지 않습니다.'
          : '예약을 불러오지 못했습니다. 잠시 후 자동으로 다시 확인합니다.' });
    }
  };
}

module.exports = { normalizeFeed, normalizeCalendar, createBookingReader, createBookingsHandler, createBookingWriter, bookingInput };
