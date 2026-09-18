'use strict';

// 태블릿 주방 화면의 숫자다. 관리 화면의 주문 탭과 다르면 주방이 잘못 만든다.
// 곱빼기도시락과 공기밥은 행사도시락 카탈로그로 주문받지만 따로 세야 한다.

const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../../orderTotals');
const catering = require('../../../assets/js/catering-catalog.js');

const 한상 = 'pork-set-9000';

test('도시락·샐러드·일회용도시락을 업체별로 더한다', () => {
  const totals = T.totalsFromRows([
    { lunchCount: 100, saladCount: 20, eventLunchCount: 3 },
    { lunchCount: 24, saladCount: 8 }
  ]);
  assert.equal(totals.lunch, 124);
  assert.equal(totals.salad, 28);
  assert.equal(totals.eventLunch, 3);
});

test('곱빼기도시락과 공기밥은 행사도시락에 섞이지 않는다', () => {
  const totals = T.totalsFromRows([{
    lunchCount: 0,
    cateringItems: [
      { menuId: 한상, qty: 4 },
      { menuId: catering.LARGE_LUNCH_MENU_ID, qty: 2 },
      { menuId: catering.RICE_MENU_ID, qty: 1 }
    ]
  }]);
  assert.equal(totals.catering, 4);
  assert.equal(totals.largeLunch, 2);
  assert.equal(totals.rice, 1);
});

test('단독 행사도시락 주문도 행사도시락에 더한다', () => {
  // 총 행사도시락 = 월식 업체의 행사 추가주문 + 단독 행사도시락 주문
  const totals = T.totalsFromRows(
    [{ cateringItems: [{ menuId: 한상, qty: 4 }] }],
    [{ items: [{ menuId: 한상, qty: 5 }, { menuId: 한상, qty: 2 }] }, { count: 3 }]
  );
  assert.equal(totals.catering, 14);
});

test('행사 주문에 품목이 있으면 적어둔 개수보다 품목 합이 먼저다', () => {
  assert.equal(T.eventRowQty({ items: [{ qty: 2 }, { qty: 3 }], count: 99 }), 5);
  assert.equal(T.eventRowQty({ count: 7 }), 7);
  assert.equal(T.eventRowQty({}), 0);
  // 품목 줄이 qty 대신 count 로 올 때도 센다.
  assert.equal(T.eventRowQty({ items: [{ count: 4 }] }), 4);
});

test('모르는 메뉴는 세지 않는다', () => {
  // 카탈로그에서 뺀 메뉴가 옛 주문에 남아 있어도 숫자가 튀면 안 된다.
  const totals = T.totalsFromRows([{ cateringItems: [{ menuId: '없는메뉴', qty: 10 }] }]);
  assert.equal(totals.catering, 0);
  assert.equal(totals.largeLunch, 0);
  assert.equal(totals.rice, 0);
});

test('값이 빠지거나 이상해도 NaN 이 나오지 않는다', () => {
  // 주방이 보고 만드는 숫자다.
  const 이상한값 = [undefined, null, '', 'abc', NaN, Infinity, -5, {}, []];
  for (const bad of 이상한값) {
    const totals = T.totalsFromRows([{ lunchCount: bad, saladCount: bad, eventLunchCount: bad, cateringItems: bad }], bad);
    for (const [key, value] of Object.entries(totals)) {
      assert.ok(Number.isSafeInteger(value) && value >= 0, `${key}=${value} (입력 ${String(bad)})`);
    }
  }
  const 빈값 = T.totalsFromRows();
  assert.deepEqual(Object.values(빈값), [0, 0, 0, 0, 0, 0]);
});

test('곱빼기·공기밥만 시킨 업체도 주문이 있는 것으로 센다', () => {
  // 이 업체가 빠지면 공기밥 하나가 통째로 사라진다.
  assert.equal(T.hasAnyOrder({ cateringItems: [{ menuId: catering.RICE_MENU_ID, qty: 1 }] }), true);
  assert.equal(T.hasAnyOrder({ lunchCount: 2 }), true);
  assert.equal(T.hasAnyOrder({ lunchCount: 0, saladCount: 0, cateringItems: [] }), false);
  assert.equal(T.hasAnyOrder({}), false);
});

test('화면에 나오는 여섯 가지를 모두 낸다', () => {
  // 표시 업체 수는 주방에서 쓸 일이 없어 빼기로 했다.
  const keys = Object.keys(T.totalsFromRows());
  assert.deepEqual(keys.sort().join(','), 'catering,eventLunch,largeLunch,lunch,rice,salad');
});
