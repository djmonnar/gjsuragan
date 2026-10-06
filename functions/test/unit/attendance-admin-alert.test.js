'use strict';

// 관리 화면을 열면 확인이 필요한 근무를 팝업으로 알린다.
//  - 퇴근을 안 찍은 근무: 급여 합계에서 빠져 급여가 덜 나간다.
//  - 같은 날 일당이 두 번 잡힌 기록: 출근을 또 눌러 일당이 두 번 나갈 뻔했다.

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../../..');
const at = value => new Date(value).getTime();
const NOW = at('2026-10-02T15:00:00+09:00');

function admin(data, { dialogOpen = false } = {}) {
  const window = {};
  vm.runInNewContext(fs.readFileSync(path.join(root, 'assets/js/attendance-ui.js'), 'utf8'), { window, URLSearchParams });
  const dialogs = [];
  window.AttendanceUI.dialog = (title, body) => {
    const el = { title, body, addEventListener() {}, close() {} };
    dialogs.push(el);
    return el;
  };
  const document = {
    getElementById: () => ({ innerHTML: '', textContent: '', value: '', classList: { toggle() {}, add() {} } }),
    querySelector: selector => (selector === 'dialog[open]' && dialogOpen ? {} : null),
    querySelectorAll: () => [], addEventListener() {}, removeEventListener() {}
  };
  const source = fs.readFileSync(path.join(root, 'assets/js/attendance-admin.js'), 'utf8')
    .replace('window.AttendanceAdmin = { init, dispose };',
      'window.AttendanceAdmin = { staleOpenShifts, duplicateDailyShifts, checkAlert, set: d => { data = d; } };');
  vm.runInNewContext(source, { window, document, Intl, URLSearchParams, setTimeout, clearTimeout, navigator: {} });
  window.AttendanceAdmin.set(data);
  return { api: window.AttendanceAdmin, dialogs };
}

const employees = [
  { id: 'p1', name: '김일당', floor: 2, payType: 'perDiem' },
  { id: 'slot', name: '일일근무자 (홀)', floor: 2, payType: 'daily' },
  { id: 'h1', name: '박알바', floor: 1, payType: 'hourly' }
];
const shift = (id, employeeId, payType, inAt, outAt, extra = {}) => ({
  id, employeeId, payType, employeeName: employees.find(e => e.id === employeeId).name, floor: 2,
  workDate: new Date(at(inAt) + 9 * 3600000).toISOString().slice(0, 10),
  checkInAt: at(inAt), checkOutAt: outAt ? at(outAt) : null, amount: 100000, ...extra
});

test('전날 출근했거나 12시간이 지난 미퇴근 근무만 확인 대상이다', () => {
  const { api } = admin(null);
  const result = api.staleOpenShifts({
    serverNow: NOW,
    openShifts: [
      shift('yesterday', 'h1', 'hourly', '2026-10-01T22:00:00+09:00'),
      shift('long', 'p1', 'perDiem', '2026-10-02T02:30:00+09:00'),
      shift('working', 'h1', 'hourly', '2026-10-02T10:00:00+09:00')
    ]
  });
  assert.deepEqual(JSON.parse(JSON.stringify(result.map(s => s.id))), ['yesterday', 'long']);
});

test('일당 직원이 같은 날 두 번 찍은 기록을 묶는다', () => {
  const { api } = admin(null);
  const groups = api.duplicateDailyShifts({ shifts: [
    shift('a', 'p1', 'perDiem', '2026-10-01T09:00:00+09:00', '2026-10-01T17:00:00+09:00'),
    shift('b', 'p1', 'perDiem', '2026-10-01T17:05:00+09:00', '2026-10-01T17:06:00+09:00'),
    shift('c', 'p1', 'perDiem', '2026-10-02T09:00:00+09:00', '2026-10-02T17:00:00+09:00'),
    // 시급 직원의 점심·저녁 두 번은 정상이다.
    shift('h', 'h1', 'hourly', '2026-10-01T10:00:00+09:00', '2026-10-01T14:00:00+09:00'),
    shift('h2', 'h1', 'hourly', '2026-10-01T17:00:00+09:00', '2026-10-01T21:00:00+09:00')
  ] });
  assert.deepEqual(JSON.parse(JSON.stringify(groups.map(list => list.map(s => s.id)))), [['a', 'b']]);
});

