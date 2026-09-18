'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '../../..');
test('store names preserve the confirmed legacy assignments and tablet links', () => {
  const window = {};
  vm.runInNewContext(fs.readFileSync(path.join(root, 'assets/js/attendance-ui.js'), 'utf8'), { window, URLSearchParams });
  const U = window.AttendanceUI;
  assert.equal(U.storeName(1), '돌담명가');
  assert.equal(U.storeName(2), '궁중수라간');
  assert.equal(U.storeName(undefined), '돌담명가');
  assert.equal(U.setupStore('?store=doldam'), 1);
  assert.equal(U.setupStore('?store=suragan'), 2);
  assert.equal(U.setupStore('?floor=1'), 1);
  assert.equal(U.setupStore('?floor=2'), 2);
  assert.equal(U.setupStore('?store=doldam&floor=2'), 1);
  assert.equal(U.setupStore(''), 2);
  assert.equal(U.deviceName('1층 출퇴근 태블릿', 1), '돌담명가 출퇴근 태블릿');
  assert.equal(U.deviceName('2층 출퇴근 태블릿', 2), '궁중수라간 출퇴근 태블릿');
  assert.equal(U.deviceName('카운터 태블릿', 1), '카운터 태블릿');
});
function shell() {
  const calls = [], events = {}, elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, { value: '', hidden: false, textContent: '', dataset: {}, setAttribute() {}, removeAttribute() {} });
    return elements.get(id);
  };
  let listener;
  const auth = { currentUser: null, onAuthStateChanged: fn => { listener = fn; }, signOut: async () => { auth.currentUser = null; listener(null); } };
  const document = { getElementById: element, querySelectorAll: () => [] };
  const window = { AttendanceAdmin: { init: () => calls.push('attendance.init'), dispose: () => calls.push('attendance.dispose') }, AttendanceReservations: { init: () => calls.push('reservations.init'), dispose: () => calls.push('reservations.dispose') }, StaffManual: { init: () => calls.push('manual.init'), dispose: () => calls.push('manual.dispose') }, addEventListener: (name, fn) => events[name] = fn };
  const location = { hash: '#attendance' };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'assets/js/staff-admin.js'), 'utf8'), { window, document, location, navigator: {}, firebase: { initializeApp: () => ({ auth: () => auth }) } });
  return { window, calls, events, location, element, setUser: user => { auth.currentUser = user; listener(user); } };
}
test('standalone manager loads no employee data until allowed login and clears screens at logout', async () => {
  const page = shell();
  page.setUser(null);
  assert.equal(page.element('staff-main').hidden, true);
  assert.equal(page.element('staff-login').hidden, false);
  assert.ok(!page.calls.some(value => value.endsWith('.init')));
  await assert.rejects(page.window.AttendanceSession.getToken(), /관리자 로그인/);
  page.setUser({ email: 'customer@example.invalid' });
  assert.ok(!page.calls.some(value => value.endsWith('.init')));
  page.setUser({ email: 'sun1562@naver.com', getIdToken: async () => 'test-admin-token' });
  assert.equal(page.element('staff-main').hidden, false);
  assert.equal(page.calls.at(-1), 'attendance.init');
  assert.equal(await page.window.AttendanceSession.getToken(), 'test-admin-token');
  assert.equal(page.window.AttendanceSession.isActive('attendance'), true);
  page.location.hash = '#reservations'; page.events.hashchange();
  assert.equal(page.calls.at(-1), 'reservations.init');
  assert.equal(page.element('staff-attendance-panel').hidden, true);
  assert.equal(page.window.AttendanceSession.isActive('attendance'), false);
  await page.element('staff-logout').onclick();
  assert.equal(page.element('staff-main').hidden, true);
  assert.equal(page.window.AttendanceSession.isActive('reservations'), false);
  await assert.rejects(page.window.AttendanceSession.getToken());
});
test('사용 안내 탭은 다른 화면을 내리고 혼자 뜬다', () => {
  const page = shell();
  page.setUser({ email: 'sun1562@naver.com' });
  assert.ok(page.calls.includes('attendance.init'));
  page.location.hash = '#manual';
  page.events.hashchange();
  assert.equal(page.element('staff-manual-panel').hidden, false);
  assert.equal(page.element('staff-attendance-panel').hidden, true);
  assert.equal(page.element('staff-reservations-panel').hidden, true);
  assert.ok(page.calls.includes('manual.init'));
  // 안내에서 근태로 돌아오면 안내는 내려가야 한다. 급여 화면 위에 겹치면 안 된다.
  page.location.hash = '#attendance';
  page.events.hashchange();
  assert.ok(page.calls.includes('manual.dispose'));
  assert.equal(page.element('staff-manual-panel').hidden, true);
  assert.equal(page.element('staff-attendance-panel').hidden, false);
});

test('사용 안내가 안 실려도 근태 화면은 열린다', () => {
  // 안내는 없어도 되는 화면이고 급여는 없으면 안 되는 화면이다.
  const page = shell();
  delete page.window.StaffManual;
  page.setUser({ email: 'sun1562@naver.com' });
  assert.equal(page.element('staff-attendance-panel').hidden, false);
  assert.ok(page.calls.includes('attendance.init'));
  page.location.hash = '#manual';
  page.events.hashchange();
  assert.equal(page.element('staff-manual-panel').hidden, false);
});

test('only legacy staff and reservation admin links redirect to the standalone manager', () => {
  const source = fs.readFileSync(path.join(root, 'assets/js/staff-admin-redirect.js'), 'utf8');
  for (const hash of ['#attendance', '#reservations', '#orders', '#settlements', '']) {
    const replacements = [], events = {};
    vm.runInNewContext(source, { location: { hash, replace: value => replacements.push(value) }, window: { addEventListener: (name, fn) => events[name] = fn } });
    assert.deepEqual(replacements, ['#attendance', '#reservations'].includes(hash) ? [`./staff-admin.html${hash}`] : []);
    assert.equal(typeof events.hashchange, 'function');
  }
  const admin = fs.readFileSync(path.join(root, 'admin.html'), 'utf8');
  assert.ok(!admin.includes('id="attendance-root"'));
  assert.ok(!admin.includes('id="tab-reservations"'));
  const separate = fs.readFileSync(path.join(root, 'staff-admin.html'), 'utf8');
  assert.ok(separate.includes('id="attendance-root"') && separate.includes('id="reservations-root"'));
  assert.ok(!separate.includes('firebase-firestore') && !separate.includes('src="./admin.html'));
});
