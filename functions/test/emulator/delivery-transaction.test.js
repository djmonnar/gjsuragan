'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { runDeliveryTransaction } = require('../../../assets/js/delivery-transaction');

const projectId = 'demo-gjsuragan-safety';
let app;
let db;

test.before(() => {
  app = initializeApp({ projectId }, `delivery-transaction-${Date.now()}`);
  db = getFirestore(app);
});

test.after(async () => {
  await deleteApp(app);
});

test('two concurrent completions decrement remain only once', async () => {
  const ref = db.collection('customers').doc('concurrent-complete');
  await ref.set({ remain: 2, deliveredDates: [], status: 'active' });
  const results = await Promise.all([
    runDeliveryTransaction(db, ref.id, '2026-07-10', 'complete'),
    runDeliveryTransaction(db, ref.id, '2026-07-10', 'complete')
  ]);
  const saved = (await ref.get()).data();
  assert.equal(saved.remain, 1);
  assert.deepEqual(saved.deliveredDates, ['2026-07-10']);
  assert.equal(results.filter(result => result.changed).length, 1);
});

test('remain 1 completion ends and never becomes negative', async () => {
  const ref = db.collection('customers').doc('last-complete');
  await ref.set({ remain: 1, deliveredDates: [], status: 'active' });
  await runDeliveryTransaction(db, ref.id, '2026-07-10', 'complete');
  await runDeliveryTransaction(db, ref.id, '2026-07-11', 'complete');
  const saved = (await ref.get()).data();
  assert.equal(saved.remain, 0);
  assert.equal(saved.status, 'end');
  assert.deepEqual(saved.deliveredDates, ['2026-07-10']);
});

// 선택주문은 수량이 몇 개든 한 번의 배송이다. 부르는 화면이 옵션을 주든 안 주든 완료하면 끝난다.
// 예전에는 옵션을 준 직원 화면만 한 번에 끝냈고, 배송지도·아임웹 경로는 1개씩 차감했다.
test('a one-time remain 2 order is finished by one completion with no caller option', async () => {
  const ref = db.collection('customers').doc('once-complete');
  await ref.set({ remain: 2, total: 2, qty: 2, deliveredDates: [], status: 'active', orderType: 'once' });
  await runDeliveryTransaction(db, ref.id, '2026-07-10', 'complete');
  const saved = (await ref.get()).data();
  assert.equal(saved.remain, 0);
  assert.equal(saved.status, 'end');
  assert.deepEqual(saved.deliveredDates, ['2026-07-10']);
});

test('two concurrent completions of a one-time order on different dates record only one', async () => {
  const ref = db.collection('customers').doc('once-concurrent');
  await ref.set({ remain: 2, total: 2, qty: 2, deliveredDates: [], status: 'active', orderType: 'once' });
  const results = await Promise.all([
    runDeliveryTransaction(db, ref.id, '2026-07-10', 'complete'),
    runDeliveryTransaction(db, ref.id, '2026-07-11', 'complete')
  ]);
  const saved = (await ref.get()).data();
  assert.equal(saved.remain, 0);
  assert.equal(saved.status, 'end');
  assert.equal(saved.deliveredDates.length, 1);
  assert.equal(results.filter(result => result.changed).length, 1);
});

test('a subscription still decrements one, and an old caller option changes nothing', async () => {
  const ref = db.collection('customers').doc('sub-with-old-option');
  await ref.set({ remain: 2, total: 4, deliveredDates: [], status: 'active', orderType: 'sub' });
  await runDeliveryTransaction(db, ref.id, '2026-07-10', 'complete', {}, { completeAllForOnce: true });
  const saved = (await ref.get()).data();
  assert.equal(saved.remain, 1);
  assert.equal(saved.status, 'active');
  assert.deepEqual(saved.deliveredDates, ['2026-07-10']);
});

test('two concurrent cancellations restore remain only once', async () => {
  const ref = db.collection('customers').doc('concurrent-cancel');
  await ref.set({ remain: 0, deliveredDates: ['2026-07-10'], status: 'end' });
  const results = await Promise.all([
    runDeliveryTransaction(db, ref.id, '2026-07-10', 'cancel'),
    runDeliveryTransaction(db, ref.id, '2026-07-10', 'cancel')
  ]);
  const saved = (await ref.get()).data();
  assert.equal(saved.remain, 1);
  assert.deepEqual(saved.deliveredDates, []);
  assert.equal(saved.status, 'active');
  assert.equal(results.filter(result => result.changed).length, 1);
});

test('a missing completion date is a no-op even with stale caller state', async () => {
  const ref = db.collection('customers').doc('missing-date');
  await ref.set({ remain: 3, deliveredDates: [], status: 'active' });
  const result = await runDeliveryTransaction(db, ref.id, '2026-07-10', 'cancel');
  const saved = (await ref.get()).data();
  assert.equal(result.changed, false);
  assert.equal(saved.remain, 3);
  assert.deepEqual(saved.deliveredDates, []);
});

test('cancel restores a one-time order to its full quantity (Issue #39)', async () => {
  const ref = db.collection('customers').doc('once-cancel');
  await ref.set({ remain: 2, total: 2, qty: 2, deliveredDates: [], status: 'active', orderType: 'once' });
  await runDeliveryTransaction(db, ref.id, '2026-07-10', 'complete');
  assert.equal((await ref.get()).data().remain, 0);
  await runDeliveryTransaction(db, ref.id, '2026-07-10', 'cancel');
  const saved = (await ref.get()).data();
  // 예전에는 1 이 남아 2개짜리 주문이 1개가 됐다.
  assert.equal(saved.remain, 2);
  assert.equal(saved.status, 'active');
  assert.deepEqual(saved.deliveredDates, []);
});

test('cancel patch tidies the fields written at completion, and only on cancel', async () => {
  const ref = db.collection('customers').doc('cancel-patch');
  await ref.set({ remain: 2, deliveredDates: ['2026-07-03'], status: 'active', orderType: 'sub', lastDeliveredDate: '2026-07-03', deliveryState: 'done' });
  const cancelPatch = (current, patch) => ({ lastDeliveredDate: patch.deliveredDates[patch.deliveredDates.length - 1] || '', seenRemain: current.remain });
  // 완료할 때는 cancelPatch 를 부르지 않는다.
  await runDeliveryTransaction(db, ref.id, '2026-07-10', 'complete', { lastDeliveredDate: '2026-07-10' }, { cancelPatch });
  let saved = (await ref.get()).data();
  assert.equal(saved.lastDeliveredDate, '2026-07-10');
  assert.equal(saved.seenRemain, undefined);
  await runDeliveryTransaction(db, ref.id, '2026-07-10', 'cancel', null, { cancelPatch });
  saved = (await ref.get()).data();
  assert.equal(saved.remain, 2);
  assert.deepEqual(saved.deliveredDates, ['2026-07-03']);
  assert.equal(saved.lastDeliveredDate, '2026-07-03');
  // 취소 직전(완료된 상태)의 문서를 넘겨받는다.
  assert.equal(saved.seenRemain, 1);
});
