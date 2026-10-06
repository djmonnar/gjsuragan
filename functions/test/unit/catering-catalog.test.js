'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const catering = require('../../../assets/js/catering-catalog.js');

test('catering catalog exposes stable menu IDs and prices', () => {
  assert.equal(catering.catalog.length, 13);
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
  assert.deepEqual(catering.getItem('rice-1000'), {
    id: 'rice-1000',
    name: '공기밥',
    category: '추가',
    unitPrice: 1000
  });
  assert.equal(catering.getItem('unknown-menu'), null);
});

test('공기밥과 곱빼기는 총 행사도시락 수량에서 갈라진다', () => {
  const summary = catering.summarize([
    { menuId: 'rice-1000', qty: 3 },
    { menuId: 'large-lunch-10000', qty: 1 },
    { menuId: 'pork-set-9000', qty: 2 }
  ]);
  const split = catering.splitLargeLunch(summary);
  assert.equal(split.rice.totalQty, 3);
  assert.equal(split.rice.totalAmount, 3000);
  assert.equal(split.largeLunch.totalQty, 1);
  assert.equal(split.catering.totalQty, 2, '행사도시락 수량에 공기밥·곱빼기가 섞이지 않는다');
  assert.equal(split.catering.totalAmount, 18000);
});

test('qtyOf 는 특정 메뉴의 수량만 센다', () => {
  const items = [{ menuId: 'rice-1000', qty: 4 }, { menuId: 'pork-set-9000', qty: 2 }];
  assert.equal(catering.qtyOf(items, catering.RICE_MENU_ID), 4);
  assert.equal(catering.qtyOf(items, catering.LARGE_LUNCH_MENU_ID), 0);
  assert.equal(catering.qtyOf([], catering.RICE_MENU_ID), 0);
  assert.equal(catering.qtyOf(null, catering.RICE_MENU_ID), 0);
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
  // 2026-10-07 부터 김치제육&떡갈비는 15,900원
  assert.equal(split.catering.totalAmount, 477000);
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

test('배포본에 실리는 복사본이 원본과 같다', () => {
  // functions/ 밖의 파일은 배포본에 안 들어간다. firebase.json 이 이 폴더만 싣는다.
  // 그래서 화면이 쓰는 assets/js/catering-catalog.js 를 functions/ 로 복사해 두고,
  // 서버는 그 복사본을 쓴다. 두 벌이 갈라지면 태블릿 주방 집계가 화면과 달라진다.
  // 원본을 고쳤으면 functions/ 에서 `npm run build:catering` 을 돌린다.
  const fs = require('node:fs');
  const path = require('node:path');
  const 원본 = fs.readFileSync(path.join(__dirname, '../../../assets/js/catering-catalog.js'), 'utf8');
  const 복사본 = fs.readFileSync(path.join(__dirname, '../../cateringCatalog.js'), 'utf8');
  assert.equal(복사본, 원본, 'functions 에서 npm run build:catering 을 돌려 주세요');
  // 복사본만 따로 불러도 같은 값이 나와야 한다.
  const vendored = require('../../cateringCatalog.js');
  assert.equal(vendored.catalog.length, catering.catalog.length);
  assert.equal(vendored.LARGE_LUNCH_MENU_ID, catering.LARGE_LUNCH_MENU_ID);
  assert.equal(vendored.RICE_MENU_ID, catering.RICE_MENU_ID);
});

// 2026-10 가격 인상. 고객 주문에는 단가가 없어서, 가격만 바꾸면 정산이 안 끝난
// 지난 주문까지 새 가격으로 다시 계산된다. 배송일로 그날의 가격을 고른다.
const 인상 = [
  ['chicken-tteokgalbi-13900', 13900, 14900],
  ['kimchi-pork-tteokgalbi-14900', 14900, 15900],
  ['soy-pork-chicken-15900', 15900, 16900],
  ['grilled-pork-soy-pork-17900', 17900, 18900],
  ['bulgogi-set-18900', 18900, 19900],
  ['bulgogi-fish-19900', 19900, 20900],
  ['eel-abalone-27900', 27900, 28900],
  ['la-galbi-salmon-29900', 29900, 30900],
  ['premium-vip-33900', 33900, 34900]
];

test('10월 6일 배송분까지는 옛 가격, 7일부터 새 가격', () => {
  for (const [id, before, after] of 인상) {
    assert.equal(catering.priceOn(id, '2026-09-15'), before, id);
    assert.equal(catering.priceOn(id, '2026-10-06'), before, id);
    assert.equal(catering.priceOn(id, '2026-10-07'), after, id);
    assert.equal(catering.getItem(id).unitPrice, after, `${id} 지금 가격`);
  }
  // 한상·곱빼기·공기밥은 그대로
  assert.equal(catering.priceOn('pork-set-9000', '2026-09-15'), 9000);
  assert.equal(catering.priceOn('chicken-set-9500', '2026-10-07'), 9500);
  assert.equal(catering.priceOn('rice-1000', '2026-10-07'), 1000);
  // 날짜를 모르면 지금 가격, 없는 메뉴는 0
  assert.equal(catering.priceOn('premium-vip-33900'), 34900);
  assert.equal(catering.priceOn('premium-vip-33900', '어제'), 34900);
  assert.equal(catering.priceOn('unknown', '2026-10-07'), 0);
});

test('단가 없는 지난 주문은 배송일 가격으로, 저장된 단가는 그대로 센다', () => {
  const order = [{ menuId: 'bulgogi-fish-19900', qty: 2 }];
  assert.equal(catering.summarize(order, { preserveSnapshot: true, date: '2026-09-30' }).totalAmount, 39800);
  assert.equal(catering.summarize(order, { preserveSnapshot: true, date: '2026-10-07' }).totalAmount, 41800);
  assert.equal(catering.summarize(order, { date: '2026-09-30' }).totalAmount, 39800);
  // 이미 단가를 적어둔 기록은 날짜와 상관없이 그 단가
  const stored = [{ menuId: 'bulgogi-fish-19900', qty: 2, unitPrice: 19900 }];
  assert.equal(catering.summarize(stored, { preserveSnapshot: true, date: '2026-10-20' }).totalAmount, 39800);
});

test('event-order.html 과 admin.html 의 행사도시락 목록이 카탈로그 가격과 같다', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const root = path.resolve(__dirname, '../../..');
  for (const [file, name] of [['event-order.html', 'EVENT_MENUS'], ['admin.html', 'EVENT_LUNCH_MENUS']]) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    const block = source.slice(source.indexOf(`${name} = [`), source.indexOf('];', source.indexOf(`${name} = [`)));
    for (const menu of catering.catalog.filter(m => !['rice-1000', 'large-lunch-10000'].includes(m.id))) {
      const match = new RegExp(`name: '${menu.name.replace(/[()&]/g, '\\$&')}', price: (\\d+)`).exec(block);
      assert.ok(match, `${file} 에 ${menu.name} 없음`);
      assert.equal(Number(match[1]), menu.unitPrice, `${file} ${menu.name}`);
    }
  }
});
