'use strict';

// 근무마다 관리자가 적는 차감(조퇴 등).
// 관리자가 복사해서 그대로 이체하는 금액에 바로 빠지므로 경계값을 못 박아 둔다.

const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../../attendanceModel');

const at = value => new Date(value).getTime();
const when = at('2026-09-30T00:00:00+09:00');
const 시급근무 = { checkInAt: at('2026-09-17T09:00:00+09:00'), checkOutAt: at('2026-09-17T18:00:00+09:00'), breakMinutes: 60, payType: 'hourly', hourlyRate: 12000, note: '' };

test('차감은 번 돈(amount)에 섞이지 않고 따로 실린다', () => {
  const t = M.totals({ ...시급근무, deductionAmount: 10000 });
  assert.equal(t.amount, 96000);
  assert.equal(t.deductionAmount, 10000);
  // 월급 직원도 똑같이 실린다. 월급 직원은 이 칸이 아니면 조퇴를 깎을 방법이 없다.
  const 월급 = M.totals({ ...시급근무, payType: 'salaried', hourlyRate: 0, ordinaryHourlyRate: 14354, deductionAmount: 28708 });
  assert.equal(월급.amount, 0);
  assert.equal(월급.deductionAmount, 28708);
  // 일당도.
  const 일당 = M.totals({ ...시급근무, payType: 'perDiem', hourlyRate: 0, dailyPay: 100000, deductionAmount: 5000 });
  assert.equal(일당.amount, 100000);
  assert.equal(일당.deductionAmount, 5000);
});

test('미퇴근 기록에도 차감이 보이고, 삭제된 기록은 0이다', () => {
  assert.equal(M.totals({ ...시급근무, checkOutAt: null, deductionAmount: 3000 }).deductionAmount, 3000);
  assert.equal(M.totals({ ...시급근무, voided: true, deductionAmount: 3000 }).deductionAmount, 0);
});

test('이상한 값은 0 원으로 본다 — NaN 을 내보내지 않는다', () => {
  for (const value of [undefined, null, '', 'abc', -500, NaN, Infinity]) {
    assert.equal(M.totals({ ...시급근무, deductionAmount: value }).deductionAmount, 0, String(value));
  }
  assert.equal(M.totals({ ...시급근무, deductionAmount: 1234.9 }).deductionAmount, 1234);
});

test('저장할 때 차감 금액과 사유를 검증한다', () => {
  const base = { ...시급근무 };
  assert.equal(M.shiftInput(base, when).deductionAmount, 0);
  assert.equal(M.shiftInput(base, when).deductionReason, '');
  const saved = M.shiftInput({ ...base, deductionAmount: 28708, deductionReason: ' 2시간 조퇴 ' }, when);
  assert.equal(saved.deductionAmount, 28708);
  assert.equal(saved.deductionReason, '2시간 조퇴');
  // 급여 유형과 상관없이 받는다.
  assert.equal(M.shiftInput({ ...base, payType: 'salaried', deductionAmount: 1000 }, when).deductionAmount, 1000);
  for (const bad of [-1, 1.5, '1000', M.MAX_SHIFT_DEDUCTION + 1]) {
    assert.throws(() => M.shiftInput({ ...base, deductionAmount: bad }, when), String(bad));
  }
  assert.throws(() => M.shiftInput({ ...base, deductionReason: 'x'.repeat(101) }, when));
});

test('빠진 시간으로 내는 차감액은 시급 × 분 ÷ 60 이다', () => {
  const 통상시급 = M.ordinaryHourlyRate({ payType: 'salaried', monthlySalary: 3000000 });
  assert.equal(통상시급, 14354);
  assert.equal(M.deductionForMinutes(120, 통상시급), 28708);
  assert.equal(M.deductionForMinutes(30, 통상시급), 7177);
  assert.equal(M.deductionForMinutes(60, 12000), 12000);
  assert.equal(M.deductionForMinutes(0, 12000), 0);
  assert.equal(M.deductionForMinutes(-30, 12000), 0);
  assert.equal(M.deductionForMinutes(30, undefined), 0);
});
