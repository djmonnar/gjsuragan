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

const settlement = vm.runInNewContext(`(() => {
  const eventCustomerName = item => item.businessName || item.customerName || '행사도시락';
  ${extractFunction('settlementBilledTotal')}
  ${extractFunction('settlementPaidTotal')}
  ${extractFunction('settlementOutstandingBalance')}
  ${extractFunction('isSettlementUnpaid')}
  ${extractFunction('settlementCompanyKey')}
  ${extractFunction('settlementCompanyCount')}
  return { settlementOutstandingBalance, isSettlementUnpaid, settlementCompanyCount };
})()`);

test('미입금 업체는 청구액에서 실제 입금액을 뺀 잔액으로 판단한다', () => {
  assert.equal(settlement.settlementOutstandingBalance({ amount: 100000, status: '청구완료' }), 100000);
  assert.equal(settlement.settlementOutstandingBalance({ amount: 100000, payments: [{ amount: 40000 }] }), 60000);
  assert.equal(settlement.settlementOutstandingBalance({ amount: 100000, payments: [{ amount: 120000 }] }), 0);
  assert.equal(settlement.isSettlementUnpaid({ amount: 100000, payments: [{ amount: 100000 }] }), false);
});

test('입금 이력이 없는 기존 입금완료 정산은 완납으로 유지한다', () => {
  assert.equal(settlement.settlementOutstandingBalance({ amount: 100000, status: '입금완료' }), 0);
  assert.equal(settlement.isSettlementUnpaid({ amount: 100000, status: '입금완료' }), false);
});

test('일반 정산과 행사 정산에 같은 업체가 있으면 한 곳으로 센다', () => {
  const rows = [
    { uid: 'user-1', user: { businessName: '대한민국농수산' } },
    { type: 'event', uid: 'event-1', event: { businessName: '대한민국농수산' } },
    { uid: 'user-2', user: { businessName: '다른 업체' } }
  ];
  assert.equal(settlement.settlementCompanyCount(rows), 2);
});

test('관리자 정산 화면에 미입금 업체 카드와 필터가 연결되어 있다', () => {
  assert.match(adminSource, /id="settle-unpaid-company-count"/);
  assert.match(adminSource, /data-filter="미입금"/);
  assert.match(extractFunction('filterMatchesRow'), /isSettlementUnpaid\(row\)/);
});
