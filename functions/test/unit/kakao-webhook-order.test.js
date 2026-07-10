'use strict';

const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const source = fs.readFileSync(path.resolve(__dirname, '../../index.js'), 'utf8');

test('optional auth gate runs before OCR, Firestore queries, and delivery commands', () => {
  const handlerStart = source.indexOf('async function handleKakaoWebhookRequest');
  const gate = source.indexOf('if (kakaoAuthEnforcementEnabled())', handlerStart);
  const ocr = source.indexOf('kakaoHandleMealOcrFlow(payload, utterance)', handlerStart);
  const customerRead = source.indexOf('kakaoFetchCustomers()', handlerStart);
  const deliveryWrite = source.indexOf('kakaoCompleteDeliveryText(customers, cmd.date)', handlerStart);
  assert.ok(handlerStart >= 0 && gate > handlerStart, 'auth gate must be present in webhook handler');
  assert.ok(gate < ocr, 'auth gate must run before OCR');
  assert.ok(gate < customerRead, 'auth gate must run before customer reads');
  assert.ok(gate < deliveryWrite, 'auth gate must run before delivery writes');
});
