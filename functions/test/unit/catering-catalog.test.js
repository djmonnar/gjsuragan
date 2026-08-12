'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const catering = require('../../../assets/js/catering-catalog.js');

test('catering catalog exposes stable menu IDs and prices', () => {
  assert.equal(catering.catalog.length, 12);
  assert.deepEqual(catering.getItem('pork-set-9000'), {
    id: 'pork-set-9000',
    name: '제육 한상 (간장, 양념)',
    category: '한상 도시락',
    unitPrice: 9000
  });
  assert.deepEqual(catering.getItem('large-lunch-10000'), {
    id: 'large-lunch-10000',
    name: '곱빼기 도시락',
    category: '도시락',
    unitPrice: 10000
  });
  assert.equal(catering.getItem('unknown-menu'), null);
});

test('catering items normalize known menus and merge duplicate quantities', () => {
  assert.deepEqual(catering.normalizeItems([
    { menuId: 'pork-set-9000', qty: 2 },
    { menuId: 'unknown-menu', qty: 9 },
    { menuId: 'pork-set-9000', qty: 3 },
    { menuId: 'premium-vip-33900', qty: 1 }
  ]), [
    { menuId: 'pork-set-9000', qty: 5 },
    { menuId: 'premium-vip-33900', qty: 1 }
  ]);
});

test('catering summary calculates catalog prices without storing them in customer orders', () => {
  const summary = catering.summarize([
    { menuId: 'pork-set-9000', qty: 2 },
    { menuId: 'chicken-set-9500', qty: 1 }
  ]);
  assert.equal(summary.totalQty, 3);
  assert.equal(summary.totalAmount, 27500);
  assert.deepEqual(summary.items.map(item => item.menuId), ['pork-set-9000', 'chicken-set-9500']);
});

test('catering delivery snapshots preserve historical menu name and unit price', () => {
  const summary = catering.summarize([{
    menuId: 'pork-set-9000',
    name: '이전 제육 도시락',
    unitPrice: 8500,
    qty: 2
  }], { preserveSnapshot: true });
  assert.equal(summary.items[0].name, '이전 제육 도시락');
  assert.equal(summary.items[0].unitPrice, 8500);
  assert.equal(summary.totalAmount, 17000);
});

test('large lunch is split out of catering totals', () => {
  const summary = catering.summarize([
    { menuId: catering.LARGE_LUNCH_MENU_ID, qty: 1 },
    { menuId: 'kimchi-pork-tteokgalbi-14900', qty: 30 }
  ]);
  const split = catering.splitLargeLunch(summary);

  assert.equal(summary.totalQty, 31);
  assert.equal(split.largeLunch.totalQty, 1);
  assert.equal(split.largeLunch.totalAmount, 10000);
  assert.equal(split.catering.totalQty, 30);
  assert.equal(split.catering.totalAmount, 447000);
  assert.equal(split.largeLunch.totalQty + split.catering.totalQty, summary.totalQty);
});

test('split handles empty and catering-only orders', () => {
  const empty = catering.splitLargeLunch(catering.summarize([]));
  assert.equal(empty.largeLunch.totalQty, 0);
  assert.equal(empty.catering.totalQty, 0);

  const cateringOnly = catering.splitLargeLunch(catering.summarize([{ menuId: 'pork-set-9000', qty: 2 }]));
  assert.equal(cateringOnly.largeLunch.totalQty, 0);
  assert.equal(cateringOnly.catering.totalQty, 2);
});
