'use strict';

// 퇴근을 빠뜨린 근무.
// 출근하고 18시간이 지나도록 퇴근이 없으면 '퇴근 누락'으로 넘기고, 그 사람의 다음 출근을 새로 받는다.
// 예전에는 관리자가 고칠 때까지 출근도 못 찍어서 일당 직원의 열흘치가 통째로 빠졌다 (2026-09).

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const M = require('../../attendanceModel');

const root = path.resolve(__dirname, '../../..');
const HOUR = 3600000;
const at = value => new Date(value).getTime();
const 출근 = at('2026-09-20T10:08:00+09:00');
const 열린근무 = { checkInAt: 출근, checkOutAt: null, voided: false };

test('출근하고 18시간이 지나야 퇴근 누락이다', () => {
  assert.equal(M.FORGOTTEN_SHIFT_MS, 18 * HOUR);
  assert.equal(M.isForgottenShift(열린근무, 출근 + 18 * HOUR), false);
  assert.equal(M.isForgottenShift(열린근무, 출근 + 18 * HOUR + 1), true);
  assert.equal(M.isForgottenShift(열린근무, 출근 + 10 * 24 * HOUR), true);
  // 관리자가 넣는 한 기록의 한도는 그대로 36시간이다. 태블릿만 18시간에서 끊는다.
  assert.equal(M.MAX_SHIFT_MS, 36 * HOUR);
});

test('퇴근한 근무·지운 근무·없는 근무는 누락이 아니다', () => {
  const later = 출근 + 48 * HOUR;
  assert.equal(M.isForgottenShift({ ...열린근무, checkOutAt: 출근 + 8 * HOUR }, later), false);
  assert.equal(M.isForgottenShift({ ...열린근무, voided: true }, later), false);
  assert.equal(M.isForgottenShift(null, later), false);
  assert.equal(M.isForgottenShift(undefined, later), false);
  // 옛 문서처럼 퇴근 칸이 아예 없으면 열린 근무로 본다.
  assert.equal(M.isForgottenShift({ checkInAt: 출근 }, later), true);
});

test('퇴근 누락 근무는 그 뒤의 다른 날 기록과 겹치지 않는다', () => {
  const now = 출근 + 10 * 24 * HOUR;
  // 관리자가 빠진 날을 넣을 수 있어야 한다. 예전에는 열린 근무와 겹친다며 막혔다.
  const 다음날 = { checkInAt: at('2026-09-21T10:00:00+09:00'), checkOutAt: at('2026-09-21T18:00:00+09:00') };
  assert.equal(M.overlaps(다음날, 열린근무, now), false);
  // 누락으로 넘어가기 전(출근 뒤 18시간 안)의 시간과는 여전히 겹친다.
  const 같은날 = { checkInAt: at('2026-09-20T12:00:00+09:00'), checkOutAt: at('2026-09-20T15:00:00+09:00') };
  assert.equal(M.overlaps(같은날, 열린근무, now), true);
  // 지금 근무 중인(누락 아닌) 열린 근무는 예전처럼 끝이 없는 것으로 본다.
  const 지금근무 = { checkInAt: now - HOUR, checkOutAt: null };
  assert.equal(M.overlaps({ checkInAt: now + HOUR, checkOutAt: now + 2 * HOUR }, 지금근무, now), true);
  // 지금 시각을 안 넘기면 예전과 같다.
  assert.equal(M.overlaps(다음날, 열린근무), true);
});

