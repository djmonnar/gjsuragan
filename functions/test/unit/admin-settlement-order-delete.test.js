'use strict';

// 주문을 지우거나 수량을 0으로 만들었을 때, 저장된 정산 문서(settlements/{월}/items/{uid})까지
// 같이 정리되는지 확인한다.
// 관리자 정산 탭은 배송기록에서 매번 다시 집계하지만 고객 화면(customer.html, customer-settlement.html)은
// 저장된 정산 문서를 그대로 읽는다. 이 문서를 안 고치면 관리자 화면에서만 날짜가 빠지고
// 고객 정산표에는 지운 날짜가 계속 남는다.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const rootDir = path.resolve(__dirname, '../../..');
const adminSource = fs.readFileSync(path.join(rootDir, 'admin.html'), 'utf8');

function extractFunction(name) {
  let start = adminSource.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} 함수를 찾지 못했습니다.`);
  // async function 은 async 까지 같이 떼어와야 본문의 await 가 살아난다.
  if (adminSource.slice(start - 6, start) === 'async ') start -= 6;
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

// autoBillCompletedDeliveries 를 실제로 돌려보기 위한 최소 환경.
// deliveryRecords 는 { '2026-09-03': { uid: 기록 } } 모양이다.
function runAutoBill({ deliveryRecords = {}, settlementItems = {}, users = {} } = {}) {
  const deleted = [];
  const written = [];
  const context = {
    console,
    currentDateStr: '2026-09-04',
    adminUid: 'admin-1',
    allUsers: users,
    deletedUsers: {},
    db: { collection: () => ({ doc: () => ({ get: async () => ({ exists: false, data: () => ({}) }) }) }) },
    invalidateDeliveryDateCache() {},
    loadSettlementItems: async () => JSON.parse(JSON.stringify(settlementItems)),
    loadDeliveryRecordsForDates: async () => deliveryRecords,
    monthDates: month => Object.keys(deliveryRecords).filter(ds => ds.startsWith(month)),
    orderLunchQty: record => Number(record.lunchQty || 0) || 0,
    orderSaladQty: record => Number(record.saladQty || 0) || 0,
    orderEventLunchQty: record => Number(record.eventLunchQty || 0) || 0,
    orderEventLunchPrice: record => Number(record.eventLunchPrice || 0) || 0,
    orderLunchPrice: (record, user) => Number(record.lunchPrice ?? user.lunchPrice ?? 0) || 0,
    orderSaladPrice: (record, user) => Number(record.saladPrice ?? user.saladPrice ?? 0) || 0,
    orderCateringSummary: () => ({ totalQty: 0, totalAmount: 0, items: [] }),
    isManualDeliveryRecord: () => false,
    userLunchPrice: user => Number(user.lunchPrice || 0) || 0,
    userSaladPrice: user => Number(user.saladPrice || 0) || 0,
    settlementPaidTotal: saved => Number(saved.paidAmount || 0) || 0,
    settlementCarryover: saved => Number(saved.carryover || 0) || 0,
    settlementLunchAmount: row => (row.lunch || 0) * (row.lunchPrice || 0),
    settlementSaladAmount: row => (row.salad || 0) * (row.saladPrice || 0),
    settlementEventAmount: row => (row.eventLunch || 0) * (row.eventPrice || 0),
    generateInvoiceNo: async () => 'GS-TEST-1',
    defaultDueDate: () => '2026-10-10',
    applySettlementToUserCache() {},
    settlementItemRef: (month, uid) => ({
      delete: async () => { deleted.push(`${month}/${uid}`); }
    }),
    saveSettlementItem: async (month, uid, row, data) => { written.push({ month, uid, row, data }); }
  };
  vm.createContext(context);
  vm.runInContext(extractFunction('autoBillCompletedDeliveries'), context);
  return context.autoBillCompletedDeliveries('2026-09-04', Object.keys(users))
    .then(result => ({ result, deleted, written }));
}

const USER = { 'bareunmom': { businessName: '바른몸한의원', lunchPrice: 8000, saladPrice: 7000 } };

test('배송이 남아 있으면 그 달 정산 문서를 새 합계로 다시 쓴다', async () => {
  const { written, deleted } = await runAutoBill({
    users: USER,
    deliveryRecords: {
      '2026-09-03': { bareunmom: { delivered: true, lunchQty: 5 } },
      '2026-09-04': { bareunmom: { delivered: true, lunchQty: 3 } }
    }
  });
  assert.equal(deleted.length, 0);
  assert.equal(written.length, 1);
  assert.equal(written[0].data.lunch, 8);
  assert.equal(written[0].data.amount, 64000);
});

test('지운 날짜(orderDeleted)는 정산 합계에서 빠진다', async () => {
  const { written } = await runAutoBill({
    users: USER,
    deliveryRecords: {
      '2026-09-03': { bareunmom: { orderDeleted: true, delivered: false, lunchQty: 0 } },
      '2026-09-04': { bareunmom: { delivered: true, lunchQty: 3 } }
    }
  });
  assert.equal(written.length, 1);
  assert.equal(written[0].data.lunch, 3);
  assert.equal(written[0].data.daily['2026-09-03'], undefined);
});

test('그 달 배송이 전부 없어지면 저장된 정산 문서도 지운다', async () => {
  // 고객 화면은 이 문서를 그대로 읽는다. 남겨두면 지운 3일/4일이 고객 정산표에만 계속 보인다.
  const { deleted, written } = await runAutoBill({
    users: USER,
    settlementItems: { bareunmom: { lunch: 8, amount: 64000, status: '청구완료' } },
    deliveryRecords: {
      '2026-09-03': { bareunmom: { orderDeleted: true, delivered: false, lunchQty: 0 } },
      '2026-09-04': { bareunmom: { orderDeleted: true, delivered: false, lunchQty: 0 } }
    }
  });
  assert.deepEqual(deleted, ['2026-09/bareunmom']);
  assert.equal(written.length, 0);
});

test('입금 기록이나 이월 정보가 있으면 배송이 0이어도 정산 문서를 지우지 않는다', async () => {
  const emptyMonth = {
    '2026-09-03': { bareunmom: { orderDeleted: true, delivered: false, lunchQty: 0 } }
  };
  const paid = await runAutoBill({
    users: USER,
    settlementItems: { bareunmom: { amount: 64000, paidAmount: 64000 } },
    deliveryRecords: emptyMonth
  });
  assert.deepEqual(paid.deleted, []);

  const carried = await runAutoBill({
    users: USER,
    settlementItems: { bareunmom: { amount: 64000, carriedOverTo: '2026-10' } },
    deliveryRecords: emptyMonth
  });
  assert.deepEqual(carried.deleted, []);

  const carryover = await runAutoBill({
    users: USER,
    settlementItems: { bareunmom: { amount: 0, carryover: 30000 } },
    deliveryRecords: emptyMonth
  });
  assert.deepEqual(carryover.deleted, []);
});

test('보류 상태 정산은 배송이 0이어도 건드리지 않는다', async () => {
  const { deleted, written, result } = await runAutoBill({
    users: USER,
    settlementItems: { bareunmom: { amount: 64000, status: '보류' } },
    deliveryRecords: {
      '2026-09-03': { bareunmom: { orderDeleted: true, delivered: false, lunchQty: 0 } }
    }
  });
  assert.deepEqual(deleted, []);
  assert.equal(written.length, 0);
  assert.equal(result.skipped, 1);
});

test('주문 삭제와 일괄 입력 0 처리도 저장된 정산 문서를 다시 계산한다', () => {
  // 이 두 곳은 화면(DOM)을 많이 타서 호출 연결만 확인한다.
  const deleteSource = extractFunction('deleteOrderItem');
  assert.match(deleteSource, /rebuildSettlementsForUids\(currentDateStr\.slice\(0, 7\), \[targetUid\]\)/);

  const batchSource = extractFunction('saveBatchEntry');
  assert.match(batchSource, /batchClearedUids\.push\(uid\)/);
  assert.match(batchSource, /rebuildSettlementsForUids\(date\.slice\(0, 7\), batchClearedUids\)/);
});

// 정산 탭의 "다시계산" 버튼. 이미 어긋나 있는 고객 정산표를 관리자가 직접 맞출 때 쓴다.
function runResync(row) {
  const calls = { rebuilt: [], toasts: [], reloaded: 0 };
  const context = {
    console,
    confirm: () => true,
    showToast: msg => calls.toasts.push(msg),
    currentMonthStr: () => '2026-09',
    getSettlementRow: () => row,
    document: { getElementById: () => ({ value: '2026-09' }) },
    loadSettlements: async () => { calls.reloaded += 1; },
    rebuildSettlementsForUids: async (month, uids) => { calls.rebuilt.push([month, uids]); }
  };
  vm.createContext(context);
  vm.runInContext(extractFunction('resyncSettlementRow'), context);
  return uid => context.resyncSettlementRow(uid).then(() => calls);
}

test('정산 다시계산은 그 달 정산을 배송기록 기준으로 새로 쓴다', async () => {
  const calls = await runResync({ uid: 'bareunmom', user: { businessName: '바른몸한의원' } })('bareunmom');
  // vm 안에서 만든 배열이라 구조만 비교한다.
  assert.deepEqual(JSON.parse(JSON.stringify(calls.rebuilt)), [['2026-09', ['bareunmom']]]);
  assert.equal(calls.reloaded, 1);
});

test('배송기록이 없는 엑셀 비회원 정산과 행사도시락은 다시계산하지 않는다', async () => {
  // 엑셀 정산은 배송기록이 없어서 다시 계산하면 0이 되어 문서가 지워진다.
  const manual = await runResync({ uid: 'x', type: 'manualMonthly', user: { businessName: '엑셀업체' } })('x');
  assert.deepEqual(manual.rebuilt, []);

  const event = await runResync(null)('event:evt-1');
  assert.deepEqual(event.rebuilt, []);
});

// ── 전체 다시계산 ──────────────────────────────────────────
// 어느 업체가 어긋났는지 사람이 알 수 없으므로, 저장된 정산 문서를 한꺼번에 훑어서 맞춘다.
function runResyncAll({ stored = {} } = {}) {
  const calls = { rebuilt: [], toasts: [], reloaded: 0, confirmed: '' };
  const context = {
    console,
    confirm: msg => { calls.confirmed = msg; return true; },
    showToast: msg => calls.toasts.push(msg),
    currentMonthStr: () => '2026-09',
    document: { getElementById: () => ({ value: '2026-09' }) },
    loadSettlementItems: async () => stored,
    loadSettlements: async () => { calls.reloaded += 1; },
    rebuildSettlementsForUids: async (month, uids) => {
      calls.rebuilt.push({ month, uids: [...uids] });
      return { checked: uids.length, changed: 2, removed: 1 };
    }
  };
  vm.createContext(context);
  vm.runInContext(extractFunction('resyncAllSettlements'), context);
  return context.resyncAllSettlements().then(() => calls);
}

test('전체 다시계산은 저장된 정산 문서가 있는 업체만 대상으로 한다', async () => {
  // 저장된 문서가 없던 업체까지 새로 만들면, 고객 화면에 없던 청구가 갑자기 뜬다.
  const calls = await runResyncAll({
    stored: {
      bareunmom: { lunch: 8, amount: 64000 },
      dolbom: { lunch: 3, amount: 24000 }
    }
  });
  assert.equal(calls.rebuilt.length, 1);
  assert.equal(calls.rebuilt[0].month, '2026-09');
  assert.deepEqual([...calls.rebuilt[0].uids].sort(), ['bareunmom', 'dolbom']);
  assert.equal(calls.reloaded, 1);
  assert.match(calls.toasts.join(' '), /3곳 바로잡았습니다/);
});

test('전체 다시계산에서 행사도시락과 엑셀 비회원 정산은 빠진다', async () => {
  const calls = await runResyncAll({
    stored: {
      bareunmom: { lunch: 8 },
      excelbiz: { type: 'manualMonthly', lunch: 5 },
      excelbiz2: { manualMonthly: true, lunch: 5 },
      'event_abc': { type: 'event', eventLunch: 20 }
    }
  });
  assert.deepEqual([...calls.rebuilt[0].uids], ['bareunmom']);
});

test('다시 계산할 정산이 없으면 아무것도 쓰지 않는다', async () => {
  const calls = await runResyncAll({ stored: {} });
  assert.deepEqual(calls.rebuilt, []);
  assert.equal(calls.reloaded, 0);
  assert.match(calls.toasts.join(' '), /다시 계산할 정산이 없습니다/);
});

test('보류 상태 정산은 다시 계산해도 상태를 유지하고 지우지 않는다', async () => {
  // 보류는 사람이 일부러 잡아둔 상태다. 전체 다시계산이 이걸 청구완료로 바꾸면 안 된다.
  const rebuildSource = extractFunction('rebuildSettlementsForUids');
  assert.match(rebuildSource, /const onHold = saved\.status === '보류';/);
  assert.match(rebuildSource, /!hasCarryoverInfo && !onHold/);
  assert.match(rebuildSource, /saved\.status === '이월' \|\| onHold/);
});
