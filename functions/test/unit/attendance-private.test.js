'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createPrivateVault, privateInput, privateSummary } = require('../../attendancePrivate');
const crypto = require('node:crypto');
const fixture = { residentNumber: '900101-1234567', bankName: '테스트은행', bankAccount: '001-234-567890', accountHolder: '가상 직원' };

test('identifier input normalizes separators without losing account leading zeroes', () => {
  const value = privateInput(fixture);
  assert.equal(value.residentNumber, '9001011234567');
  assert.equal(value.bankAccount, '001234567890');
  assert.deepEqual(privateSummary(value), { residentRegistered: true, bankName: '테스트은행', bankLast4: '7890', accountHolder: '가상 직원' });
  for (const input of [null, [], { ...fixture, residentNumber: '123' }, { ...fixture, bankAccount: 123456 }, { ...fixture, bankAccount: 'abc12345' }, { ...fixture, bankName: '' }]) assert.throws(() => privateInput(input), { status: 400 });
});

test('private vault authenticates ciphertext and employee identity with a fresh IV per write', () => {
  const key = crypto.randomBytes(32).toString('base64'), vault = createPrivateVault(() => key);
  const value = privateInput(fixture), sealed = vault.seal(value, 'first');
  assert.deepEqual(vault.open(sealed, 'first'), value);
  assert.notEqual(vault.seal(value, 'first').data, sealed.data);
  assert.ok(!JSON.stringify(sealed).includes(value.residentNumber));
  assert.ok(!JSON.stringify(sealed).includes(value.bankAccount));
  assert.throws(() => vault.open(sealed, 'second'), { status: 503 });
  assert.throws(() => vault.open({ ...sealed, tag: Buffer.alloc(16).toString('base64') }, 'first'), { status: 503 });
  assert.throws(() => createPrivateVault(() => '').seal(value, 'first'), { status: 503 });
  assert.throws(() => createPrivateVault(() => crypto.randomBytes(32).toString('base64')).open(sealed, 'first'), { status: 503 });
});
