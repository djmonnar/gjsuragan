'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');

const root = path.resolve(__dirname, '..', '..');
const projectId = 'demo-gjsuragan-safety';
const requireFromFunctions = createRequire(path.join(root, 'functions', 'package.json'));
const { initializeApp, deleteApp } = requireFromFunctions('firebase-admin/app');
const { getFirestore } = requireFromFunctions('firebase-admin/firestore');

process.env.GCLOUD_PROJECT = projectId;
process.env.GOOGLE_CLOUD_PROJECT = projectId;
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';

function price(publicData, privateData, primary, legacy) {
  return Number(privateData?.[primary] ?? publicData?.[primary] ?? privateData?.[legacy] ?? publicData?.[legacy] ?? 8000);
}

async function mergedUser(db, uid) {
  const [publicSnap, privateSnap] = await Promise.all([
    db.collection('users').doc(uid).get(),
    db.collection('userPrivate').doc(uid).get()
  ]);
  assert.equal(publicSnap.exists, true, `Missing public user ${uid}`);
  return { publicData: publicSnap.data() || {}, privateData: privateSnap.exists ? privateSnap.data() || {} : {} };
}

async function main() {
  assert.equal(process.env.GCLOUD_PROJECT, projectId);
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8080');
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) throw new Error('Unexpected credential environment variable.');

  const app = initializeApp({ projectId }, `manual-verify-${Date.now()}`);
  const db = getFirestore(app);
  const expected = [
    ['manual-customer', 8000, 8000],
    ['manual-price-9000', 9000, 9000],
    ['manual-price-zero', 0, 0],
    ['manual-price-legacy', 7500, 7000]
  ];
  for (const [uid, lunch, salad] of expected) {
    const data = await mergedUser(db, uid);
    assert.equal(price(data.publicData, data.privateData, 'lunchPrice', 'priceLunch'), lunch, `${uid} lunch price`);
    assert.equal(price(data.publicData, data.privateData, 'saladPrice', 'priceSalad'), salad, `${uid} salad price`);
  }

  const customerPublic = (await db.collection('users').doc('manual-customer').get()).data() || {};
  for (const field of ['lunchPrice', 'saladPrice', 'priceLunch', 'priceSalad']) {
    assert.equal(Object.hasOwn(customerPublic, field), false, `Default-price customer unexpectedly stores ${field}`);
  }

  const deliveryExpected = {
    'delivery-regular': { remain: 2, status: 'active', delivered: 0 },
    'delivery-staff-once': { remain: 2, status: 'active', delivered: 0 },
    'delivery-map-once': { remain: 2, status: 'active', delivered: 0 },
    'delivery-cancel': { remain: 1, status: 'active', delivered: 1 }
  };
  for (const [id, expectedState] of Object.entries(deliveryExpected)) {
    const snap = await db.collection('customers').doc(id).get();
    assert.equal(snap.exists, true, `Missing delivery fixture ${id}`);
    const data = snap.data() || {};
    assert.equal(data.remain, expectedState.remain, `${id} remain`);
    assert.equal(data.status, expectedState.status, `${id} status`);
    assert.equal((data.deliveredDates || []).length, expectedState.delivered, `${id} deliveredDates`);
  }

  const eventSnap = await db.collection('eventOrders').doc('manual-event-order').get();
  assert.equal(eventSnap.exists, true, 'Missing event-order fixture');
  assert.equal(eventSnap.data().items[0].price, 12300, 'Event price changed unexpectedly');
  await deleteApp(app);

  const response = await fetch('http://127.0.0.1:4173/__safety/status');
  assert.equal(response.ok, true, 'Safety status endpoint is unavailable');
  const status = await response.json();
  assert.equal(status.projectId, projectId);
  assert.equal(status.productionAccess, 'BLOCKED');
  assert.equal(status.blockedRequestCount, 0, `Browser guard blocked ${status.blockedRequestCount} production requests`);

  const credentials = JSON.parse(fs.readFileSync(path.join(root, '.tmp', 'manual-emulator', 'credentials.json'), 'utf8'));
  assert.equal(credentials.projectId, projectId);
  console.log('Emulator baseline verification passed.');
  console.log('Price fixtures: 8000 / 9000 / 0 / legacy 7500+7000');
  console.log('Delivery fixtures: regular / staff once / map once / completed cancellation');
  console.log('Observed production endpoint requests: 0');
}

main().catch(error => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
