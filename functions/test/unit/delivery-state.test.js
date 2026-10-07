'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { deliveryStatePatch } = require('../../../assets/js/delivery-transaction');

test('regular order remain 2 completion decrements once', () => {
  const result = deliveryStatePatch({ remain: 2, deliveredDates: [], status: 'active' }, '2026-07-10', 'complete');
  assert.deepEqual(result.patch, { remain: 1, deliveredDates: ['2026-07-10'], status: 'active' });
});

test('subscription remain 2 completion decrements once', () => {
  const result = deliveryStatePatch(
    { remain: 2, deliveredDates: [], status: 'active', orderType: 'sub' },
    '2026-07-10',
    'complete'
  );
  assert.deepEqual(result.patch, { remain: 1, deliveredDates: ['2026-07-10'], status: 'active' });
});

test('remain 1 completion ends without becoming negative', () => {
  const result = deliveryStatePatch({ remain: 1, deliveredDates: [], status: 'active' }, '2026-07-10', 'complete');
  assert.deepEqual(result.patch, { remain: 0, deliveredDates: ['2026-07-10'], status: 'end' });
  const noRemaining = deliveryStatePatch({ remain: 0, deliveredDates: [], status: 'end' }, '2026-07-11', 'complete');
  assert.equal(noRemaining.changed, false);
});

// 선택주문은 수량이 몇 개든 한 날짜에 한 번 나가는 배송이다. 부르는 화면과 상관없이 완료하면 끝난다.
// 예전에는 화면이 옵션으로 정해서 배송지도만 1개씩 차감했고, 남은 1개는 어느 목록에도 다시 나오지 않았다.
test('one-time order finishes in one completion whatever the quantity', () => {
  for (const quantity of [1, 2, 5]) {
    const result = deliveryStatePatch(
      { remain: quantity, total: quantity, qty: quantity, deliveredDates: [], status: 'active', orderType: 'once' },
      '2026-07-10',
      'complete'
    );
    assert.deepEqual(result.patch, { remain: 0, deliveredDates: ['2026-07-10'], status: 'end' }, String(quantity));
  }
});

test('a caller can no longer switch the one-time rule on or off', () => {
  const once = { remain: 2, deliveredDates: [], status: 'active', orderType: 'once' };
  const sub = { remain: 2, deliveredDates: [], status: 'active', orderType: 'sub' };
  for (const options of [undefined, {}, { completeAll: false }, { completeAll: true }]) {
    assert.equal(deliveryStatePatch(once, '2026-07-10', 'complete', options).patch.remain, 0);
    assert.equal(deliveryStatePatch(sub, '2026-07-10', 'complete', options).patch.remain, 1);
  }
});

test('one-time order left half-completed by the old rule is closed by the next completion', () => {
  // 실제로 남아 있던 모양: 수량 2개, 4월 20일에 1개만 차감된 채 진행중.
  const stale = { remain: 1, total: 2, qty: 2, deliveredDates: ['2026-04-20'], status: 'active', orderType: 'once' };
  assert.deepEqual(deliveryStatePatch(stale, '2026-04-21', 'complete').patch,
    { remain: 0, deliveredDates: ['2026-04-20', '2026-04-21'], status: 'end' });
  // 같은 날짜를 다시 누르면 이미 완료된 날짜라 바뀌지 않는다.
  assert.equal(deliveryStatePatch(stale, '2026-04-20', 'complete').changed, false);
});

test('same date completion is idempotent', () => {
  const result = deliveryStatePatch({ remain: 1, deliveredDates: ['2026-07-10'], status: 'active' }, '2026-07-10', 'complete');
  assert.deepEqual(result, { changed: false, reason: 'already_completed', patch: null });
});

test('cancellation restores remain only when the date exists', () => {
  const restored = deliveryStatePatch({ remain: 0, deliveredDates: ['2026-07-10'], status: 'end' }, '2026-07-10', 'cancel');
  assert.deepEqual(restored.patch, { remain: 1, deliveredDates: [], status: 'active' });
  const repeated = deliveryStatePatch(restored.patch, '2026-07-10', 'cancel');
  assert.deepEqual(repeated, { changed: false, reason: 'not_completed', patch: null });
});