test('일일근무자 칸은 같은 이름이거나, 이름 없이 30분 안에 붙어 찍힌 것만 묶는다', () => {
  const { api } = admin(null);
  const groups = api.duplicateDailyShifts({ shifts: [
    shift('n1', 'slot', 'daily', '2026-10-01T09:00:00+09:00', '2026-10-01T17:00:00+09:00', { workerName: '이일손' }),
    shift('n2', 'slot', 'daily', '2026-10-01T15:00:00+09:00', '2026-10-01T15:01:00+09:00', { workerName: '이일손' }),
    shift('other', 'slot', 'daily', '2026-10-01T09:10:00+09:00', '2026-10-01T17:00:00+09:00', { workerName: '박일손' }),
    shift('u1', 'slot', 'daily', '2026-10-02T09:00:00+09:00', '2026-10-02T17:00:00+09:00'),
    shift('u2', 'slot', 'daily', '2026-10-02T09:12:00+09:00', '2026-10-02T17:00:00+09:00'),
    // 오후에 온 다른 사람 (이름 미입력)
    shift('u3', 'slot', 'daily', '2026-10-02T13:00:00+09:00', '2026-10-02T21:00:00+09:00'),
    // 아직 퇴근 안 한 기록은 급여에 안 들어가니 묶지 않는다
    shift('open', 'slot', 'daily', '2026-10-02T13:05:00+09:00', null)
  ] });
  assert.deepEqual(JSON.parse(JSON.stringify(groups.map(list => list.map(s => s.id)))), [['n1', 'n2'], ['u1', 'u2']]);
});

test('화면을 열면 팝업으로 알리고, 같은 내용은 다시 띄우지 않는다', () => {
  const data = {
    serverNow: NOW, employees,
    openShifts: [shift('yesterday', 'h1', 'hourly', '2026-10-01T22:00:00+09:00', null, { floor: 1 })],
    shifts: [
      shift('a', 'p1', 'perDiem', '2026-10-01T09:00:00+09:00', '2026-10-01T17:00:00+09:00'),
      shift('b', 'p1', 'perDiem', '2026-10-01T17:05:00+09:00', '2026-10-01T17:06:00+09:00')
    ]
  };
  const { api, dialogs } = admin(data);
  api.checkAlert();
  assert.equal(dialogs.length, 1);
  assert.equal(dialogs[0].title, '확인이 필요한 근무');
  assert.match(dialogs[0].body, /퇴근을 안 찍은 근무 1건/);
  assert.match(dialogs[0].body, /박알바/);
  assert.match(dialogs[0].body, /17시간째 퇴근 기록 없음/);
  assert.match(dialogs[0].body, /같은 날 일당이 두 번 잡힌 기록 1건/);
  assert.match(dialogs[0].body, /data-popup-shift="b"/);
  assert.doesNotMatch(dialogs[0].body, /undefined|NaN/);
  api.checkAlert();
  assert.equal(dialogs.length, 1);
});

test('확인할 것이 없거나 다른 창이 열려 있으면 띄우지 않는다', () => {
  const clean = { serverNow: NOW, employees, openShifts: [], shifts: [] };
  const first = admin(clean);
  first.api.checkAlert();
  assert.equal(first.dialogs.length, 0);

  const busy = admin({ ...clean, openShifts: [shift('y', 'h1', 'hourly', '2026-10-01T22:00:00+09:00')] }, { dialogOpen: true });
  busy.api.checkAlert();
  assert.equal(busy.dialogs.length, 0);
});
