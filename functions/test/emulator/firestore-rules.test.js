'use strict';

const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment
} = require('@firebase/rules-unit-testing');
const {
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc
} = require('firebase/firestore');

const projectId = 'demo-gjsuragan-safety';
const rulesPath = path.resolve(__dirname, '../../../firestore.rules');
const productionRules = fs.readFileSync(rulesPath, 'utf8');
const testAdminEmail = 'admin@example.invalid';
const rules = productionRules.replace(
  /function adminEmails\(\)\s*\{\s*return \[[^\]]*\];\s*\}/,
  `function adminEmails() { return ['${testAdminEmail}']; }`
);
assert.notEqual(rules, productionRules, 'admin email rule must be replaceable in the isolated test rules');

function emulatorAddress() {
  const [host, port] = String(process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080').split(':');
  return { host, port: Number(port) };
}

function validProfile() {
  return {
    businessName: '테스트 업체',
    email: 'owner@example.invalid',
    phone: '01000000000',
    deliveryPlace: '테스트 주소',
    deliveryPlaceDetail: '',
    mealTime: '11:30',
    defaultLunch: 2,
    defaultSalad: 0,
    sameDailyMeal: true,
    sameDailyMealExplicit: true,
    weekdayMeals: {
      mon: { lunch: 2, salad: 0 },
      tue: { lunch: 2, salad: 0 },
      wed: { lunch: 2, salad: 0 },
      thu: { lunch: 2, salad: 0 },
      fri: { lunch: 2, salad: 0 }
    },
    privacyConsent: true,
    privacyConsentAt: serverTimestamp(),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };
}

let env;
test.before(async () => {
  const address = emulatorAddress();
  env = await initializeTestEnvironment({
    projectId,
    firestore: { ...address, rules }
  });
});

test.after(async () => {
  await env.cleanup();
});

test.beforeEach(async () => {
  await env.clearFirestore();
});

test('unauthenticated user cannot create a user profile', async () => {
  const db = env.unauthenticatedContext().firestore();
  await assertFails(setDoc(doc(db, 'users/test-owner'), validProfile()));
});

test('signed-in owner can create a profile without price fields', async () => {
  const db = env.authenticatedContext('test-owner', { email: 'owner@example.invalid' }).firestore();
  await assertSucceeds(setDoc(doc(db, 'users/test-owner'), validProfile()));
});

test('owner cannot set price fields during profile creation', async () => {
  const db = env.authenticatedContext('test-owner', { email: 'owner@example.invalid' }).firestore();
  await assertFails(setDoc(doc(db, 'users/test-owner'), { ...validProfile(), lunchPrice: 8000 }));
});

test('owner cannot update price fields after signup', async () => {
  const db = env.authenticatedContext('test-owner', { email: 'owner@example.invalid' }).firestore();
  await assertSucceeds(setDoc(doc(db, 'users/test-owner'), validProfile()));
  await assertFails(updateDoc(doc(db, 'users/test-owner'), { lunchPrice: 9000 }));
});

test('owner cannot read or update another user profile', async () => {
  await env.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'users/other-owner'), validProfile());
  });
  const db = env.authenticatedContext('test-owner', { email: 'owner@example.invalid' }).firestore();
  await assertFails(getDoc(doc(db, 'users/other-owner')));
  await assertFails(updateDoc(doc(db, 'users/other-owner'), { businessName: '변경 시도' }));
});

test('existing administrator claim can set customer prices', async () => {
  await env.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'users/test-owner'), validProfile());
  });
  const adminDb = env.authenticatedContext('test-admin', { email: testAdminEmail }).firestore();
  await assertSucceeds(updateDoc(doc(adminDb, 'users/test-owner'), {
    lunchPrice: 8000,
    saladPrice: 8000
  }));
});