test('invalid remain is rejected instead of guessing a new value', () => {
  assert.throws(
    () => deliveryStatePatch({ remain: 'invalid', deliveredDates: [] }, '2026-07-10', 'complete'),
    /잔여 횟수/
  );
});

// ── 선택주문 취소와 날짜 구분 (Issue #39) ──
const { deliveryDateKind } = require('../../../assets/js/delivery-transaction');

test('one-time order cancel restores the full quantity the completion consumed', () => {
  // 수량 2개짜리 선택주문. 완료하면 한 번에 끝난다 (잔여 2 → 0).
  const order = { remain: 2, total: 2, deliveredDates: [], status: 'active', orderType: 'once' };
  const completed = deliveryStatePatch(order, '2026-07-10', 'complete');
  assert.deepEqual(completed.patch, { remain: 0, deliveredDates: ['2026-07-10'], status: 'end' });
  // 예전에는 취소가 1만 돌려줘서 2개짜리 주문이 1개로 남았다.
  const restored = deliveryStatePatch({ ...order, ...completed.patch }, '2026-07-10', 'cancel');
  assert.deepEqual(restored.patch, { remain: 2, deliveredDates: [], status: 'active' });
});

test('one-time order decremented one per date still restores exactly one', () => {
  // 예전 배송지도·아임웹 경로는 하루에 한 회씩 차감했다. 그렇게 남은 기록은 취소도 한 회만 돌아와야 한다.
  const afterTwo = { remain: 1, total: 3, deliveredDates: ['2026-07-10', '2026-07-11'], status: 'active', orderType: 'once' };
  assert.deepEqual(deliveryStatePatch(afterTwo, '2026-07-11', 'cancel').patch,
    { remain: 2, deliveredDates: ['2026-07-10'], status: 'active' });
  // 한 회 차감된 뒤 다음 완료가 나머지를 한 번에 끝낸 경우 — 끝낸 몫(2)이 돌아온다.
  const mixed = { remain: 0, total: 3, deliveredDates: ['2026-07-10', '2026-07-11'], status: 'end', orderType: 'once' };
  assert.deepEqual(deliveryStatePatch(mixed, '2026-07-11', 'cancel').patch,
    { remain: 2, deliveredDates: ['2026-07-10'], status: 'active' });
});

test('subscription cancel restores one no matter how large the total is', () => {
  const sub = { remain: 0, total: 12, deliveredDates: ['2026-07-03', '2026-07-10'], status: 'end', orderType: 'sub' };
  assert.deepEqual(deliveryStatePatch(sub, '2026-07-10', 'cancel').patch,
    { remain: 1, deliveredDates: ['2026-07-03'], status: 'active' });
});

test('one-time order without a usable total falls back to restoring one', () => {
  for (const total of [undefined, null, 0, 'abc', -3]) {
    const order = { remain: 0, total, deliveredDates: ['2026-07-10'], status: 'end', orderType: 'once' };
    assert.equal(deliveryStatePatch(order, '2026-07-10', 'cancel').patch.remain, 1, String(total));
  }
});

test('delivery date kind compares calendar dates and rejects malformed input', () => {
  assert.equal(deliveryDateKind('2026-10-06', '2026-10-06'), 'today');
  assert.equal(deliveryDateKind('2026-10-05', '2026-10-06'), 'past');
  // 실제로 있었던 일: 오늘이 10월 6일인데 날짜 칸이 10월 26일이었다.
  assert.equal(deliveryDateKind('2026-10-26', '2026-10-06'), 'future');
  assert.equal(deliveryDateKind('2027-01-01', '2026-12-31'), 'future');
  for (const bad of ['', null, undefined, '2026-10-6', '10/26', 20261026]) {
    assert.equal(deliveryDateKind(bad, '2026-10-06'), 'invalid', String(bad));
  }
});
