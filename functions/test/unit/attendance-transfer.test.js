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
test('clipboard preserves leading zeroes and copies plain won digits', async () => {
  const { copyText, copied } = load();
  await copyText('001234567890', '계좌번호를');
  await copyText('3000000', '금액을');
  assert.deepEqual(copied, ['001234567890', '3000000']);
});
