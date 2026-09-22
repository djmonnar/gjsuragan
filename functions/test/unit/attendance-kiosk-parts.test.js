'use strict';

// 태블릿에서 홀과 주방을 위아래로 나눠 보여준다.
// 파트를 고른 매장만 갈라지고, 아직 안 고른 매장은 예전처럼 한 덩어리로 남아야 한다.
// 나뉜다고 사람이 화면에서 빠지면 그 사람은 출퇴근을 못 찍는다.

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../../..');

function kiosk(employees, search = '') {
  const nodes = new Map();
  const make = () => ({ innerHTML: '', textContent: '', value: '', hidden: false, onclick: null, classList: { add() {}, remove() {}, toggle() {} }, querySelector: () => null, querySelectorAll: () => [], elements: { name: { value: '' } } });
  const el = id => { if (!nodes.has(id)) nodes.set(id, make()); return nodes.get(id); };
  const window = { addEventListener() {}, removeEventListener() {} };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'assets/js/attendance-ui.js'), 'utf8'), { window, URLSearchParams });
  const document = { getElementById: el, querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, removeEventListener() {}, createElement: () => make(), body: { append() {} } };
  const source = fs.readFileSync(path.join(root, 'assets/js/attendance-kiosk.js'), 'utf8')
    .replace('})();', '  window.__kiosk = { setData(list, f) { employees = list; floor = f; }, render };\n})();');
  vm.runInNewContext(source, {
    window, document, location: { search: '?store=suragan' }, navigator: {}, Intl, URLSearchParams,
    localStorage: { getItem: () => '', setItem() {}, removeItem() {} },
    setInterval: () => 0, clearInterval() {}, setTimeout: () => 0, clearTimeout() {}, crypto: { randomUUID: () => 'x' },
    firebase: { initializeApp: () => ({ auth: () => ({}) }) }
  });
  el('kiosk-search').value = search;
  window.__kiosk.setData(employees, 2);
  window.__kiosk.render();
  const grid = el('kiosk-grid');
  const titles = [...grid.innerHTML.matchAll(/att-part-title">([^<]*)</g)].map(m => m[1]);
  return { html: grid.innerHTML, className: grid.className, titles, total: el('kiosk-total').textContent };
}

const 사람 = (id, name, part) => ({ id, name, role: '조리', part, payType: 'hourly', currentShiftId: null, lastShift: null, openShifts: [] });

test('홀과 주방이 섞여 있으면 위아래로 나눈다', () => {
  const { className, titles, html } = kiosk([사람('h1', '김홀', 'hall'), 사람('k1', '박주방', 'kitchen'), 사람('h2', '이홀', 'hall')]);
  assert.equal(className, 'att-kiosk-parts');
  // 홀이 먼저, 주방이 다음이다.
  assert.deepEqual(titles, ['홀', '주방']);
  assert.match(html, /att-part-title">홀<span>2명</);
  assert.match(html, /att-part-title">주방<span>1명</);
  // 세 사람 모두 화면에 남아 있어야 한다.
  for (const name of ['김홀', '박주방', '이홀']) assert.match(html, new RegExp(name));
});

test('배송까지 세 파트가 정해진 순서로 나온다', () => {
  const { className, titles } = kiosk([
    사람('d1', '최배송', 'delivery'), 사람('k1', '박주방', 'kitchen'),
    사람('h1', '김홀', 'hall'), 사람('x1', '이미정')
  ]);
  assert.equal(className, 'att-kiosk-parts');
  // 입력 순서가 아니라 홀 → 주방 → 배송 → 그 외 순서다.
  assert.deepEqual(titles, ['홀', '주방', '배송', '그 외']);
});

test('파트가 하나뿐이면 제목 없이 예전 그대로다', () => {
  const 한파트 = kiosk([사람('h1', '김홀', 'hall'), 사람('h2', '이홀', 'hall')]);
  assert.equal(한파트.className, 'att-kiosk-grid');
  assert.deepEqual(한파트.titles, []);
  assert.doesNotMatch(한파트.html, /att-part/);
  // 아직 아무도 파트를 안 고른 매장도 마찬가지다.
  const 미지정 = kiosk([사람('a', '김수라'), 사람('b', '박영희')]);
  assert.equal(미지정.className, 'att-kiosk-grid');
  assert.doesNotMatch(미지정.html, /그 외/);
  assert.match(미지정.html, /김수라/);
});

test('파트를 안 고른 사람은 그 외로 아래에 모인다', () => {
  const { titles, html } = kiosk([사람('a', '김수라'), 사람('h1', '김홀', 'hall'), 사람('k1', '박주방', 'kitchen')]);
  assert.deepEqual(titles, ['홀', '주방', '그 외']);
  assert.match(html, /att-part-title">그 외<span>1명</);
  // 모르는 값이 저장돼 있어도 사라지지 않고 그 외로 간다.
  const 이상한값 = kiosk([사람('a', '김수라', '홀'), 사람('h1', '김홀', 'hall')]);
  assert.deepEqual(이상한값.titles, ['홀', '그 외']);
  assert.match(이상한값.html, /김수라/);
});

test('검색으로 걸러진 사람은 파트 인원수에서도 빠진다', () => {
  const { titles, html } = kiosk([사람('h1', '김홀', 'hall'), 사람('h2', '이홀', 'hall'), 사람('k1', '박주방', 'kitchen')], '김');
  // 검색에 걸린 사람이 홀에만 있으면 제목 없이 한 덩어리가 된다.
  assert.deepEqual(titles, []);
  assert.match(html, /김홀/);
  assert.doesNotMatch(html, /박주방/);
});

test('일일근무자 자리도 파트로 나뉜다', () => {
  const 자리 = { id: 'd1', name: '일일근무자 (주방)', role: '주방', part: 'kitchen', payType: 'daily', currentShiftId: null, lastShift: null, openShifts: [] };
  const { titles, html } = kiosk([사람('h1', '김홀', 'hall'), 자리]);
  assert.deepEqual(titles, ['홀', '주방']);
  assert.match(html, /att-part-title">주방<span>1명</);
  assert.match(html, /일일근무자 \(주방\)/);
});
