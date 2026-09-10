'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const code = fs.readFileSync(path.resolve(__dirname, '../../../assets/js/attendance-bookings.js'), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));
function setup() {
  let now = Date.parse('2026-09-10T23:59:55+09:00');
  let answer = { state: 'ready', date: '2026-09-10', storeName: '가상 매장', sourceUpdatedAt: now, fetchedAt: now,
    bookings: [{ id: 'one', active: true, name: '<script>bad</script>', time: '19:00', adults: 2, children: 1, status: 'confirmed', menuItems: [] }] };
  let error = null, requests = 0;
  const nodes = new Map(), timers = new Map(), events = new Map();
  const el = id => { if (!nodes.has(id)) nodes.set(id, { textContent: '', innerHTML: '', hidden: false }); return nodes.get(id); };
  const U = {
    date: ms => new Date(ms + 9 * 3600000).toISOString().slice(0, 10),
    time: ms => new Date(ms + 9 * 3600000).toISOString().slice(11, 16),
    esc: value => String(value).replaceAll('<', '&lt;').replaceAll('>', '&gt;'),
    request: async () => { requests++; if (error) throw error; return answer; }
  };
  const window = { AttendanceUI: U, addEventListener: (event, cb) => events.set(event, cb) };
  vm.runInNewContext(code, { window, document: { hidden: false, getElementById: el, addEventListener: (event, cb) => events.set(event, cb) },
    Date, setInterval: (callback, delay) => timers.set(delay, callback) });
  window.AttendanceBookings.connect('paired', () => now);
  return { el, timers, events, setNow: value => { now = value; }, setError: value => { error = value; },
    setAnswer: value => { answer = value; }, requests: () => requests };
}
test('automatically loads and refreshes without clicks, escapes names and includes children', async () => {
  const ui = setup(); await flush();
  assert.equal(ui.requests(), 1);
  assert.match(ui.el('bookings-summary').innerHTML, /3<small>명/);
  assert.doesNotMatch(ui.el('bookings-list').innerHTML, /<script>/);
  assert.equal(ui.timers.has(60000), false);
  await ui.timers.get(300000)();
  assert.equal(ui.requests(), 2);
});
test('network failure retains labeled same-day snapshot; revoked access clears it', async () => {
  const ui = setup(); await flush();
  ui.setError(new Error('network'));
  await ui.timers.get(300000)();
  assert.match(ui.el('bookings-summary').innerHTML, /3<small>명/);
  assert.match(ui.el('bookings-status').textContent, /마지막으로 확인한/);
  ui.setError(Object.assign(new Error('revoked'), { status: 403 }));
  await ui.timers.get(300000)();
  assert.equal(ui.el('bookings-list').innerHTML, '');
});
test('Korean midnight clears yesterday even when the refresh fails', async () => {
  const ui = setup(); await flush();
  ui.setError(new Error('network'));
  ui.setNow(Date.parse('2026-09-11T00:00:00+09:00'));
  ui.timers.get(1000)(); await flush();
  assert.equal(ui.el('bookings-list').innerHTML, '');
  assert.doesNotMatch(ui.el('bookings-summary').innerHTML, /3<small>명/);
});
