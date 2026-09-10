'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../../..');
const flush = () => new Promise(resolve => setImmediate(resolve));
function page() {
  let now = Date.parse('2026-09-10T23:59:00+09:00'), error = null, deferDate = '';
  const nodes = new Map(), requests = [], timers = new Map(), delayed = [];
  const el = id => { if (!nodes.has(id)) nodes.set(id, { innerHTML: '', textContent: '', value: '', disabled: false }); return nodes.get(id); };
  class Clock extends Date { static now() { return now; } }
  const window = { addEventListener() {}, removeEventListener() {}, AttendanceSession: { getToken: async () => 'test', isActive: () => true }, AttendanceBookingForm: { clear() {}, open: value => window.form = value } };
  const document = { hidden: false, getElementById: el, querySelector: () => null, addEventListener() {}, removeEventListener() {} };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'assets/js/attendance-ui.js'), 'utf8'), { window, URLSearchParams });
  const dayFeed = date => ({ state: 'ready', date, storeName: '돌담명가', sourceUpdatedAt: now, fetchedAt: now, bookings: [{ name: date, id: 'one', time: '19:00', adults: 2, children: 1, active: true, status: 'confirmed', menuItems: [] }] });
  window.AttendanceUI.request = async (action, input) => {
    requests.push({ action, ...input }); if (error) throw error;
    if (action === 'admin.bookings.calendar') {
      const last = new Date(`${input.month}-01T00:00:00Z`); last.setUTCMonth(last.getUTCMonth() + 1, 0);
      return { state: 'calendar', month: input.month, days: Array.from({ length: last.getUTCDate() }, (_, i) => ({ date: `${input.month}-${String(i + 1).padStart(2, '0')}`, activeCount: i === 9 ? 1 : 0, headcount: i === 9 ? 3 : 0, verified: true })) };
    }
    if (input.date === deferDate) return new Promise(resolve => delayed.push(() => resolve(dayFeed(input.date))));
    return dayFeed(input.date);
  };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'assets/js/attendance-bookings-admin.js'), 'utf8'), { window, document, Date: Clock, Intl, setInterval: (fn, ms) => { timers.set(ms, fn); return ms; }, clearInterval: ms => timers.delete(ms) });
  window.AttendanceReservations.init();
  return { window, el, requests, timers, delayed, setError: value => error = value, defer: value => deferDate = value, setNow: value => now = value,
    select: value => { el('reservation-date').value = value; el('reservation-date').onchange(); } };
}
test('opens month and today with two requests, selects dates without refetching the month, handles leap months', async () => {
  const p = page(); await flush();
  assert.equal(p.requests.length, 2); assert.equal(p.el('reservation-day-heading').textContent, '오늘 예약');
  assert.equal(p.el('reservation-count').textContent, '1건 · 3명');
  assert.match(p.el('reservation-calendar-grid').innerHTML, /9월 10일 오늘, 1건, 3명/);
  p.select('2026-09-12'); await flush(); assert.equal(p.requests.length, 3);
  assert.equal(p.el('reservation-day-heading').textContent, '9월 12일 예약');
  p.select('2028-02-29'); await flush();
  assert.match(p.el('reservation-calendar-grid').innerHTML, /data-reservation-date="2028-02-29"/);
  assert.doesNotMatch(p.el('reservation-calendar-grid').innerHTML, /2028-02-30/);
  p.el('reservation-today').onclick(); await flush(); assert.equal(p.el('reservation-day-heading').textContent, '오늘 예약');
});
test('late date responses cannot replace the selected day and disposal removes sensitive content', async () => {
  const p = page(); await flush(); p.defer('2026-09-11'); p.select('2026-09-11'); await flush();
  p.select('2026-09-12'); await flush(); p.delayed[0](); await flush();
  assert.match(p.el('reservation-content').innerHTML, /2026-09-12/);
  assert.doesNotMatch(p.el('reservation-content').innerHTML, /2026-09-11/);
  p.select('2026-09-11'); await flush(); p.window.AttendanceReservations.dispose(); p.delayed[1](); await flush();
  assert.equal(p.el('reservations-root').innerHTML, ''); assert.equal(p.timers.size, 0);
});
test('failed refresh retains a labeled snapshot, new dates fail visibly, and midnight clears yesterday', async () => {
  const p = page(); await flush(); p.setError(new Error('network failed'));
  p.timers.get(300000)(); await flush();
  assert.match(p.el('reservation-error').textContent, /마지막으로 확인한 예약/);
  assert.match(p.el('reservation-calendar-error').textContent, /마지막으로 확인한 집계/);
  p.setNow(Date.parse('2026-09-11T00:01:00+09:00')); p.timers.get(300000)(); await flush();
  assert.equal(p.el('reservation-date').value, '2026-09-11');
  assert.doesNotMatch(p.el('reservation-content').innerHTML, /2026-09-10|예약이 없습니다/);
  assert.equal(p.el('reservation-count').textContent, '조회 실패');
});
