'use strict';

const crypto = require('node:crypto');
const model = require('./attendanceModel');
const empty = () => ({ residentNumber: '', bankName: '', bankAccount: '', accountHolder: '' });

function privateInput(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) model.fail('직원 개인정보를 확인해 주세요.');
  const residentNumber = model.text(value.residentNumber, '주민등록번호', 20).replace(/[\s-]/g, '');
  const bankAccount = model.text(value.bankAccount, '계좌번호', 50).replace(/[\s-]/g, '');
  const bankName = model.text(value.bankName, '은행명', 40);
  const accountHolder = model.text(value.accountHolder, '예금주', 40);
  if (residentNumber && !/^\d{13}$/.test(residentNumber)) model.fail('주민등록번호 13자리를 입력해 주세요.');
  if (bankAccount && !/^\d{6,30}$/.test(bankAccount)) model.fail('계좌번호를 숫자 6~30자리로 입력해 주세요.');
  if (bankAccount && !bankName) model.fail('계좌의 은행명을 입력해 주세요.');
  return { residentNumber, bankName, bankAccount, accountHolder };
}

function privateSummary(value) {
  return { residentRegistered: Boolean(value.residentNumber), bankName: value.bankName,
    bankLast4: value.bankAccount.slice(-4), accountHolder: value.accountHolder };
}

// The key stays in Secret Manager; Firestore and audit logs never hold plaintext identifiers.
function createPrivateVault(getKey = () => process.env.ATTENDANCE_PRIVATE_KEY) {
  function key() {
    const value = getKey();
    if (typeof value !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(value)) model.fail('개인정보 저장 설정을 확인해 주세요.', 503);
    const bytes = Buffer.from(value, 'base64');
    if (bytes.length !== 32) model.fail('개인정보 저장 설정을 확인해 주세요.', 503);
    return bytes;
  }
  const context = id => Buffer.from(`staffPrivate:v1:${id}`, 'utf8');
  return {
    seal(value, id) {
      const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
      cipher.setAAD(context(id));
      const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
      return { v: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
    },
    open(value, id) {
      if (!value) return empty();
      const bytes = key();
      try {
        if (value.v !== 1) throw new Error('version');
        const decipher = crypto.createDecipheriv('aes-256-gcm', bytes, Buffer.from(value.iv, 'base64'));
        decipher.setAAD(context(id));
        decipher.setAuthTag(Buffer.from(value.tag, 'base64'));
        return privateInput(JSON.parse(Buffer.concat([decipher.update(Buffer.from(value.data, 'base64')), decipher.final()]).toString('utf8')));
      } catch (_) { model.fail('개인정보를 불러오지 못했습니다. 다시 시도해 주세요.', 503); }
    }
  };
}

module.exports = { createPrivateVault, privateInput, privateSummary, empty };
