'use strict';

// 2026-09-30: 교광이 08:55 에 도시락 3→2(공기밥 빼기)로, 다문화가 13→12로 바꿨는데 주문 화면·배송에는
// 옛 숫자가 남았다. 주문 화면은 불러온 순간의 주문을 그리고, "배송 완료"는 화면 숫자를 그대로 배송기록에
// 저장한다. 배송기록이 생기면 화면은 주문보다 그 기록을 먼저 보여줘 그 뒤 고객 변경도 가려진다.
// 저장 직전에 주문을 다시 읽어 비교하고, 배송완료 뒤 고객이 바꾼 행은 따로 알리는 것을 고정한다.
// 변경 기록의 "행사도시락 undefined" 도 여기서 막는다.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const catering = require('../../../assets/js/catering-catalog.js');

const rootDir = path.resolve(__dirname, '../../..');
const adminSource = fs.readFileSync(path.join(rootDir, 'admin.html'), 'utf8');

function extractFunction(name) {
  let start = adminSource.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} 함수를 찾지 못했습니다.`);
  if (adminSource.slice(start - 6, start) === 'async ') start -= 6;
  let paramsDepth = 0;
  let bodyStart = -1;
  for (let index = adminSource.indexOf('(', start); index < adminSource.length; index += 1) {
    if (adminSource[index] === '(') paramsDepth += 1;
    if (adminSource[index] === ')') {
      paramsDepth -= 1;
      if (paramsDepth === 0) {
        bodyStart = adminSource.indexOf('{', index);
        break;
      }
    }
  }
  let bodyDepth = 0;
  for (let index = bodyStart; index < adminSource.length; index += 1) {
    if (adminSource[index] === '{') bodyDepth += 1;
    if (adminSource[index] === '}') {
      bodyDepth -= 1;
      if (bodyDepth === 0) return adminSource.slice(start, index + 1);
    }
  }
  throw new Error(`${name} 함수 끝을 찾지 못했습니다.`);
}

const orders = vm.runInNewContext(`(() => {
  const window = { GJS_CATERING };
  // 일회용 전환 규칙은 이 테스트의 관심사가 아니라 숫자만 맞춘다.
  const normalizeQtyValuesForUser = (user, values) => ({
    lunch: Number(values.lunch) || 0, salad: Number(values.salad) || 0, event: Number(values.event) || 0
  });
  ${[
    'orderLunchQty', 'orderSaladQty', 'orderEventLunchQty', 'orderCateringSummary', 'isEventOrder', 'timestampToDate',
    'orderCateringText', 'orderCateringKey', 'orderChangeSignature', 'orderQtyText', 'orderDocsFromSnap',
    'ordersChangedBetween', 'customerChangedAfterRecord',
    'orderLogValue', 'orderLogFieldLabel', 'orderLogFieldValue', 'orderLogChangeText'
  ].map(extractFunction).join('\n')}
  return {
    orderChangeSignature, orderQtyText, orderDocsFromSnap, ordersChangedBetween, customerChangedAfterRecord,
    orderLogValue, orderLogChangeText
  };
})()`, { GJS_CATERING: catering });

const plain = value => JSON.parse(JSON.stringify(value));
const rice = count => [{ menuId: catering.RICE_MENU_ID, qty: count }];
const 교광_열때 = { uid: 'kg', lunchCount: 3, saladCount: 0, cateringItems: rice(1) };
const 교광_지금 = { uid: 'kg', lunchCount: 2, saladCount: 0, cateringItems: [] };

test('변경 기록에 undefined 대신 추가 메뉴 이름이 나온다', () => {
  const log = { action: 'updated', changes: ['lunchCount', 'cateringItems'], before: 교광_열때, after: 교광_지금 };
  assert.equal(orders.orderLogChangeText(log), '도시락 3 → 2 · 추가 메뉴 공기밥 1개 → 없음');
  const created = orders.orderLogChangeText({ action: 'created', after: 교광_열때 });
  assert.equal(created, '신규: 도시락 3 / 샐러드 0 / 추가 공기밥 1개');
  assert.doesNotMatch(created, /undefined/);
});

test('수량이 같으면 같은 값, 추가 메뉴 순서·필드 이름은 상관없다', () => {
  assert.equal(orders.orderChangeSignature({ lunchCount: 2 }), orders.orderChangeSignature({ lunchQty: 2 }));
  const both = [...rice(1), { menuId: catering.LARGE_LUNCH_MENU_ID, qty: 1 }];
  assert.equal(
    orders.orderChangeSignature({ lunchCount: 1, cateringItems: both }),
    orders.orderChangeSignature({ lunchCount: 1, cateringItems: [...both].reverse() })
  );
  assert.notEqual(orders.orderChangeSignature(교광_열때), orders.orderChangeSignature(교광_지금));
  assert.notEqual(orders.orderChangeSignature({ lunchCount: 2 }), orders.orderChangeSignature({ lunchCount: 2, selfHoliday: true }));
  assert.equal(orders.orderChangeSignature(null), '');
});

test('화면을 연 뒤 바뀐 곳만 골라낸다 (교광·다문화)', () => {
  const loaded = { kg: 교광_열때, dm: { lunchCount: 13 }, same: { lunchCount: 5 } };
  const fresh = { kg: 교광_지금, dm: { lunchCount: 12 }, same: { lunchCount: 5, note: '메모만 바뀜' }, fresh: { lunchCount: 4 } };
  const changes = plain(orders.ordersChangedBetween(loaded, fresh, ['kg', 'dm', 'same', 'fresh', 'nobody']));
  assert.deepEqual(changes.map(change => change.uid), ['kg', 'dm', 'fresh']);
  assert.equal(orders.orderQtyText(changes[0].before), '도시락 3 · 공기밥 1개');
  assert.equal(orders.orderQtyText(changes[0].after), '도시락 2');
  // 화면을 열 때는 주문이 없어 기본 수량으로 보였던 곳
  assert.equal(changes[2].before, null);
  assert.equal(orders.orderQtyText(changes[2].before), '주문 없음(기본 수량)');
});

test('수량 글자는 있는 것만 적는다', () => {
  assert.equal(orders.orderQtyText({ lunchCount: 0, saladCount: 2, eventLunchCount: 1 }), '도시락 0 · 샐러드 2 · 일회용 1');
  assert.equal(orders.orderQtyText({ lunchCount: 3, selfHoliday: true }), '자체 휴무');
});

test('문서 모음에서 없는 문서와 행사도시락 주문은 뺀다', () => {
  const docs = plain(orders.orderDocsFromSnap([
    { id: 'kg', exists: true, data: () => 교광_지금 },
    { id: 'gone', exists: false, data: () => undefined },
    { id: 'event_1', exists: true, data: () => ({ kind: 'eventLunch', lunchCount: 30 }) }
  ]));
  assert.deepEqual(Object.keys(docs), ['kg']);
  assert.equal(docs.kg.lunchCount, 2);
});

test('배송완료 기록보다 뒤에 고객이 다른 수량으로 바꿨을 때만 알린다', () => {
  const record = { lunchQty: 3, cateringItems: rice(1), deliveredAt: '2026-09-30T08:30:00+09:00' };
  const after = { ...교광_지금, submittedAt: '2026-09-30T08:55:00+09:00' };
  assert.equal(orders.customerChangedAfterRecord(after, record, {}), true);
  // 배송완료보다 먼저 바꾼 것은 이미 반영돼 있다(화면을 연 채 완료했다면 저장 전에 멈춘다).
  assert.equal(orders.customerChangedAfterRecord({ ...after, submittedAt: '2026-09-30T08:20:00+09:00' }, record, {}), false);
  // 같은 수량으로 다시 저장한 것은 알릴 필요가 없다.
  assert.equal(orders.customerChangedAfterRecord({ ...교광_열때, submittedAt: '2026-09-30T09:00:00+09:00' }, record, {}), false);
  assert.equal(orders.customerChangedAfterRecord(after, null, {}), false);
  // 관리자가 행을 저장하면 주문(updatedAt) 다음에 배송기록(updatedAt)이 써진다. 알리지 않는다.
  const adminSaved = { lunchCount: 2, updatedAt: { seconds: 100 } };
  assert.equal(orders.customerChangedAfterRecord(adminSaved, { lunchQty: 2, updatedAt: { seconds: 101 } }, {}), false);
});

test('배송 완료·저장이 저장 직전에 최신 주문을 확인한다', () => {
  const complete = extractFunction('completeSelectedDeliveries');
  assert.ok(complete.indexOf('ordersChangedSinceLoad(currentDateStr, checkedUids)') > 0);
  assert.ok(complete.indexOf('ordersChangedSinceLoad(') < complete.indexOf('saveDeliveryRecords('), '저장보다 먼저 확인해야 한다');
  assert.match(complete, /restoreOrderChecks\(checkedUids\)/);
  const inline = extractFunction('saveInlineQty');
  assert.ok(inline.indexOf('ordersChangedSinceLoad(currentDateStr, [uid])') > 0);
  assert.ok(inline.indexOf('ordersChangedSinceLoad(') < inline.indexOf(".collection('orders')"), '저장보다 먼저 확인해야 한다');
  // 주방이 보는 집계 인쇄도 화면 칸 숫자를 쓴다. 인쇄 전에 확인한다.
  const print = extractFunction('printTodayProductionSheet');
  assert.ok(print.indexOf("confirmOrdersFresh('집계 인쇄')") > 0);
  assert.ok(print.indexOf('confirmOrdersFresh(') < print.indexOf('productionOrderRowsForPrint()'), '인쇄할 줄을 만들기 전에 확인해야 한다');
  assert.match(extractFunction('allOrderChangesSinceLoad'), /Object\.keys\(loadedOrderDocs\), \.\.\.Object\.keys\(fresh\)/);
  const load = extractFunction('loadOrders');
  assert.match(load, /loadedOrderDocs = orderDocsFromSnap\(snap\);/);
  assert.match(load, /loadedOrderDocsDate = currentDateStr;/);
  assert.match(extractFunction('mergeOrdersWithDefaults'), /customerChangedAfterDelivery: changedAfterRecord/);
  assert.match(adminSource, /class="order-change-warn"/);
  assert.match(adminSource, /<b>고객 변경 미반영<\/b>/);
});
