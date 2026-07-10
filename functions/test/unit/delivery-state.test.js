'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { deliveryStatePatch } = require('../../../assets/js/delivery-transaction');

test('regular order remain 2 completion decrements once', () => {
  const result = deliveryStatePatch({ remain: 2, deliveredDates: [], status: 'active' }, '2026-07-10', 'complete');
  assert.deepEqual(result.patch, { remain: 1, deliveredDates: ['2026-07-10'], status: 'active' });
});

test('map and imweb one-time order remain 2 completion decrements once', () => {
  const result = deliveryStatePatch(
    { remain: 2, deliveredDates: [], status: 'active', orderType: 'once' },
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

test('existing employee-screen rule can finish a one-time order in one action', () => {
  const result = deliveryStatePatch(
    { remain: 2, deliveredDates: [], status: 'active', orderType: 'once' },
    '2026-07-10',
    'complete',
    { completeAll: true }
  );
  assert.deepEqual(result.patch, { remain: 0, deliveredDates: ['2026-07-10'], status: 'end' });
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
