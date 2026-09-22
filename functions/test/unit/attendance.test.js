'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../../attendanceModel');
const { createAttendanceHandler } = require('../../attendance');
const at = value => new Date(value).getTime();
const base = { checkInAt: at('2026-09-01T09:00:00+09:00'), checkOutAt: at('2026-09-01T18:00:00+09:00'), breakMinutes: 60, payType: 'hourly', hourlyRate: 12000, note: '' };

test('hourly pay deducts explicit unpaid break and excludes unfinished and salaried shifts', () => {
  assert.deepEqual(M.totals(base), { workedMinutes: 540, payableMinutes: 480, earlyMinutes: 0, amount: 96000, baseAmount: 96000, extraAmount: 0, multiplierPercent: 100 });
  assert.equal(M.totals({ ...base, payType: 'salaried' }).amount, 0);
  assert.equal(M.totals({ ...base, checkOutAt: null }).amount, 0);
  assert.equal(M.totals({ ...base, voided: true }).amount, 0);
});
test('시급 직원도 예정 출근 시각보다 일찍 찍은 시간은 급여에서 뺀다', () => {
  // 7시 출근인 사람이 6시 50분에 찍고 3시에 갔다.
  const 시급근무 = { checkInAt: at('2026-09-01T06:50:00+09:00'), checkOutAt: at('2026-09-01T15:00:00+09:00'),
    breakMinutes: 0, payType: 'hourly', hourlyRate: 12000, scheduledStartMinutes: 7 * 60, note: '' };
  const t = M.totals(시급근무);
  // 찍힌 시간은 8시간 10분으로 남지만 급여는 8시간이다.
  assert.equal(t.workedMinutes, 490);
  assert.equal(t.earlyMinutes, 10);
  assert.equal(t.payableMinutes, 480);
  assert.equal(t.amount, 96000);
  // 예정 시각을 안 쓰면 찍힌 대로 준다.
  const 그대로 = M.totals({ ...시급근무, scheduledStartMinutes: 0 });
  assert.equal(그대로.payableMinutes, 490);
  assert.equal(그대로.amount, 98000);
  // 늦게 온 날은 실제 출근부터 센다. 늦은 만큼 급여가 줄어든다.
  const 지각 = M.totals({ ...시급근무, checkInAt: at('2026-09-01T07:20:00+09:00') });
  assert.equal(지각.earlyMinutes, 0);
  assert.equal(지각.payableMinutes, 460);
  // 무급 휴게시간과 같이 빠진다.
  const 휴게 = M.totals({ ...시급근무, breakMinutes: 60 });
  assert.equal(휴게.payableMinutes, 420);
  assert.equal(휴게.amount, 84000);
});

test('예정보다 한참 일찍 찍힌 시급 근무는 손대지 않는다', () => {
  // 오후 5시 출근으로 정해둔 사람이 아침 9시에 왔으면 다른 시간대 근무다.
  const 저녁예정 = { checkInAt: at('2026-09-01T09:00:00+09:00'), checkOutAt: at('2026-09-01T13:00:00+09:00'),
    breakMinutes: 0, payType: 'hourly', hourlyRate: 12000, scheduledStartMinutes: 17 * 60, note: '' };
  assert.equal(M.totals(저녁예정).earlyMinutes, 0);
  assert.equal(M.totals(저녁예정).payableMinutes, 240);
  assert.equal(M.totals(저녁예정).amount, 48000);
});

test('예정 출근 시각은 급여 유형과 상관없이 저장된다', () => {
  const person = { name: '박알바', role: '포장', payType: 'hourly', hourlyRate: 12000, active: true, breakMinutes: 0, note: '' };
  assert.deepEqual(M.employeeInput(person).scheduledStarts, []);
  assert.deepEqual(M.employeeInput({ ...person, scheduledStarts: [7 * 60] }).scheduledStarts, [420]);
  assert.deepEqual(M.employeeInput({ ...person, scheduledStarts: [17 * 60, 11 * 60] }).scheduledStarts, [660, 1020]);
  assert.deepEqual(M.employeeInput({ ...person, payType: 'salaried', monthlySalary: 3000000, scheduledStarts: [9 * 60] }).scheduledStarts, [540]);
  // 옛 화면은 시각 하나만 보낸다.
  assert.deepEqual(M.employeeInput({ ...person, scheduledStartMinutes: 7 * 60 }).scheduledStarts, [420]);
  // 개수 제한을 넘기거나 배열이 아니면 거부한다.
  assert.equal(M.MAX_SCHEDULED_STARTS, 4);
  assert.throws(() => M.employeeInput({ ...person, scheduledStarts: [60, 120, 180, 240, 300] }), new RegExp('.'));
  assert.throws(() => M.employeeInput({ ...person, scheduledStarts: '11:00' }), new RegExp('.'));
  for (const bad of [[0], [-1], [1441], [1.5]]) {
    assert.throws(() => M.employeeInput({ ...person, scheduledStarts: bad }), new RegExp('.'), JSON.stringify(bad));
  }
  for (const bad of [-1, 1441, 1.5]) {
    assert.throws(() => M.employeeInput({ ...person, scheduledStartMinutes: bad }), new RegExp('.'), String(bad));
  }
  assert.deepEqual(M.employeeInput({ ...person, scheduledStartMinutes: 0 }).scheduledStarts, []);
  const when = at('2026-09-02T00:00:00+09:00');
  const 기록 = M.shiftInput({ ...base, checkOutAt: null, scheduledStarts: [420, 1020] }, when);
  assert.deepEqual(기록.scheduledStarts, [420, 1020]);
  assert.deepEqual(M.shiftInput({ ...base, checkOutAt: null }, when).scheduledStarts, []);
});

