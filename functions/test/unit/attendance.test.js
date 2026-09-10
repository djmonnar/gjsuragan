'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../../attendanceModel');
const { createAttendanceHandler } = require('../../attendance');
const at = value => new Date(value).getTime();
const base = { checkInAt: at('2026-09-01T09:00:00+09:00'), checkOutAt: at('2026-09-01T18:00:00+09:00'), breakMinutes: 60, payType: 'hourly', hourlyRate: 12000, note: '' };

test('hourly pay deducts explicit unpaid break and excludes unfinished and salaried shifts', () => {
  assert.deepEqual(M.totals(base), { workedMinutes: 540, payableMinutes: 480, amount: 96000 });
  assert.equal(M.totals({ ...base, payType: 'salaried' }).amount, 0);
  assert.equal(M.totals({ ...base, checkOutAt: null }).amount, 0);
  assert.equal(M.totals({ ...base, voided: true }).amount, 0);
});
test('elapsed minutes truncate once and money rounds per shift', () => {
  const shift = { ...base, checkOutAt: base.checkInAt + 61 * 60000 + 59000, breakMinutes: 0, hourlyRate: 10321 };
  assert.deepEqual(M.totals(shift), { workedMinutes: 61, payableMinutes: 61, amount: 10493 });
});
test('KST date, leap February and December rollover do not depend on host timezone', () => {
  assert.equal(M.workDate(at('2026-08-31T15:00:00Z')), '2026-09-01');
  assert.deepEqual(M.monthRange('2028-02'), { start: '2028-02-01', end: '2028-03-01' });
  assert.deepEqual(M.monthRange('2026-12'), { start: '2026-12-01', end: '2027-01-01' });
  assert.throws(() => M.monthRange('2026-13'));
});
test('overnight shift belongs to clock-in date', () => {
  const shift = M.shiftInput({ ...base, checkInAt: at('2026-08-31T22:00:00+09:00'), checkOutAt: at('2026-09-01T06:00:00+09:00') }, Date.UTC(2026, 8, 2));
  assert.equal(shift.workDate, '2026-08-31');
  assert.equal(M.totals(shift).amount, 84000);
});
test('invalid money, time, break and ids are rejected', () => {
  for (const patch of [{ hourlyRate: -1 }, { hourlyRate: 0 }, { hourlyRate: NaN }, { checkOutAt: base.checkInAt }, { checkInAt: Infinity }, { breakMinutes: 541 }, { checkOutAt: base.checkInAt + 37 * 3600000 }]) {
    assert.throws(() => M.shiftInput({ ...base, ...patch }, Date.UTC(2026, 9, 1)));
  }
  assert.throws(() => M.shiftInput(base, base.checkOutAt - 1));
  assert.throws(() => M.id('../employees'));
});
test('overlap rejects open or intersecting shifts but allows adjacent shifts', () => {
  assert.equal(M.overlaps(base, { ...base, checkOutAt: null }), true);
  assert.equal(M.overlaps(base, { ...base, checkInAt: base.checkOutAt, checkOutAt: null }), false);
  assert.equal(M.overlaps(base, { ...base, voided: true }), false);
});
test('kiosk employee serialization omits wage, notes and employment history', () => {
  const value = M.kioskEmployee({ id: 'e', name: '직원', role: '조리', hourlyRate: 12000, note: 'private', version: 1, deletedAt: null });
  assert.deepEqual(Object.keys(value).sort(), ['currentShiftId', 'id', 'lastShift', 'name', 'role']);
});

test('floor accepts only first and second floors, with legacy records on first floor', () => {
  assert.equal(M.floor(), 1);
  assert.equal(M.floor(1), 1);
  assert.equal(M.floor(2), 2);
  for (const value of [0, 3, '2', null, NaN, 1.5]) assert.throws(() => M.floor(value));
});

async function call(action, options = {}) {
  const calls = [];
  const service = new Proxy({}, { get: (_, name) => async (...args) => { calls.push([name, ...args]); return {}; } });
  const handler = createAttendanceHandler({ service, verifyToken: async () => {
    if (options.invalid) throw new Error('token');
    return { uid: 'admin', email: options.email || 'sun1562@naver.com' };
  } });
  const res = { statusCode: 200, set() {}, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; }, send() {} };
  await handler({ method: options.method || 'POST', headers: options.headers || {}, body: { action, month: '2026-09' } }, res);
  return { res, calls };
}
test('all admin actions require a verified allowlisted Firebase account', async () => {
  for (const action of ['admin.list','employee.save','employee.delete','shift.save','shift.delete','device.create','device.floor','device.revoke']) {
    const missing = await call(action);
    assert.equal(missing.res.statusCode, 401); assert.equal(missing.calls.length, 0);
    const customer = await call(action, { headers: { authorization: 'Bearer customer' }, email: 'customer@example.invalid' });
    assert.equal(customer.res.statusCode, 403); assert.equal(customer.calls.length, 0);
  }
  assert.equal((await call('admin.list', { headers: { authorization: 'Bearer expired' }, invalid: true })).res.statusCode, 401);
  assert.equal((await call('admin.list', { headers: { authorization: 'Bearer admin' } })).calls[0][0], 'listAdmin');
});
test('device credentials only reach kiosk service methods', async () => {
  const result = await call('kiosk.list', { headers: { 'x-attendance-device': 'device' } });
  assert.deepEqual(result.calls, [['listKiosk', 'device']]);
  const admin = await call('employee.save', { headers: { 'x-attendance-device': 'device' } });
  assert.equal(admin.res.statusCode, 401);
  assert.equal((await call('kiosk.list', { method: 'GET' })).res.statusCode, 405);
});
