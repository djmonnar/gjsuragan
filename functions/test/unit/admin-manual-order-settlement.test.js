'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const rootDir = path.resolve(__dirname, '../../..');
const adminSource = fs.readFileSync(path.join(rootDir, 'admin.html'), 'utf8');

function extractFunction(name) {
  const start = adminSource.indexOf(`function ${name}`);
  assert.notEqual(start, -1, `${name} 함수를 찾지 못했습니다.`);
  const paramsStart = adminSource.indexOf('(', start);
  let paramsDepth = 0;
  let bodyStart = -1;
  for (let index = paramsStart; index < adminSource.length; index += 1) {
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

const manualSettlement = vm.runInNewContext(`(() => {
  ${extractFunction('isManualDeliveryRecord')}
  ${extractFunction('savedSettlementPayments')}
  ${extractFunction('manualDeliverySettlementRow')}
  return { isManualDeliveryRecord, manualDeliverySettlementRow };
})()`);

test('회원이 없는 관리자 수기 배송만 비회원 정산 대상으로 본다', () => {
  assert.equal(manualSettlement.isManualDeliveryRecord('manual_123', {}, false), true);
  assert.equal(manualSettlement.isManualDeliveryRecord('custom-id', { adminManual: true }, false), true);
  assert.equal(manualSettlement.isManualDeliveryRecord('custom-id', { source: 'adminManual' }, false), true);
  assert.equal(manualSettlement.isManualDeliveryRecord('member-1', { adminManual: true }, true), false);
  assert.equal(manualSettlement.isManualDeliveryRecord('unknown', { source: 'order' }, false), false);
});

test('비회원 정산 행은 배송 기록의 업체명과 입력 단가를 사용한다', () => {
  const row = manualSettlement.manualDeliverySettlementRow(
    'manual_123',
    {
      businessName: '다함께우미린 돌봄',
      lunchPrice: 8500,
      saladPrice: 8000,
      eventLunchPrice: 12000
    },
    { status: '청구완료', adjust: -500 }
  );
  assert.equal(row.type, 'manualOrderMonthly');
  assert.equal(row.manualOrder, true);
  assert.equal(row.user.businessName, '다함께우미린 돌봄');
  assert.equal(row.lunchPrice, 8500);
  assert.equal(row.saladPrice, 8000);
  assert.equal(row.eventPrice, 12000);
  assert.equal(row.status, '청구완료');
  assert.equal(row.adjust, -500);
});

test('기존 비회원 정산의 입금 기록을 그대로 이어받는다', () => {
  const payments = [{ amount: 50000, date: '2026-08-05', note: '이체' }];
  const current = manualSettlement.manualDeliverySettlementRow('manual_123', {}, { payments });
  assert.deepEqual(JSON.parse(JSON.stringify(current.payments)), payments);

  const legacy = manualSettlement.manualDeliverySettlementRow('manual_123', {}, {
    paidAmount: 30000,
    paidDate: '2026-08-04'
  });
  assert.equal(legacy.payments.length, 1);
  assert.equal(legacy.payments[0].amount, 30000);
});

test('정산 불러오기와 자동 재계산이 비회원 수기 배송을 포함한다', () => {
  const loadSettlementsSource = extractFunction('loadSettlements');
  const autoBillSource = extractFunction('autoBillCompletedDeliveries');
  const rebuildSource = extractFunction('rebuildSettlementsForUids');
  assert.doesNotMatch(loadSettlementsSource, /if \(!allUsers\[uid\]\) return;/);
  assert.match(loadSettlementsSource, /manualDeliverySettlementRow\(uid, data, saved\)/);
  assert.match(autoBillSource, /manualOrderMonthly/);
  assert.match(rebuildSource, /manualOrderMonthly/);
});
