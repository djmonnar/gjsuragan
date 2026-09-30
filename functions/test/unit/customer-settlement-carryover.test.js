'use strict';

// 고객 화면(customer.html 정산 카드·인쇄 정산서, customer-settlement.html 정산표)이
// 관리자가 저장한 이월 내역(carryoverDetail)을 날짜별 수량·금액으로 보여주는지 확인한다.
// 2026-09: 당샘내과 9월 정산서에 8월 이월 64,000원이 며칠에 몇 개였는지 안 나왔다.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const rootDir = path.resolve(__dirname, '../../..');

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

const customerSource = fs.readFileSync(path.join(rootDir, 'customer.html'), 'utf8');
const settlementPageSource = fs.readFileSync(path.join(rootDir, 'customer-settlement.html'), 'utf8');

const customer = vm.runInNewContext(`(() => {
  ${extractFunction(customerSource, 'escapeHtml')}
  ${extractFunction(customerSource, 'customerMonthShort')}
  ${extractFunction(customerSource, 'customerCarryoverDetail')}
  ${extractFunction(customerSource, 'customerCarryoverDetailTable')}
  ${extractFunction(customerSource, 'renderCustomerCarryoverDetail')}
  return { customerCarryoverDetail, customerCarryoverDetailTable, renderCustomerCarryoverDetail };
})()`);

const page = vm.runInNewContext(`(() => {
  ${extractFunction(settlementPageSource, 'carryoverDetailRows')}
  return { carryoverDetailRows };
})()`);

const plain = value => JSON.parse(JSON.stringify(value));

const 당샘9월 = {
  carryover: 64000,
  carryoverFrom: '2026-08',
  carryoverDetail: [
    { kind: 'day', date: '2026-08-31', label: '', lunch: 8, salad: 0, eventLunch: 0, catering: 0, cateringLabel: '', amount: 64000 }
  ]
};

test('고객 앱은 이월 내역을 날짜·수량·금액 표로 보여준다', () => {
  const html = customer.renderCustomerCarryoverDetail(당샘9월);
  assert.match(html, /8월 이월 미수금 내역/);
  assert.match(html, /<td>8\/31<\/td>/);
  assert.match(html, /8개/);
  assert.match(html, /64,000원/);
  assert.match(html, /이월 합계/);
  assert.doesNotMatch(html, /NaN|undefined/);
});

test('입금·조정 맞춤 줄은 이름과 부호가 붙은 금액으로 나온다', () => {
  const html = customer.customerCarryoverDetailTable({
    carryover: 97000,
    carryoverFrom: '2026-08',
    carryoverDetail: [
      { kind: 'day', date: '2026-08-04', lunch: 10, amount: 80000 },
      { kind: 'day', date: '2026-08-05', lunch: 12, salad: 1, amount: 103000 },
      { kind: 'adjust', label: '8월 조정금액', amount: -6000 },
      { kind: 'carryover', label: '7월 이월 미수금', amount: 20000 },
      { kind: 'paid', label: '8월 입금', amount: -100000 }
    ]
  }, { tableClass: 'detail', numClass: 'num' });
  assert.match(html, /8월 입금<\/td>\s*<td class="num">-100,000원/);
  assert.match(html, /7월 이월 미수금<\/td>\s*<td class="num">\+20,000원/);
  assert.match(html, /97,000원/);
});

test('이월이 없거나 내역이 없으면 표를 그리지 않는다', () => {
  assert.equal(customer.renderCustomerCarryoverDetail({}), '');
  assert.equal(customer.renderCustomerCarryoverDetail({ carryover: 64000 }), '');
  assert.equal(customer.renderCustomerCarryoverDetail({ carryover: 0, carryoverDetail: 당샘9월.carryoverDetail }), '');
});

test('이상한 값이 와도 표가 깨지거나 스크립트가 들어가지 않는다', () => {
  const html = customer.renderCustomerCarryoverDetail({
    carryover: 1000,
    carryoverDetail: [
      { kind: 'paid', label: '<img src=x onerror=alert(1)>', amount: 'abc' },
      { kind: 'day', date: 'nope' },
      null
    ]
  });
  assert.doesNotMatch(html, /<img/);
  assert.doesNotMatch(html, /NaN|undefined/);
  assert.deepEqual(plain(customer.customerCarryoverDetail({ carryoverDetail: 'x' })), []);
});

test('고객 정산표 페이지는 이월 날짜 줄을 "도시락 8"처럼 묶어 상세 내역에 넣는다', () => {
  assert.deepEqual(plain(page.carryoverDetailRows(당샘9월.carryoverDetail)), [
    { date: '8/31', item: '도시락 8', qty: 8, amount: 64000 }
  ]);
  assert.deepEqual(plain(page.carryoverDetailRows([
    { kind: 'day', date: '2026-08-05', lunch: 12, salad: 1, amount: 103000 },
    { kind: 'paid', label: '8월 입금', amount: -100000 }
  ])), [
    { date: '8/5', item: '도시락 12 · 샐러드 1', qty: 13, amount: 103000 },
    { date: '', item: '8월 입금', qty: 0, amount: -100000 }
  ]);
  assert.deepEqual(plain(page.carryoverDetailRows(undefined)), []);
});

test('고객 화면들이 이월 내역을 실제로 그린다', () => {
  assert.match(extractFunction(customerSource, 'renderCustomerSettlementDetail'), /renderCustomerCarryoverDetail\(s\)/);
  assert.match(extractFunction(customerSource, 'customerSettlementPrintHtml'), /customerCarryoverDetailTable\(s, \{ tableClass: 'detail', numClass: 'num' \}\)/);
  assert.match(extractFunction(settlementPageSource, 'renderInvoice'), /inv\.carryoverDetail\|\|\[\]/);
});
