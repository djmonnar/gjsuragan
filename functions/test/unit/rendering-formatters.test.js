'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const test = require('node:test');
const assert = require('node:assert/strict');

const source = fs.readFileSync(
  path.resolve(__dirname, '../../../assets/js/rendering-formatters.js'),
  'utf8'
);
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(source, sandbox);

const formatterNames = [
  'escHtml',
  'firstOrderBadgeHtml',
  'customerText',
  'customerJsArg',
  'customerPhoneDigits',
  'customerTimestampMs',
  'customerNewBadgeHtml',
  'customerProductKey',
  'customerOrderTypeLabel',
  'customerOrderTypeBadge',
];

const firstOrderBadge = '<span class="badge" title="이 고객의 첫 배송 전 주문" style="background:#ecfdf5;color:#047857;border-color:#86efac;font-weight:900;letter-spacing:.2px;">첫주문</span>';
const newOrderBadge = '<span class="badge" title="최근 24시간 이내 신규 주문" style="background:#fff3bf;color:#9a6700;border-color:#d9a441;font-weight:900;letter-spacing:.2px;">NEW</span>';

test('formatter classic script defines only the expected globals without browser services', () => {
  assert.deepEqual(Object.keys(sandbox).sort(), formatterNames.slice().sort());
  for (const name of formatterNames) assert.equal(typeof sandbox[name], 'function', name);
  assert.equal('document' in sandbox, false);
  assert.equal('firebase' in sandbox, false);
  assert.equal('window' in sandbox, false);
});

test('baseline text fixtures remain byte-for-byte identical', () => {
  const cases = [
    [sandbox.escHtml, ['정상 문자열'], '정상 문자열'],
    [sandbox.escHtml, [''], ''],
    [sandbox.escHtml, ['   '], '   '],
    [sandbox.escHtml, ['English 123'], 'English 123'],
    [sandbox.escHtml, [0], '0'],
    [sandbox.escHtml, [null], ''],
    [sandbox.escHtml, [undefined], ''],
    [sandbox.escHtml, ['<>&"\''], '&lt;&gt;&amp;&quot;&#39;'],
    [sandbox.escHtml, ['첫째 줄\n둘째 줄'], '첫째 줄\n둘째 줄'],
    [sandbox.escHtml, ['도시락 🍱'], '도시락 🍱'],
    [sandbox.escHtml, ['가'.repeat(2048)], '가'.repeat(2048)],
    [sandbox.customerText, ['<script>alert("x")</script>'], '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;'],
    [sandbox.customerText, [0], '0'],
    [sandbox.customerText, [null], ''],
    [sandbox.customerJsArg, ["고객\\이름'테스트\n다음"], '고객\\\\이름\\&#39;테스트 다음'],
    [sandbox.customerJsArg, [''], ''],
    [sandbox.customerJsArg, [0], '0'],
    [sandbox.customerJsArg, [null], ''],
    [sandbox.customerPhoneDigits, ['010-1234-5678'], '01012345678'],
    [sandbox.customerPhoneDigits, ['전화 055 123 4567'], '0551234567'],
    [sandbox.customerPhoneDigits, [0], ''],
    [sandbox.customerPhoneDigits, [null], ''],
  ];
  for (const [fn, args, expected] of cases) assert.equal(fn(...args), expected);
});

test('baseline badge and order-label fixtures remain identical', () => {
  const cases = [
    [sandbox.firstOrderBadgeHtml, [], firstOrderBadge],
    [sandbox.customerNewBadgeHtml, [], newOrderBadge],
    [sandbox.customerProductKey, [{productId:'A', set:'B'}], 'A'],
    [sandbox.customerProductKey, [{set:'C'}], 'C'],
    [sandbox.customerProductKey, [{}], ''],
    [sandbox.customerProductKey, [null], ''],
    [sandbox.customerOrderTypeLabel, [{orderType:'sub', productId:'A'}], '정기'],
    [sandbox.customerOrderTypeLabel, [{orderType:'once', productId:'pork_rib'}], '단품'],
    [sandbox.customerOrderTypeLabel, [{orderType:'once', productId:'beef_la'}], '단품'],
    [sandbox.customerOrderTypeLabel, [{orderType:'once', productId:'beef_soup'}], '단품'],
    [sandbox.customerOrderTypeLabel, [{orderType:'once', productId:'A'}], '선택'],
    [sandbox.customerOrderTypeLabel, [{}], '선택'],
    [sandbox.customerOrderTypeLabel, [null], '선택'],
    [sandbox.customerOrderTypeBadge, [{orderType:'sub'}], 'b-sub'],
    [sandbox.customerOrderTypeBadge, [{orderType:'once'}], 'b-once'],
    [sandbox.customerOrderTypeBadge, [null], 'b-once'],
  ];
  for (const [fn, args, expected] of cases) assert.equal(fn(...args), expected);
});

test('timestamp fixtures preserve Date, Firestore-like, numeric zero, and missing values', () => {
  assert.equal(
    vm.runInContext("customerTimestampMs(new Date('2026-07-11T00:00:00Z'))", sandbox),
    1783728000000
  );
  assert.equal(sandbox.customerTimestampMs('2026-07-11T09:30:00+09:00'), 1783729800000);
  assert.equal(sandbox.customerTimestampMs({seconds:123, nanoseconds:456789000}), 123456);
  assert.equal(sandbox.customerTimestampMs({toDate:() => new Date(789)}), 789);
  assert.equal(sandbox.customerTimestampMs('not-a-date'), 0);
  assert.equal(sandbox.customerTimestampMs(0), 0);
  assert.equal(sandbox.customerTimestampMs(null), 0);
  assert.equal(sandbox.customerTimestampMs(undefined), 0);
});

test('object formatters do not mutate their customer input', () => {
  const customer = {
    id:'fixture-1',
    orderType:'once',
    productId:'pork_rib',
    set:'A',
    remain:0,
    nested:{value:0},
  };
  const before = JSON.stringify(customer);
  sandbox.customerProductKey(customer);
  sandbox.customerOrderTypeLabel(customer);
  sandbox.customerOrderTypeBadge(customer);
  assert.equal(JSON.stringify(customer), before);
});

test('formatters are deterministic for repeated calls', () => {
  const inputs = [
    () => sandbox.escHtml('<궁중&수라간>'),
    () => sandbox.customerJsArg("A\\B'C\nD"),
    () => sandbox.customerPhoneDigits('010-0000-0000'),
    () => sandbox.customerTimestampMs({seconds:10, nanoseconds:500000000}),
    () => sandbox.customerOrderTypeLabel({orderType:'once', productId:'A'}),
  ];
  for (const run of inputs) assert.equal(run(), run());
});