// 태블릿 화면을 실제로 그려 본다.
function kiosk(employees) {
  const nodes = new Map();
  const make = () => ({ innerHTML: '', textContent: '', value: '', hidden: false, onclick: null, classList: { add() {}, remove() {}, toggle() {} }, querySelector: () => null, querySelectorAll: () => [], elements: { name: { value: '' } } });
  const el = id => { if (!nodes.has(id)) nodes.set(id, make()); return nodes.get(id); };
  const window = { addEventListener() {}, removeEventListener() {} };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'assets/js/attendance-ui.js'), 'utf8'), { window, URLSearchParams });
  const document = { getElementById: el, querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, removeEventListener() {}, createElement: () => make(), body: { append() {} } };
  const source = fs.readFileSync(path.join(root, 'assets/js/attendance-kiosk.js'), 'utf8')
    .replace('})();', '  window.__kiosk = { setData(list, f) { employees = list; floor = f; }, render, buildCards, confirmMessage };\n})();');
  vm.runInNewContext(source, {
    window, document, location: { search: '?store=doldam' }, navigator: {}, Intl, URLSearchParams,
    localStorage: { getItem: () => '', setItem() {}, removeItem() {} },
    setInterval: () => 0, clearInterval() {}, setTimeout: () => 0, clearTimeout() {}, crypto: { randomUUID: () => 'x' },
    firebase: { initializeApp: () => ({ auth: () => ({}) }) }
  });
  window.__kiosk.setData(employees, 1);
  window.__kiosk.render();
  return { html: el('kiosk-grid').innerHTML, working: el('kiosk-working').textContent, api: window.__kiosk };
}

test('퇴근 누락인 사람은 태블릿에서 퇴근이 아니라 출근 칸으로 뜬다', () => {
  const later = at('2026-09-22T10:00:00+09:00');
  // 관리자가 뒤의 날짜를 넣어 lastShift 가 다른 기록을 가리켜도, 누락된 근무의 출근 시각을 보여준다.
  const { html, working, api } = kiosk([{ id: 'p1', name: '박희영', role: '홀', part: 'hall', payType: 'perDiem',
    currentShiftId: 's-old', lastShift: { id: 's-later', checkInAt: later, checkOutAt: later + 8 * HOUR },
    forgottenShift: true, forgottenCheckInAt: 출근, openShifts: [] }]);
  assert.match(html, /att-pill amber">퇴근 누락</);
  assert.match(html, /09-20 퇴근 안 찍힘/);
  assert.match(html, /출근 →/);
  // 퇴근할 기록을 지정하지 않는다. 누르면 새 출근이다.
  assert.match(html, /data-shift=""/);
  assert.equal(working, 0);
  const card = api.buildCards()[0];
  assert.equal(card.working, false);
  const message = api.confirmMessage(card);
  assert.match(message, /09-20 10:08 출근의 퇴근이 안 찍혀 있어요/);
  assert.match(message, /지금 출근을 기록할까요/);
});

test('서버가 누락 여부를 안 보내면 예전처럼 퇴근 칸이다', () => {
  // 화면이 먼저 올라가고 서버가 나중에 배포되는 사이에도 지금 동작이 바뀌면 안 된다.
  const checkIn = Date.now() - HOUR;
  const { html } = kiosk([{ id: 'p1', name: '김근무', role: '', payType: 'hourly', currentShiftId: 's1',
    lastShift: { id: 's1', checkInAt: checkIn, checkOutAt: null }, openShifts: [] }]);
  assert.match(html, /att-pill green">근무 중</);
  assert.match(html, /퇴근 →/);
  assert.match(html, /data-shift="s1"/);
});

test('날짜를 넘긴 근무를 퇴근할 때는 전날 퇴근을 깜빡한 건 아닌지 묻는다', () => {
  const { api } = kiosk([]);
  assert.match(api.confirmMessage({ working: true, checkInAt: Date.now() - 30 * HOUR }), /날짜를 넘긴 근무입니다/);
  const today = new Date(Date.now() + 9 * HOUR).toISOString().slice(0, 10);
  const todayStart = at(`${today}T00:00:00+09:00`);
  assert.doesNotMatch(api.confirmMessage({ working: true, checkInAt: todayStart }), /날짜를 넘긴 근무/);
  // 처음 출근하는 사람에게는 누락 안내가 뜨지 않는다.
  assert.doesNotMatch(api.confirmMessage({ working: false, forgotten: false }), /안 찍혀/);
});
