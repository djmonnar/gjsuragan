'use strict';

// 태블릿에서 일일근무자 자리는 칸 하나가 아니다.
// '새로 출근' 칸 하나 + 지금 들어와 있는 사람마다 퇴근 칸 하나로 갈라져야,
// 여러 명이 같이 일해도 각자 자기 것을 눌러 퇴근할 수 있다.

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../../..');
const at = value => new Date(value).getTime();

function kiosk(employees) {
  const nodes = new Map();
  const make = () => ({ innerHTML: '', textContent: '', value: '', hidden: false, onclick: null, classList: { add() {}, remove() {}, toggle() {} }, querySelector: () => null, querySelectorAll: () => [], elements: { name: { value: '' } } });
  const el = id => { if (!nodes.has(id)) nodes.set(id, make()); return nodes.get(id); };
  const window = { addEventListener() {}, removeEventListener() {} };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'assets/js/attendance-ui.js'), 'utf8'), { window, URLSearchParams });
  const document = { getElementById: el, querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, removeEventListener() {}, createElement: () => make(), body: { append() {} } };
  const source = fs.readFileSync(path.join(root, 'assets/js/attendance-kiosk.js'), 'utf8')
    .replace("})();", `  window.__kiosk = { setData(list, f) { employees = list; floor = f; }, buildCards, render };\n})();`);
  vm.runInNewContext(source, {
    window, document, location: { search: '?store=suragan' }, navigator: {}, Intl, URLSearchParams,
    localStorage: { getItem: () => '', setItem() {}, removeItem() {} },
    setInterval: () => 0, clearInterval() {}, setTimeout: () => 0, clearTimeout() {}, crypto: { randomUUID: () => 'x' },
    firebase: { initializeApp: () => ({ auth: () => ({}) }) }
  });
  window.__kiosk.setData(employees, 2);
  window.__kiosk.render();
  return { cards: window.__kiosk.buildCards(), html: el('kiosk-grid').innerHTML, total: el('kiosk-total').textContent, working: el('kiosk-working').textContent };
}

const 자리 = { id: 'd1', name: '일일근무자 (홀)', role: '홀', payType: 'daily', currentShiftId: null, lastShift: null, openShifts: [] };
const 직원 = { id: 'h1', name: '박알바', role: '포장', payType: 'hourly', currentShiftId: null, lastShift: null, openShifts: [] };
test('hourly checkout today offers a distinct clock-in for the next shift', () => {
  const now = Date.now();
  const { cards, html } = kiosk([{ ...직원, lastShift: { id: 'done', checkInAt: now - 7200000, checkOutAt: now - 1000 } }]);
  assert.equal(cards[0].working, false);
  assert.equal(cards[0].action, '다시 출근');
  assert.equal(cards[0].shiftId, '');
  assert.match(html, /다시 출근하기/);
});

test('아무도 없는 자리는 출근 칸 하나만 낸다', () => {
  const { cards } = kiosk([자리]);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].action, '출근');
  assert.equal(cards[0].shiftId, '');
  assert.equal(cards[0].working, false);
});

test('두 명이 들어와 있으면 출근 칸 하나에 퇴근 칸 두 개가 된다', () => {
  const open = [
    { id: 's1', checkInAt: at('2026-09-17T09:00:00+09:00'), workerName: '' },
    { id: 's2', checkInAt: at('2026-09-17T11:00:00+09:00'), workerName: '김일손' }
  ];
  const { cards, total, working } = kiosk([{ ...자리, openShifts: open }]);
  assert.equal(cards.length, 3);
  assert.equal(cards.filter(c => c.action === '출근').length, 1);
  const outs = cards.filter(c => c.action === '퇴근');
  assert.equal(outs.map(c => c.shiftId).join(','), 's1,s2');
  // 이름을 이미 적었으면 그 이름으로, 아니면 순번으로 구분한다.
  assert.equal(outs[1].name, '김일손');
  assert.match(outs[0].name, /일일근무자 \(홀\) 1/);
  assert.equal(String(total), '3');
  assert.equal(String(working), '2');
});

test('퇴근 칸에는 자기 출근 시각이 적힌다', () => {
  const { cards } = kiosk([{ ...자리, openShifts: [{ id: 's1', checkInAt: at('2026-09-17T09:05:00+09:00'), workerName: '' }] }]);
  const out = cards.find(c => c.action === '퇴근');
  assert.match(out.detail, /09:05 출근/);
  assert.equal(out.checkInAt, at('2026-09-17T09:05:00+09:00'));
});

