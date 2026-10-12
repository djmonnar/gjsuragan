'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const model = require('../../attendanceModel');
const employee = { id: 'hourly1', payType: 'hourly', hourlyRate: 13000 };
const before = { id: 'shift1', employeeId: employee.id, payType: 'perDiem', dailyPay: 120000,
  checkInAt: Date.parse('2026-10-10T09:50:00+09:00'), checkOutAt: Date.parse('2026-10-10T14:00:00+09:00'),
  workDate: '2026-10-10', breakMinutes: 30, scheduledStarts: [600, 1020],
  deductionAmount: 1000, deductionReason: '지각', note: '보정 메모', overtimePay: 5000, voided: false };

test('daily to hourly recalculates recorded minutes, early arrival and special-day multiplier', () => {
  const after = model.hourlyRecalculation(before, employee);
  assert.equal(after.payType, 'hourly'); assert.equal(after.hourlyRate, 13000);
  assert.equal(after.dailyPay, 0); assert.equal(after.overtimePay, 0);
  for (const key of ['checkInAt', 'checkOutAt', 'breakMinutes', 'scheduledStarts', 'deductionAmount', 'deductionReason', 'note']) {
    assert.deepEqual(after[key], before[key]);
  }
  const total = model.totals(after);
  assert.equal(total.payableMinutes, 210); assert.equal(total.amount, 45500);
  assert.equal(total.earlyMinutes, 10); assert.equal(total.deductionAmount, 1000);
  assert.equal(model.totals(after, { multiplierPercent: 150, appliesTo: 'hourly' }).amount, 68250);
  assert.equal(model.totals(model.hourlyRecalculation({ ...before, checkOutAt: null }, employee)).amount, 0);
  assert.equal(before.payType, 'perDiem');
});

test('recalculation refuses other employee, shared slot, salaried and invalid hourly settings', () => {
  for (const shift of [{ ...before, employeeId: 'other' }, { ...before, payType: 'daily' },
    { ...before, payType: 'salaried' }, { ...before, voided: true }]) {
    assert.throws(() => model.hourlyRecalculation(shift, employee), { status: 400 });
  }
  assert.throws(() => model.hourlyRecalculation(before, { ...employee, payType: 'perDiem' }), { status: 400 });
  assert.throws(() => model.hourlyRecalculation(before, { ...employee, hourlyRate: 0 }), { status: 400 });
});