test('elapsed minutes truncate once and money rounds per shift', () => {
  const shift = { ...base, checkOutAt: base.checkInAt + 61 * 60000 + 59000, breakMinutes: 0, hourlyRate: 10321 };
  assert.deepEqual(M.totals(shift), { workedMinutes: 61, payableMinutes: 61, earlyMinutes: 0, amount: 10493, baseAmount: 10493, extraAmount: 0, multiplierPercent: 100 });
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
  const value = M.kioskEmployee({ id: 'e', name: '직원', role: '조리', payType: 'hourly', hourlyRate: 12000, monthlySalary: 3000000, dailyPay: 100000, note: 'private', version: 1, deletedAt: null });
  // payType 은 태블릿이 사람인지 일일근무자 자리인지 구분하는 데 쓴다. 금액이 아니다.
  assert.deepEqual(Object.keys(value).sort(), ['currentShiftId', 'id', 'lastShift', 'name', 'part', 'payType', 'role']);
  // 파트를 안 고른 기존 직원은 '그 외'로 나간다. 태블릿에서 빠지면 출퇴근을 못 찍는다.
  assert.equal(value.part, 'none');
  assert.equal(M.kioskEmployee({ id: 'e', name: '직원', part: 'hall' }).part, 'hall');
  assert.equal(M.kioskEmployee({ id: 'e', name: '직원', part: '주방' }).part, 'none');
  for (const leaked of ['hourlyRate', 'monthlySalary', 'dailyPay', 'note', 'monthlyWorkHours']) {
    assert.equal(leaked in value, false, `${leaked} 가 태블릿으로 나갑니다.`);
  }
});

test('홀·주방 파트가 직원 설정에 저장된다', () => {
  const base = { name: '김수라', role: '조리', payType: 'hourly', hourlyRate: 12000, active: true, breakMinutes: 0, note: '' };
  // 안 고르면 미지정이다. 기존 직원이 여기 들어온다.
  assert.equal(M.employeeInput(base).part, 'none');
  assert.equal(M.employeeInput({ ...base, part: 'hall' }).part, 'hall');
  assert.equal(M.employeeInput({ ...base, part: 'kitchen' }).part, 'kitchen');
  // 모르는 값은 거부가 아니라 미지정이다. 급여 저장이 파트 때문에 막히면 안 된다.
  for (const bad of ['홀', 'HALL', '', null, 0, {}]) {
    assert.equal(M.employeeInput({ ...base, part: bad }).part, 'none', JSON.stringify(bad));
  }
  assert.deepEqual(M.WORK_PARTS, ['none', 'hall', 'kitchen', 'delivery']);
  assert.equal(M.employeeInput({ ...base, part: 'delivery' }).part, 'delivery');
  // 급여 유형과 무관하다. 일당 직원도 일일근무자 자리도 파트를 가진다.
  assert.equal(M.employeeInput({ ...base, payType: 'daily', dailyPay: 100000, part: 'kitchen' }).part, 'kitchen');
});

test('monthly salary is a separate positive won amount and unset legacy salary is not zero', () => {
  const employee = { name: '직원', role: '조리', payType: 'salaried', active: true, breakMinutes: 0, note: '' };
  const saved = M.employeeInput({ ...employee, hourlyRate: 999999, monthlySalary: 3000000 });
  assert.equal(saved.monthlySalary, 3000000);
  assert.equal(saved.hourlyRate, 0);
  assert.equal(M.employeeInput(employee).monthlySalary, null);
  assert.equal(M.employeeInput({ ...employee, payType: 'hourly', hourlyRate: 12000, monthlySalary: 3000000 }).monthlySalary, null);
  for (const value of [0, -1, 1.5, '3000000', null, NaN, Infinity, 100000001]) {
    assert.throws(() => M.employeeInput({ ...employee, monthlySalary: value }), { status: 400 });
  }
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
  for (const action of ['admin.list','employee.save','employee.private','employee.bank','employee.delete','shift.save','shift.delete','device.create','device.floor','device.revoke']) {
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
