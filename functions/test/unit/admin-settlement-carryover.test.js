'use strict';

// 정산 이월(전월 미수금 → 당월 청구) 계산과 저장 규칙이 admin.html 에서 유지되는지 확인한다.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const rootDir = path.resolve(__dirname, '../../..');
const adminSource = fs.readFileSync(path.join(rootDir, 'admin.html'), 'utf8');

function extractFunction(name) {
  const start = adminSource.indexOf(`function ${name}(`);
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

const fieldsConst = adminSource.match(/const SETTLEMENT_CARRYOVER_FIELDS = \[[^\]]*\];/);
assert.ok(fieldsConst, 'SETTLEMENT_CARRYOVER_FIELDS 상수를 찾지 못했습니다.');

const carry = vm.runInNewContext(`(() => {
  const settlementCateringQty = row => Number(row.catering || 0) || 0;
  const settlementCateringAmount = row => Number(row.cateringAmount || 0) || 0;
  const settlementCateringSummary = row => ({ items: row.cateringItems || [], totalQty: 0, totalAmount: 0 });
  ${fieldsConst[0]}
  ${extractFunction('shiftMonthStr')}
  ${extractFunction('prevMonthStr')}
  ${extractFunction('monthLabelKR')}
  ${extractFunction('monthShortKR')}
  ${extractFunction('settlementSalesTotal')}
  ${extractFunction('settlementCarryover')}
  ${extractFunction('settlementUsageDates')}
  ${extractFunction('mergeCarryoverDates')}
  ${extractFunction('carryoverDatesLabel')}
  ${extractFunction('settlementCarryoverMerge')}
  ${extractFunction('settlementCarriedOverAmount')}
  ${extractFunction('settlementBilledTotal')}
  ${extractFunction('settlementPaidTotal')}
  ${extractFunction('settlementBalance')}
  ${extractFunction('settlementOpenBalance')}
  ${extractFunction('settlementOutstandingBalance')}
  ${extractFunction('isSettlementUnpaid')}
  ${extractFunction('isCarriedOverRow')}
  ${extractFunction('settlementEventQty')}
  ${extractFunction('settlementEventUnitPrice')}
  ${extractFunction('settlementCarryoverFields')}
  ${extractFunction('settlementRowSaveData')}
  ${extractFunction('settlementDocData')}
  ${extractFunction('newCarryoverTargetRow')}
  return { prevMonthStr, shiftMonthStr, monthLabelKR, monthShortKR, settlementSalesTotal, settlementBilledTotal,
    settlementBalance, settlementOpenBalance, settlementOutstandingBalance, isSettlementUnpaid, isCarriedOverRow,
    settlementPaidTotal, settlementRowSaveData, settlementDocData, newCarryoverTargetRow,
    settlementUsageDates, carryoverDatesLabel, settlementCarryoverMerge };
})()`);

const august = {
  uid: 'u1', user: { businessName: '가나상사' }, amount: 100000, adjust: 0, status: '청구완료',
  payments: [{ amount: 30000, date: '2026-08-20' }], lunch: 20, lunchPrice: 5000
};
const augustCarried = { ...august, status: '이월', carriedOverTo: '2026-09', carriedOverAmount: 70000, statusBeforeCarryover: '청구완료' };
const september = { uid: 'u1', user: { businessName: '가나상사' }, amount: 50000, adjust: -1000, status: '미정산', payments: [], carryover: 70000, carryoverFrom: '2026-08' };

test('월 계산 도우미는 연도 경계를 넘어간다', () => {
  assert.equal(carry.prevMonthStr('2026-01'), '2025-12');
  assert.equal(carry.prevMonthStr('2026-09'), '2026-08');
  assert.equal(carry.shiftMonthStr('2026-12', 1), '2027-01');
  assert.equal(carry.monthLabelKR('2026-08'), '2026년 8월');
  assert.equal(carry.monthShortKR('2026-08'), '8월');
});

test('이월 전 잔액은 청구액에서 입금을 뺀 값이다', () => {
  assert.equal(carry.settlementBilledTotal(august), 100000);
  assert.equal(carry.settlementBalance(august), 70000);
  assert.equal(carry.settlementOpenBalance(august), 70000);
  assert.equal(carry.isSettlementUnpaid(august), true);
});

test('다음 달로 넘긴 정산은 잔액 0, 미입금 아님, 당월 매출은 그대로', () => {
  assert.equal(carry.settlementBalance(augustCarried), 0);
  assert.equal(carry.settlementOutstandingBalance(augustCarried), 0);
  assert.equal(carry.isSettlementUnpaid(augustCarried), false);
  assert.equal(carry.isCarriedOverRow(augustCarried), true);
  assert.equal(carry.settlementOpenBalance(augustCarried), 70000);
  assert.equal(carry.settlementSalesTotal(augustCarried), 100000);
});

