'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const test = require('node:test');
const assert = require('node:assert/strict');

const source = fs.readFileSync(
  path.resolve(__dirname, '../../../assets/js/order-settlement.js'),
  'utf8'
);
const sandbox = {
  productLabel:value => ({A:'A세트',B:'B세트',C:'C세트'}[value] || value || ''),
};
vm.createContext(sandbox);
vm.runInContext(source, sandbox);

test('order amount normalization preserves zero and rejects missing or invalid values', () => {
  assert.equal(sandbox.normalizeOrderAmount('32,900원'), 32900);
  assert.equal(sandbox.normalizeOrderAmount('₩ 243,400'), 243400);
  assert.equal(sandbox.normalizeOrderAmount(0), 0);
  assert.equal(sandbox.normalizeOrderAmount('0'), 0);
  assert.equal(sandbox.normalizeOrderAmount(''), null);
  assert.equal(sandbox.normalizeOrderAmount(null), null);
  assert.equal(sandbox.normalizeOrderAmount('-1000'), null);
  assert.equal(sandbox.normalizeOrderAmount('금액 미정'), null);
});

test('Imweb order amount uses authoritative payment candidates in priority order', () => {
  assert.equal(sandbox.imwebOrderAmount({payment:{payment_amount:'191,200'}}), 191200);
  assert.equal(sandbox.imwebOrderAmount({payment:{pay_price:0},total_price:8000}), 0);
  assert.equal(sandbox.imwebOrderAmount({order_info:{payment:{total_price:'32,900원'}}}), 32900);
  assert.equal(sandbox.imwebOrderAmount({total_amount:'243400'}), 243400);
  assert.equal(sandbox.imwebOrderAmount({price:'8000'}), null);
  assert.equal(sandbox.imwebOrderAmount({}), null);
});

test('monthly settlement groups duplicate Imweb item documents by root order number', () => {
  const rows = sandbox.buildOrderSalesRows([
    {id:'a',orderNum:'202607121234567',orderDate:'2026-07-12',orderAmount:32900,orderSource:'imweb_auto',name:'박철민',productId:'A'},
    {id:'b',orderNum:'202607121234567-001',orderDate:'2026-07-12',orderAmount:32900,orderSource:'imweb_auto',name:'박철민',productId:'B'},
    {id:'c',orderNum:'PHONE-1',orderDate:'2026-07-11',orderAmount:0,orderSource:'manual',name:'전화주문',productId:'C'},
    {id:'d',orderNum:'MISSING-1',orderDate:'2026-07-10',orderSource:'manual',name:'미입력',productId:'A'},
    {id:'e',orderNum:'OLD-1',orderDate:'2026-06-30',orderAmount:50000,orderSource:'manual',name:'지난달',productId:'A'},
  ], '2026-07');

  assert.equal(rows.length, 3);
  const imweb = rows.find(row => row.orderNum === '202607121234567');
  assert.equal(imweb.items.length, 2);
  assert.equal(imweb.amount, 32900);
  assert.equal(imweb.products.join(','), 'A세트,B세트');

  const summary = sandbox.summarizeOrderSales(rows);
  assert.equal(summary.orders, 3);
  assert.equal(summary.knownOrders, 2);
  assert.equal(summary.missingOrders, 1);
  assert.equal(summary.sales, 32900);
  assert.equal(summary.imwebSales, 32900);
  assert.equal(summary.manualSales, 0);
});

test('conflicting amounts for one order are excluded from sales until reviewed', () => {
  const rows = sandbox.buildOrderSalesRows([
    {id:'a',orderNum:'202607121111111',orderDate:'2026-07-12',orderAmount:10000,name:'고객',productId:'A'},
    {id:'b',orderNum:'202607121111111-002',orderDate:'2026-07-12',orderAmount:12000,name:'고객',productId:'B'},
  ], '2026-07');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].amountConflict, true);
  assert.equal(rows[0].amount, null);
  assert.equal(sandbox.summarizeOrderSales(rows).missingOrders, 1);
});

test('settlement month navigation crosses year boundaries and rerenders', () => {
  const monthInput = {value:'2026-01'};
  let renderCount = 0;
  sandbox.document = {getElementById:id => id === 'salesMonth' ? monthInput : null};
  sandbox.todayStr = () => '2026-07-13';
  sandbox.renderOrderSettlement = () => { renderCount++; };

  sandbox.moveOrderSettlementMonth(-1);
  assert.equal(monthInput.value, '2025-12');
  sandbox.moveOrderSettlementMonth(1);
  assert.equal(monthInput.value, '2026-01');
  assert.equal(renderCount, 2);
});
