'use strict';

// 2026-09-30: 라이브워크·진양호·래디콜 등에서 "6월에 드시지도 않았는데 6월 미납이 있다"는 전화가 왔다.
// 고객 앱은 2026-09-10 부터 최근 12개월 미납을 한꺼번에 보여주는데, 관리자 정산 탭은 한 달씩만 보여서
// 입금 처리를 안 한 지난달이 우리 쪽에서는 안 보였다. 관리자에 같은 12개월을 모아보는 목록을 두고,
// 고객 앱과 관리자가 같은 식으로 잔액을 계산하는지 여기서 고정한다.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const rootDir = path.resolve(__dirname, '../../..');
const adminSource = fs.readFileSync(path.join(rootDir, 'admin.html'), 'utf8');
const customerSource = fs.readFileSync(path.join(rootDir, 'customer.html'), 'utf8');
const settlementPageSource = fs.readFileSync(path.join(rootDir, 'customer-settlement.html'), 'utf8');

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} 함수를 찾지 못했습니다.`);
  let paramsDepth = 0;
  let bodyStart = -1;
  for (let index = source.indexOf('(', start); index < source.length; index += 1) {
    if (source[index] === '(') paramsDepth += 1;
    if (source[index] === ')') {
      paramsDepth -= 1;
      if (paramsDepth === 0) {
        bodyStart = source.indexOf('{', index);
        break;
      }
    }
  }
  let bodyDepth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === '{') bodyDepth += 1;
    if (source[index] === '}') {
      bodyDepth -= 1;
      if (bodyDepth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`${name} 함수 끝을 찾지 못했습니다.`);
}

function constNumber(source, name) {
  const match = source.match(new RegExp(`const ${name} = (\\d+);`));
  assert.ok(match, `${name} 상수를 찾지 못했습니다.`);
  return Number(match[1]);
}

const customer = vm.runInNewContext(`(() => {
  ${extractFunction(customerSource, 'customerSettlementSummary')}
  return { customerSettlementSummary };
})()`);

const admin = vm.runInNewContext(`(() => {
  ${[
    'settlementSalesTotal', 'settlementCarryover', 'settlementCarriedOverAmount', 'settlementBilledTotal',
    'settlementPaidTotal', 'settlementBalance', 'settlementOutstandingBalance',
    'customerVisibleSettlementBalance', 'unpaidOverviewForMonth', 'visibleUnpaidOverviewEntries'
  ].map(name => extractFunction(adminSource, name)).join('\n')}
  return { settlementBalance, customerVisibleSettlementBalance, unpaidOverviewForMonth, visibleUnpaidOverviewEntries };
})()`);

const plain = value => JSON.parse(JSON.stringify(value));

// 고객 앱에 저장되는 정산 문서 모양들
const docs = {
  '입금 안 한 달': { amount: 72000, payments: [] },
  '상태만 입금완료(입금 기록 없음)': { amount: 72000, status: '입금완료', payments: [] },
  '입금 기록이 있으면 상태보다 기록이 먼저': { amount: 72000, status: '입금완료', payments: [{ amount: 30000 }] },
  '예전 입금액(paidAmount)': { amount: 72000, paidAmount: 72000 },
  '입금 기록 합이 0이면 예전 입금액': { amount: 72000, payments: [{ amount: 0 }], paidAmount: 72000 },
  '조정·이월·부분입금': { amount: 500000, adjust: -1000, carryover: 64000, payments: [{ amount: 100000 }] },
  '다음 달로 이월한 달': { amount: 100000, status: '이월', carriedOverTo: '2026-09', carriedOverAmount: 70000, payments: [{ amount: 30000 }] },
  '문자 숫자': { amount: '72000', adjust: '', payments: [{ amount: '72000' }] },
  '빈 문서': {}
};

test('고객 앱과 관리자 복제 식이 같은 잔액을 낸다', () => {
  for (const [name, doc] of Object.entries(docs)) {
    const fromCustomer = customer.customerSettlementSummary(doc).balance;
    const fromAdmin = admin.customerVisibleSettlementBalance(doc);
    assert.equal(fromAdmin, fromCustomer, name);
    assert.equal(Number.isFinite(fromCustomer), true, `${name}: ${fromCustomer}`);
  }
  // 이상한 입금 목록이 와도 깨지지 않는다.
  assert.equal(customer.customerSettlementSummary({ amount: 72000, payments: 'x' }).balance, 72000);
  assert.equal(admin.customerVisibleSettlementBalance({ amount: 72000, payments: 'x' }), 72000);
});

test('고객 앱 잔액은 관리자 정산 탭 잔액(settlementBalance)과 같은 규칙이다', () => {
  for (const [name, doc] of Object.entries(docs)) {
    if (name === '문자 숫자') continue; // 관리자 행은 숫자로 만들어진다.
    assert.equal(customer.customerSettlementSummary(doc).balance, admin.settlementBalance(doc), name);
  }
});

test('상태만 입금완료로 바꾼 달은 고객 앱에서도 완납이다', () => {
  // 관리자 일괄 변경의 "상태만 입금완료"는 입금 기록 없이 저장된다.
  // 예전 고객 앱은 상태를 안 봐서 이런 달을 미납으로 보여줬다.
  const summary = customer.customerSettlementSummary(docs['상태만 입금완료(입금 기록 없음)']);
  assert.equal(summary.balance, 0);
  assert.equal(summary.paidTotal, 72000);
});

const users = {
  live: { businessName: '라이브워크' },
  rad: { businessName: '(주)래디콜' },
  jin: { businessName: '김세은(진양호625)' },
  paid: { businessName: '입금끝난곳' },
  hold: { businessName: '보류한곳' },
  part: { businessName: '일부입금곳' },
  nodoc: { businessName: '문서없는곳' }
};
const row = (uid, extra = {}) => ({
  uid, user: users[uid], lunch: 0, salad: 0, lunchPrice: 8000, saladPrice: 8000,
  amount: 0, adjust: 0, status: '청구완료', payments: [], dueDate: '2026-07-10', ...extra
});

test('라이브워크 6월처럼 입금 처리를 안 한 달은 그대로 미납으로 모인다', () => {
  const saved = { live: { amount: 72000, lunch: 5, salad: 4, status: '청구완료', payments: [], dueDate: '2026-07-10' } };
  const rows = [row('live', { lunch: 5, salad: 4, amount: 72000 })];
  const entries = plain(admin.unpaidOverviewForMonth('2026-06', { users, saved, rows }));
  assert.deepEqual(entries, [{
    month: '2026-06', uid: 'live', name: '라이브워크', adminDue: 72000, customerDue: 72000, dueDate: '2026-07-10', fix: null
  }]);
});

test('배송기록 없이 정산 문서만 남은 달은 고객 앱에만 미납이라 맞추기 대상이다', () => {
  const saved = {
    rad: { amount: 72000, payments: [] },
    part: { amount: 72000, payments: [{ amount: 10000 }] },
    hold: { amount: 72000, status: '보류' }
  };
  const entries = plain(admin.unpaidOverviewForMonth('2026-06', { users, saved, rows: [] }));
  const byUid = Object.fromEntries(entries.map(entry => [entry.uid, entry]));
  // 입금·보류 기록이 없으면 지운다(다시계산과 같은 규칙).
  assert.deepEqual([byUid.rad.fix, byUid.rad.adminDue, byUid.rad.customerDue], ['remove', 0, 72000]);
  // 입금이나 보류 기록이 있으면 지우지 않고 금액만 0으로.
  assert.equal(byUid.part.fix, 'zero');
  assert.equal(byUid.part.customerDue, 62000);
  assert.equal(byUid.hold.fix, 'zero');
});

test('고객 앱 금액과 이 화면 금액이 다르면 이 화면 기준으로 맞춘다', () => {
  // 라이브워크 9월: 고객 앱 640,000원(도시락 52개) / 관리자 632,000원(일반 51개)
  const saved = { live: { amount: 640000, lunch: 52, salad: 28, payments: [] } };
  const rows = [row('live', { lunch: 51, salad: 28, amount: 632000, dueDate: '2026-10-10' })];
  const [entry] = plain(admin.unpaidOverviewForMonth('2026-09', { users, saved, rows }));
  assert.deepEqual([entry.fix, entry.adminDue, entry.customerDue], ['sync', 632000, 640000]);
});

test('이 화면에만 있고 저장된 문서가 없으면 고객 앱에 청구가 안 보이므로 맞추기 대상이다', () => {
  const rows = [row('nodoc', { lunch: 5, amount: 40000 })];
  const [entry] = plain(admin.unpaidOverviewForMonth('2026-08', { users, saved: {}, rows }));
  assert.deepEqual([entry.fix, entry.adminDue, entry.customerDue], ['sync', 40000, 0]);
});

test('양쪽 다 완납이거나 등록 업체가 아니면 목록에 오르지 않는다', () => {
  const saved = {
    paid: { amount: 72000, status: '입금완료', payments: [] },
    manual_1: { amount: 5000 },
    'event:abc': { amount: 30000 }
  };
  const rows = [row('paid', { lunch: 9, amount: 72000, status: '입금완료' })];
  assert.deepEqual(plain(admin.unpaidOverviewForMonth('2026-06', { users, saved, rows })), []);
});

test('기본은 지난달까지 밀린 미납만, 켜면 이번 달도. 고객 앱과 다른 곳은 늘 보인다', () => {
  const entries = [
    { uid: 'live', month: '2026-06', adminDue: 72000, fix: null },
    { uid: 'live', month: '2026-09', adminDue: 632000, fix: 'sync' },
    { uid: 'rad', month: '2026-09', adminDue: 944000, fix: null },
    { uid: 'rad', month: '2026-08', adminDue: 56000, fix: null }
  ];
  const view = (includeCurrent, list = entries) => plain(admin.visibleUnpaidOverviewEntries(list, '2026-09', includeCurrent))
    .map(({ entry, index }) => `${index}:${entry.uid}:${entry.month}`);
  // 래디콜 9월(납부기한 전)은 빠지고, 라이브워크 9월은 금액이 달라 남는다. 버튼이 쓰는 원래 순번을 지킨다.
  assert.deepEqual(view(false), ['0:live:2026-06', '1:live:2026-09', '3:rad:2026-08']);
  assert.deepEqual(view(true), ['0:live:2026-06', '1:live:2026-09', '2:rad:2026-09', '3:rad:2026-08']);
  // 맞추고 나면 이번 달 것은 다시 기본 화면에서 빠진다.
  const fixed = entries.map(entry => (entry.fix ? { ...entry, fixed: true } : entry));
  assert.deepEqual(view(false, fixed), ['0:live:2026-06', '3:rad:2026-08']);
});

test('고객 앱과 같은 12개월을 본다', () => {
  assert.equal(constNumber(adminSource, 'UNPAID_OVERVIEW_MONTH_COUNT'), constNumber(customerSource, 'CUSTOMER_UNPAID_MONTH_COUNT'));
});

test('미납 모아보기가 화면·저장·안내에 이어져 있다', () => {
  assert.match(adminSource, /onclick="openUnpaidOverview\(\)"/);
  assert.match(adminSource, /id="unpaid-overview-modal"/);
  assert.match(extractFunction(adminSource, 'computeMonthlySettlementRows'), /return \{[^}]*settlementItems \}/);
  const load = extractFunction(adminSource, 'loadUnpaidOverview');
  assert.match(load, /unpaidOverviewForMonth\(month, \{ users: allUsers, saved: settlementItems, rows \}\)/);
  // 배송기록을 못 읽은 달을 "고객 앱에만 미납"으로 보고 지우면 안 된다.
  assert.match(load, /hasDelivery/);
  const fix = extractFunction(adminSource, 'applyUnpaidOverviewFix');
  assert.match(fix, /settlementDailyPatch\(row\.dateBreakdown \|\| \{\}, saved\.daily\)/);
  assert.match(fix, /generateInvoiceNo\(entry\.month\)/);
  assert.match(fix, /defaultDueDate\(entry\.month\)/);
  // 맞추기 직전에 그 달을 다시 읽는다.
  assert.match(extractFunction(adminSource, 'fixUnpaidOverviewEntries'), /computeMonthlySettlementRows\(month\)/);
  assert.match(adminSource, /<b>📋 미납 모아보기<\/b>/);
});

test('고객 정산표 페이지도 상태만 입금완료인 달을 완납으로 본다', () => {
  const normalize = extractFunction(settlementPageSource, 'normalizeSettlement');
  assert.match(normalize, /recordedPaid>0\?recordedPaid:legacyPaid>0\?legacyPaid:\(getAny\(d,\['status','settlementStatus','paymentStatus'\]\)==='입금완료'\?total:0\)/);
});

test('배송 화면 날짜를 누르면 어디를 눌러도 달력이 열린다', () => {
  assert.match(adminSource, /id="date-picker" aria-label="날짜 고르기" onclick="openDatePicker\(this\)"/);
  assert.match(extractFunction(adminSource, 'openDatePicker'), /showPicker/);
});