test('이월받은 달은 청구액에 이월액이 더해지고 차트용 매출에는 빠진다', () => {
  assert.equal(carry.settlementBilledTotal(september), 119000);
  assert.equal(carry.settlementSalesTotal(september), 49000);
  assert.equal(carry.settlementBalance(september), 119000);
});

test('입금 이력 없는 입금완료는 이월액까지 완납으로 본다', () => {
  const paid = { ...september, status: '입금완료' };
  assert.equal(carry.settlementPaidTotal(paid), 119000);
  assert.equal(carry.settlementBalance(paid), 0);
});

test('이월 정보를 모르는 저장(자동 반영)은 이월 필드를 쓰지 않는다', () => {
  const doc = carry.settlementDocData({ uid: 'u1', user: {}, lunch: 20, lunchPrice: 5000 }, { status: '청구완료', amount: 100000 });
  assert.equal('carryover' in doc, false);
  assert.equal('carriedOverTo' in doc, false);
});

test('행 저장 데이터는 이월 필드를 실어 나르고 undefined 를 남기지 않는다', () => {
  const data = carry.settlementRowSaveData(september, { carryover: 70000 });
  assert.equal(data.carryover, 70000);
  assert.equal(data.carryoverFrom, '2026-08');
  assert.equal(data.carriedOverTo, '');
  assert.equal(data.carriedOverAmount, 0);
  const doc = carry.settlementDocData(september, data);
  assert.equal(doc.carryover, 70000);
  assert.equal(doc.type, 'customerMonthly');
  for (const [key, value] of Object.entries(doc)) assert.notEqual(value, undefined, `${key} 가 undefined`);
});

test('행사도시락 행에는 이월 필드를 붙이지 않는다', () => {
  const data = carry.settlementRowSaveData({ type: 'event', uid: 'event:1', user: { businessName: 'E' }, amount: 30000, eventLunch: 10, eventPrice: 3000, payments: [] }, { status: '입금완료' });
  assert.equal('carryover' in data, false);
});

test('이월 취소는 원래 상태로 되돌리고 잔액을 살린다', () => {
  const undo = carry.settlementRowSaveData(augustCarried, {
    status: augustCarried.statusBeforeCarryover, statusBeforeCarryover: '', carriedOverTo: '', carriedOverAmount: 0, carriedOverAt: ''
  });
  assert.equal(undo.status, '청구완료');
  assert.equal(carry.settlementBalance(undo), 70000);
});

test('이번 달 주문이 없는 업체는 이월액만 담긴 행으로 만들어진다', () => {
  const target = carry.newCarryoverTargetRow({ uid: 'm1', type: 'manualMonthly', user: { businessName: '비회원' }, lunchPrice: 6000, source: 'excelSettlement' });
  const doc = carry.settlementDocData(target, carry.settlementRowSaveData(target, { carryover: 20000, carryoverFrom: '2026-08' }));
  assert.equal(doc.type, 'manualMonthly');
  assert.equal(doc.manualMonthly, true);
  assert.equal(doc.carryover, 20000);
  assert.equal(doc.businessName, '비회원');
  assert.equal(doc.amount, 0);
});

