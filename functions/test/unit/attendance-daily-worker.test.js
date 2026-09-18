'use strict';

// 일일근무자는 사람이 아니라 '자리'다. 한 자리를 여러 사람이 같은 날 같이 쓴다.
// 기록이 섞이거나 한 줄로 합쳐지면 누구에게 얼마를 줄지 알 수 없게 된다.

const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../../attendanceModel');

const at = value => new Date(value).getTime();
const 일당근무 = {
  checkInAt: at('2026-09-17T09:00:00+09:00'), checkOutAt: at('2026-09-17T18:00:00+09:00'),
  breakMinutes: 60, payType: 'daily', hourlyRate: 0, dailyPay: 100000, note: ''
};

test('일당은 시간과 상관없이 하루치다', () => {
  assert.equal(M.totals(일당근무).amount, 100000);
  // 두 시간만 일해도 하루치. 열두 시간 일해도 하루치.
  assert.equal(M.totals({ ...일당근무, checkOutAt: at('2026-09-17T11:00:00+09:00') }).amount, 100000);
  assert.equal(M.totals({ ...일당근무, checkOutAt: at('2026-09-17T21:00:00+09:00') }).amount, 100000);
});

test('특수일 배율은 일당에 붙지 않는다', () => {
  // 명절에 더 드릴 금액은 그 기록의 일당을 직접 고쳐서 정한다.
  const 설날 = { appliesTo: 'both', multiplierPercent: 150 };
  assert.equal(M.totals(일당근무, 설날).amount, 100000);
  assert.equal(M.totals(일당근무, 설날).extraAmount, 0);
  assert.equal(M.shiftMultiplierPercent(설날, 'daily'), M.BASE_PERCENT);
});

test('미퇴근·삭제된 일일근무 기록은 0원이다', () => {
  assert.equal(M.totals({ ...일당근무, checkOutAt: null }).amount, 0);
  assert.equal(M.totals({ ...일당근무, voided: true }).amount, 0);
});

test('일당이 없거나 이상하면 0원으로 떨어진다', () => {
  // 급여 화면에 NaN 이 뜨면 안 된다. 관리자가 복사해서 그대로 이체하는 금액이다.
  for (const bad of [undefined, null, 0, -5000, 'abc', NaN]) {
    const amount = M.totals({ ...일당근무, dailyPay: bad }).amount;
    assert.ok(Number.isSafeInteger(amount) && amount >= 0, `dailyPay=${bad} → ${amount}`);
  }
});

test('자리 등록은 일당만 받고 시급·월급 칸은 비운다', () => {
  const 자리 = M.employeeInput({ name: '일일근무자 (홀)', role: '홀', floor: 2, payType: 'daily', dailyPay: 100000, breakMinutes: 60, active: true, note: '' });
  assert.equal(자리.payType, 'daily');
  assert.equal(자리.dailyPay, 100000);
  assert.equal(자리.hourlyRate, 0);
  assert.equal(자리.monthlySalary, null);
  assert.equal(자리.monthlyWorkHours, 0);
  assert.equal(M.isSharedSlot(자리), true);
  assert.equal(M.isSharedSlot({ payType: 'hourly' }), false);
  assert.equal(M.isSharedSlot({ payType: 'salaried' }), false);
});

test('일당 없이 자리를 만들 수 없다', () => {
  const base = { name: '일일근무자', role: '', floor: 2, payType: 'daily', breakMinutes: 0, active: true, note: '' };
  for (const bad of [undefined, 0, -1, 10000001, 1.5, 'abc']) {
    assert.throws(() => M.employeeInput({ ...base, dailyPay: bad }), new RegExp('.'), String(bad));
  }
  assert.equal(M.employeeInput({ ...base, dailyPay: 1 }).dailyPay, 1);
});

test('기록마다 일당과 일한 사람을 따로 들고 있다', () => {
  // 같은 자리에 온 두 사람에게 다른 금액을 줄 수 있어야 한다.
  const 저장 = M.shiftInput({ ...일당근무, dailyPay: 120000, workerName: '김일손', workerNote: '국민 123-456' }, at('2026-09-18T00:00:00+09:00'));
  assert.equal(저장.dailyPay, 120000);
  assert.equal(저장.workerName, '김일손');
  assert.equal(저장.workerNote, '국민 123-456');
  // 이름은 나중에 적는다. 비어 있어도 저장돼야 한다.
  assert.equal(M.shiftInput(일당근무, at('2026-09-18T00:00:00+09:00')).workerName, '');
});

test('시급·월급 기록에는 일당과 이름이 붙지 않는다', () => {
  const 시급 = M.shiftInput({ ...일당근무, payType: 'hourly', hourlyRate: 12000, dailyPay: 100000, workerName: '김일손' }, at('2026-09-18T00:00:00+09:00'));
  assert.equal(시급.dailyPay, 0);
  assert.equal(시급.workerName, '');
});

test('알 수 없는 급여 유형은 거부한다', () => {
  assert.deepEqual([...M.PAY_TYPES].sort(), ['daily', 'hourly', 'salaried']);
  assert.throws(() => M.employeeInput({ name: 'x', role: '', floor: 2, payType: 'weekly', breakMinutes: 0, active: true, note: '' }));
});
