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

test('employee screen finishes a one-time remain 2 order', async () => {
  const ref = db.collection('customers').doc('employee-once-complete');
  await ref.set({ remain: 2, deliveredDates: [], status: 'active', orderType: 'once' });
  await runDeliveryTransaction(
    db,
    ref.id,
    '2026-07-10',
    'complete',
    {},
    { completeAllForOnce: true }
  );
  const saved = (await ref.get()).data();
  assert.equal(saved.remain, 0);
  assert.equal(saved.status, 'end');
  assert.deepEqual(saved.deliveredDates, ['2026-07-10']);
});

test('map and imweb complete a one-time remain 2 order by one delivery', async () => {
  const ref = db.collection('customers').doc('map-imweb-once-complete');
  await ref.set({ remain: 2, deliveredDates: [], status: 'active', orderType: 'once' });
  await runDeliveryTransaction(db, ref.id, '2026-07-10', 'complete');
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