test('보통 직원은 예전 그대로 칸 하나다', () => {
  const 근무중 = { ...직원, currentShiftId: 'x', lastShift: { id: 'x', checkInAt: at('2026-09-17T09:00:00+09:00'), checkOutAt: null } };
  const { cards, working } = kiosk([직원, 근무중]);
  assert.equal(cards.length, 2);
  assert.equal(cards[0].action, '출근');
  assert.equal(cards[1].action, '퇴근');
  assert.equal(cards[1].shiftId, 'x');
  assert.equal(String(working), '1');
});

test('자리와 직원이 섞여 있어도 각자 제 모양으로 나온다', () => {
  const { cards, html } = kiosk([직원, { ...자리, openShifts: [{ id: 's1', checkInAt: at('2026-09-17T09:00:00+09:00'), workerName: '' }] }]);
  assert.equal(cards.length, 3);
  // 버튼이 자리와 기록을 함께 들고 있어야 클릭에서 구분된다.
  assert.match(html, /data-employee="d1" data-shift="s1"/);
  assert.match(html, /data-employee="d1" data-shift=""/);
  assert.match(html, /data-employee="h1" data-shift=""/);
});

test('openShifts 가 없는 응답에도 터지지 않는다', () => {
  // 함수 배포 전에는 이 칸이 아예 없다.
  const { cards } = kiosk([{ id: 'd1', name: '일일근무자', role: '', payType: 'daily', currentShiftId: null, lastShift: null }]);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].action, '출근');
});

// 낮엔 돌담명가(1)에서 일하고 저녁에 궁중수라간(2) 태블릿에 온 일당 직원.
const 겸직 = { id: 'p1', name: '이겸직', role: '', payType: 'perDiem', floor: 1, currentShiftId: null, openShifts: [] };
test('다른 매장에서 오늘 근무를 마친 일당 직원은 이 매장 태블릿에서 추가 근무 출근이 된다', () => {
  const now = Date.now();
  const { cards } = kiosk([{ ...겸직, lastShift: { id: 'lunch', checkInAt: now - 6 * 3600000, checkOutAt: now - 3600000, floor: 1 } }]);
  assert.equal(cards[0].extraHere, true);
  assert.equal(cards[0].action, '추가 근무 출근');
  // 원래 매장 이름으로 보여준다
  assert.equal(cards[0].role, '돌담명가 직원');
});

test('같은 매장에서 마친 날이나 일당 직원이 아니면 추가 근무가 아니다', () => {
  const now = Date.now();
  const last = { id: 'lunch', checkInAt: now - 6 * 3600000, checkOutAt: now - 3600000 };
  // 같은 매장(2)에서 마친 날
  assert.equal(kiosk([{ ...겸직, floor: 2, lastShift: { ...last, floor: 2 } }]).cards[0].extraHere, false);
  // 옛 기록이라 매장이 없으면 원래 매장(2)에서 일한 것으로 본다
  assert.equal(kiosk([{ ...겸직, floor: 2, lastShift: last }]).cards[0].extraHere, false);
  // 시급 직원은 다른 매장에 뜨지 않고, 같은 매장 재출근은 '다시 출근'이다
  assert.equal(kiosk([{ ...겸직, payType: 'hourly', lastShift: { ...last, floor: 1 } }]).cards[0].extraHere, false);
});

test('출근은 본인 확인을 한 번 더 거치고, 매뉴얼에 그 버튼 이름이 적혀 있다', () => {
  // 옆 사람 이름을 잘못 눌러 남의 출근이 찍히는 일이 있었다.
  const source = fs.readFileSync(path.join(root, 'assets/js/attendance-kiosk.js'), 'utf8');
  const label = /textContent = '([^']+)';\n    \}, true\);/.exec(source);
  assert.ok(label, '본인 확인 단계의 버튼 이름을 찾지 못했습니다.');
  assert.match(source, /const askIdentity = !working;/);
  const manual = fs.readFileSync(path.join(root, 'assets/js/staff-manual.js'), 'utf8');
  assert.match(manual, new RegExp(`<b>본인이 맞나요\\?</b>에서 <b>${label[1]}</b>`));
  assert.match(source, /'본인이 맞나요\?'/);
});
