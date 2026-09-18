'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
function load() {
  const copied = [], window = { AttendanceUI: { date: () => '2026-09-10' } };
  const context = { window, navigator: { clipboard: { writeText: async value => copied.push(value) } } };
  const source = fs.readFileSync(path.join(__dirname, '../../../assets/js/attendance-admin.js'), 'utf8')
    .replace('window.AttendanceAdmin = { init, dispose };', 'window.AttendanceAdmin = { transferAmount, copyText };');
  vm.runInNewContext(source, context);
  return { ...window.AttendanceAdmin, copied };
}
test('transfer copying uses current salary once and finished hourly amount, blocking ambiguous employment changes', () => {
  const { transferAmount } = load();
  assert.equal(transferAmount({ type: '월급', salaryType: 'salaried', monthlySalary: 3000000, amount: 0 }), 3000000);
  assert.equal(transferAmount({ type: '시급', salaryType: 'hourly', amount: 672000 }), 672000);
  assert.equal(transferAmount({ type: '시급', salaryType: 'hourly', amount: 0 }), 0);
  assert.equal(transferAmount({ type: '월급', salaryType: 'salaried', monthlySalary: null }), null);
  assert.equal(transferAmount({ type: '시급 / 월급', salaryType: 'salaried', monthlySalary: 3000000 }), null);
  assert.equal(transferAmount({ type: '시급', salaryType: 'salaried', monthlySalary: 3000000, amount: 672000 }), null);
});
test('월급 입금액은 특수일 가산을 더하고 결근 공제를 뺀다', () => {
  const { transferAmount } = load();
  const 월급 = { type: '월급', salaryType: 'salaried', monthlySalary: 3000000, amount: 0 };
  assert.equal(transferAmount({ ...월급, extraAmount: 172248, deduction: 0 }), 3172248);
  assert.equal(transferAmount({ ...월급, extraAmount: 0, deduction: 136364 }), 2863636);
  assert.equal(transferAmount({ ...월급, extraAmount: 172248, deduction: 136364 }), 3035884);
  // 공제가 월급보다 커도 음수를 복사시키지 않는다.
  assert.equal(transferAmount({ ...월급, extraAmount: 0, deduction: 9000000 }), 0);
  // 값이 빠진 행이 와도 NaN 이 아니라 월급 그대로여야 한다. 복사해서 바로 이체하는 금액이다.
  assert.equal(transferAmount(월급), 3000000);
});

test('시급 입금액에는 배율이 이미 들어 있고 결근 공제는 없다', () => {
  const { transferAmount } = load();
  assert.equal(transferAmount({ type: '시급', salaryType: 'hourly', amount: 144000, extraAmount: 48000, deduction: 0 }), 144000);
  assert.equal(transferAmount({ type: '시급', salaryType: 'hourly', amount: 96000, extraAmount: 0, deduction: 136364 }), 96000);
});

test('clipboard preserves leading zeroes and copies plain won digits', async () => {
  const { copyText, copied } = load();
  await copyText('001234567890', '계좌번호를');
  await copyText('3000000', '금액을');
  assert.deepEqual(copied, ['001234567890', '3000000']);
});
