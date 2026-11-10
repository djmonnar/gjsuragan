'use strict';

// 고객 상세의 완료이력. 예전에는 최근 5건만 그리고 끝이라, 그 전 날짜를 물어보면 볼 길이 없었다 (2026-11-10).
// 이제 최근 몇 건은 바로 보이고 나머지는 '이전 이력 더 보기'로 연다.
// 화면 함수를 소스에서 그대로 뽑아 돌리고, 매뉴얼에 적은 건수도 코드 값과 대조한다.

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

function extractFunction(source, signature) {
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `${signature} 함수를 찾지 못했습니다.`);
  const bodyStart = source.indexOf('{', start);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`${signature} 함수 끝을 찾지 못했습니다.`);
}

const rendering = read('assets/js/rendering.js');
const formatters = read('assets/js/rendering-formatters.js');
const PREVIEW = Number(/const CUSTOMER_HISTORY_PREVIEW = (\d+);/.exec(rendering)?.[1]);

function load() {
  const code = [
    extractFunction(formatters, 'function escHtml('),
    extractFunction(formatters, 'function customerText('),
    extractFunction(formatters, 'function customerJsArg('),
    `const CUSTOMER_HISTORY_PREVIEW = ${PREVIEW};`,
    'const __expandedCustomerHistoryIds = new Set();',
    extractFunction(rendering, 'function customerHistoryDates('),
    extractFunction(rendering, 'function customerHistoryToggleLabel('),
    extractFunction(rendering, 'function customerHistoryHtml('),
    extractFunction(rendering, 'function customerToggleHistory('),
    '({ customerHistoryDates, customerHistoryHtml, customerToggleHistory, expanded: __expandedCustomerHistoryIds })'
  ].join('\n');
  return vm.runInNewContext(code, {});
}

// 2026-09-01 부터 하루씩 n건.
const days = n => Array.from({ length: n }, (_, i) => `2026-09-${String(i + 1).padStart(2, '0')}`);
const shownDates = html => [...html.matchAll(/<span>(\d{4}-\d{2}-\d{2})<\/span>/g)].map(m => m[1]);

function fakeToggle(olderCount) {
  const older = { hidden: true, classList: { contains: name => name === 'customer-history-older' }, children: { length: olderCount } };
  const attrs = {};
  return { older, attrs, btn: { previousElementSibling: older, textContent: '', setAttribute: (k, v) => { attrs[k] = v; } } };
}

test('완료이력 미리보기 건수를 코드에서 읽는다', () => {
  assert.ok(Number.isInteger(PREVIEW) && PREVIEW > 0, 'CUSTOMER_HISTORY_PREVIEW 를 찾지 못했습니다.');
});

test('살아 있는 주문 카드가 완료이력을 이 함수로 그린다', () => {
  // rendering.js 에는 예전 판 customerGroupOrderSummary(c) 가 남아 있고, 뒤에 선언된 (c, idx) 판이 실제로 쓰인다.
  const live = extractFunction(rendering, 'function customerGroupOrderSummary(c, idx)');
  assert.match(live, /customerHistoryHtml\(c\)/);
  assert.doesNotMatch(live, /slice\(-5\)/);
});

test('미리보기 건수 이하면 더 보기 버튼 없이 전부 보인다', () => {
  const { customerHistoryHtml } = load();
  const html = customerHistoryHtml({ id: 'a', deliveredDates: days(PREVIEW) });
  assert.equal(shownDates(html).length, PREVIEW);
  assert.doesNotMatch(html, /customer-history-toggle/);
});

test('그 전 날짜도 전부 그리고, 더 보기를 누르기 전에는 접어 둔다', () => {
  const { customerHistoryHtml } = load();
  const all = days(PREVIEW + 7);
  const html = customerHistoryHtml({ id: 'a', deliveredDates: all });
  assert.deepEqual(new Set(shownDates(html)), new Set(all), '빠진 날짜가 있습니다.');
  assert.match(html, /class="customer-history-list customer-history-older" hidden>/);
  assert.match(html, new RegExp(`이전 이력 7건 더 보기`));
  // 접힌 묶음 바깥에는 최근 날짜만 있다.
  const visible = shownDates(html.split('customer-history-older')[0]);
  assert.deepEqual(visible, all.slice(-PREVIEW).reverse());
  assert.doesNotMatch(html, /undefined|NaN/);
});

test('누른 순서가 아니라 날짜 순서로, 최근 날짜가 위에 온다', () => {
  const { customerHistoryDates } = load();
  // 2026-10-30 을 뒤늦게 완료해 배열 끝에 붙은 경우
  const order = { deliveredDates: ['2026-11-02', '2026-11-04', '2026-11-06', '2026-11-09', '2026-10-30', '', null] };
  assert.deepEqual([...customerHistoryDates(order)], ['2026-11-09', '2026-11-06', '2026-11-04', '2026-11-02', '2026-10-30']);
  // 저장된 배열 순서는 건드리지 않는다.
  assert.equal(order.deliveredDates[4], '2026-10-30');
});

test('이력이 없거나 배열이 아니면 이력 없음', () => {
  const { customerHistoryHtml } = load();
  for (const deliveredDates of [undefined, null, [], 'x']) {
    assert.match(customerHistoryHtml({ id: 'a', deliveredDates }), /이력 없음/);
  }
});

test('펼친 날짜에도 취소 버튼이 그 주문·그 날짜로 붙는다', () => {
  const { customerHistoryHtml } = load();
  const html = customerHistoryHtml({ id: "o'1", deliveredDates: days(PREVIEW + 1) });
  const older = html.split('customer-history-older')[1];
  assert.match(older, /undoMarkDone\('o\\&#39;1','2026-09-01'\)/);
});

test('더 보기를 누르면 그 자리에서 펼치고, 다시 그려도 펼친 채로 둔다', () => {
  const { customerHistoryHtml, customerToggleHistory, expanded } = load();
  const { older, attrs, btn } = fakeToggle(3);
  customerToggleHistory(btn, 'a');
  assert.equal(older.hidden, false);
  assert.equal(attrs['aria-expanded'], 'true');
  assert.equal(btn.textContent, '이전 이력 접기');
  assert.ok(expanded.has('a'));

  // 이전 날짜를 취소하면 목록이 다시 그려진다. 그때도 펼쳐져 있어야 한다.
  const html = customerHistoryHtml({ id: 'a', deliveredDates: days(PREVIEW + 3) });
  assert.match(html, /class="customer-history-list customer-history-older">/);
  assert.match(html, /이전 이력 접기/);

  customerToggleHistory(btn, 'a');
  assert.equal(older.hidden, true);
  assert.equal(btn.textContent, '이전 이력 3건 더 보기');
  assert.equal(expanded.has('a'), false);
});

test('매뉴얼에 적은 미리보기 건수가 코드와 같다', () => {
  for (const file of ['src/index/parts/38-page-manual.html', 'index.html', 'manual.html']) {
    const doc = read(file);
    const line = doc.split('\n').find(l => l.includes('이전 이력'));
    assert.ok(line, `${file} 에 이전 이력 안내가 없습니다.`);
    assert.match(line, new RegExp(`최근 ${PREVIEW}건`), `${file} 의 건수가 코드(${PREVIEW})와 다릅니다.`);
  }
});