test('자동 반영과 재계산은 이월 상태와 이월 문서를 보존한다', () => {
  const rebuild = extractFunction('rebuildSettlementsForUids');
  assert.match(rebuild, /hasCarryoverInfo/);
  assert.match(rebuild, /saved\.status === '이월'/);
  assert.match(extractFunction('autoBillCompletedDeliveries'), /saved\.status === '이월'/);
  assert.match(extractFunction('quickSettlePayment'), /settlementBalance\(row\)/);
  assert.match(extractFunction('deleteSettlementRow'), /syncCarryoverSource\(/);
});

test('legacy 정산 복사는 새 경로에 이미 있는 문서를 덮어쓰지 않는다', () => {
  const migrate = extractFunction('migrateLegacySettlementsToNewPath');
  assert.match(migrate, /existingByMonth\[month\]\[doc\.id\]/);
  assert.match(migrate, /skipped \+= 1; continue;/);
});

test('이월액의 이용일은 넘겨준 달 일별 내역 날짜다', () => {
  const prevRow = { dateBreakdown: { '2026-08-12': { lunch: 3 }, '2026-08-04': { lunch: 2 } } };
  assert.deepEqual([...carry.settlementUsageDates(prevRow)], ['2026-08-04', '2026-08-12']);
  // 엑셀 비회원 정산은 daily 에 들어 있다.
  assert.deepEqual([...carry.settlementUsageDates({ daily: { '2026-08-05': {} } })], ['2026-08-05']);
  assert.deepEqual([...carry.settlementUsageDates({})], []);
});

test('정산표 이용일 표기는 월/일, 중복 없이 날짜순이다', () => {
  assert.equal(carry.carryoverDatesLabel(['2026-08-12', '2026-08-04', '2026-08-04', '', null]), '8/4, 8/12');
  assert.equal(carry.carryoverDatesLabel(undefined), '');
});

test('이월 저장 데이터에 이용일이 실린다', () => {
  const data = carry.settlementRowSaveData({ ...september, carryoverDates: ['2026-08-04'] });
  assert.deepEqual([...data.carryoverDates], ['2026-08-04']);
  assert.deepEqual([...data.carryoverFromUids], []);
});

// 2026-09: 당샘내과 수동 행(8월 이월 있음)을 등록 업체로 합쳤더니 이월액이 사라졌다.
// 합치기가 배송기록만 옮기고 이월은 옛 행에 남겨, 배송 0인 옛 행과 함께 화면에서 빠졌다.
test('합치기는 이월액과 이용일을 대상으로 옮기고 옛 행은 비운다', () => {
  const source = { uid: 'manual_1', carryover: 70000, carryoverFrom: '2026-08' };
  const { target, source: cleared } = carry.settlementCarryoverMerge(source, {}, ['2026-08-04', '2026-08-05']);
  assert.equal(target.carryover, 70000);
  assert.equal(target.carryoverFrom, '2026-08');
  assert.deepEqual([...target.carryoverDates], ['2026-08-04', '2026-08-05']);
  assert.deepEqual([...target.carryoverFromUids], ['manual_1']);
  assert.equal(cleared.carryover, 0);
  assert.deepEqual([...cleared.carryoverDates], []);
});

test('대상에 이미 이월이 있으면 금액과 이용일을 더한다', () => {
  const source = { uid: 'manual_1', carryover: 30000, carryoverFrom: '2026-08' };
  const targetSaved = { carryover: 50000, carryoverFrom: '2026-08', carryoverDates: ['2026-08-10'], carryoverFromUids: [] };
  const { target } = carry.settlementCarryoverMerge(source, targetSaved, ['2026-08-04']);
  assert.equal(target.carryover, 80000);
  assert.deepEqual([...target.carryoverDates], ['2026-08-04', '2026-08-10']);
  for (const [key, value] of Object.entries(target)) assert.notEqual(value, undefined, `${key} 가 undefined`);
  assert.equal(Number.isNaN(target.carryover), false);
});

test('합치기와 정산 집계가 이월을 다룬다', () => {
  assert.match(extractFunction('confirmSettlementMerge'), /moveSettlementCarryover\(/);
  // 이월만 남은 행도 합칠 수 있어야 이미 숨은 이월을 되살린다.
  assert.match(extractFunction('openSettlementMergeModal'), /!moves\.length && carryover <= 0/);
  assert.match(extractFunction('computeMonthlySettlementRows'), /carryoverOnlySettlementRows\(/);
  assert.match(extractFunction('syncCarryoverSource'), /sourceUids/);
});

test('배송 없이 이월만 남은 수동·탈퇴 행이 정산에 나온다', () => {
  const rowsFor = vm.runInNewContext(`(() => {
    const allUsers = { 'uid-당샘': { businessName: '당샘내과' } };
    const deletedUsers = { 'uid-탈퇴': { businessName: '떠난업체' } };
    ${fieldsConst[0]}
    ${extractFunction('settlementCarryover')}
    ${extractFunction('mergeCarryoverDates')}
    ${extractFunction('settlementCarryoverFields')}
    ${extractFunction('savedSettlementPayments')}
    ${extractFunction('manualDeliverySettlementRow')}
    ${extractFunction('carryoverOnlySettlementRows')}
    return carryoverOnlySettlementRows;
  })()`);
  const rows = rowsFor({
    manual_1: { type: 'manualOrderMonthly', businessName: '당샘내과', carryover: 70000, carryoverFrom: '2026-08' },
    manual_2: { type: 'manualOrderMonthly', businessName: '이월없음', carryover: 0 },
    'uid-탈퇴': { carryover: 20000, carryoverFrom: '2026-08' },
    'uid-당샘': { carryover: 10000 },
    'excel-1': { type: 'manualMonthly', carryover: 5000 },
    manual_3: { type: 'manualOrderMonthly', carryover: 9000 }
  }, { manual_3: {} });
  const byUid = Object.fromEntries(rows.map(row => [row.uid, row]));
  assert.deepEqual(Object.keys(byUid).sort(), ['manual_1', 'uid-탈퇴']);
  assert.equal(byUid.manual_1.carryover, 70000);
  assert.equal(byUid.manual_1.manualOrder, true);
  assert.equal(byUid.manual_1.user.businessName, '당샘내과');
  assert.equal(byUid['uid-탈퇴'].removedUser, true);
});
