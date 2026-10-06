(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.GJS_CATERING = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const LARGE_LUNCH_MENU_ID = 'large-lunch-10000';
  // 2026-10 가격 인상. 이 날까지 배송분은 옛 가격(previousPrices)으로 센다.
  // 고객 주문에는 메뉴와 수량만 저장되고 단가는 없다. 가격만 바꾸면 아직 정산이 안 끝난
  // 지난 주문까지 새 가격으로 다시 계산돼 정산서 금액이 움직인다.
  // 메뉴 id 에 옛 가격이 들어 있지만 id 는 바꾸지 않는다. 기존 주문과 규칙이 id 로 찾는다.
  const OLD_PRICE_UNTIL = '2026-10-06';
  const RICE_MENU_ID = 'rice-1000';

  const catalog = Object.freeze([
    { id: RICE_MENU_ID, name: '공기밥', category: '추가', unitPrice: 1000 },
    { id: LARGE_LUNCH_MENU_ID, name: '곱빼기 도시락', category: '도시락', unitPrice: 10000 },
    { id: 'pork-set-9000', name: '제육 한상 (간장, 양념)', category: '한상 도시락', unitPrice: 9000 },
    { id: 'chicken-set-9500', name: '순살닭구이 한상', category: '한상 도시락', unitPrice: 9500 },
    { id: 'chicken-tteokgalbi-13900', name: '양념닭구이&떡갈비', category: '한정식', unitPrice: 14900, previousPrices: [{ until: OLD_PRICE_UNTIL, unitPrice: 13900 }] },
    { id: 'kimchi-pork-tteokgalbi-14900', name: '김치제육&떡갈비', category: '한정식', unitPrice: 15900, previousPrices: [{ until: OLD_PRICE_UNTIL, unitPrice: 14900 }] },
    { id: 'soy-pork-chicken-15900', name: '간장제육&양념닭구이', category: '한정식', unitPrice: 16900, previousPrices: [{ until: OLD_PRICE_UNTIL, unitPrice: 15900 }] },
    { id: 'grilled-pork-soy-pork-17900', name: '직화제육&간장제육 한정식', category: '한정식', unitPrice: 18900, previousPrices: [{ until: OLD_PRICE_UNTIL, unitPrice: 17900 }] },
    { id: 'bulgogi-set-18900', name: '소불고기 한정식', category: '한정식', unitPrice: 19900, previousPrices: [{ until: OLD_PRICE_UNTIL, unitPrice: 18900 }] },
    { id: 'bulgogi-fish-19900', name: '소불고기&생선구이 한정식', category: '한정식', unitPrice: 20900, previousPrices: [{ until: OLD_PRICE_UNTIL, unitPrice: 19900 }] },
    { id: 'eel-abalone-27900', name: '프리미엄 장어구이&전복', category: '프리미엄', unitPrice: 28900, previousPrices: [{ until: OLD_PRICE_UNTIL, unitPrice: 27900 }] },
    { id: 'la-galbi-salmon-29900', name: '프리미엄 LA갈비&연어스테이크', category: '프리미엄', unitPrice: 30900, previousPrices: [{ until: OLD_PRICE_UNTIL, unitPrice: 29900 }] },
    { id: 'premium-vip-33900', name: '프리미엄 VIP 도시락', category: '프리미엄', unitPrice: 34900, previousPrices: [{ until: OLD_PRICE_UNTIL, unitPrice: 33900 }] }
  ].map(item => Object.freeze(item.previousPrices
    ? { ...item, previousPrices: Object.freeze(item.previousPrices.map(Object.freeze)) }
    : item)));

  const catalogById = new Map(catalog.map(item => [item.id, item]));

  function getItem(menuId) {
    return catalogById.get(String(menuId || '').trim()) || null;
  }

  // 그 날짜(배송일, YYYY-MM-DD)의 단가. 날짜를 모르면 지금 가격이다.
  function priceOn(menuId, date) {
    const menu = getItem(menuId);
    if (!menu) return 0;
    const day = String(date || '');
    if (/^\d{4}-\d{2}-\d{2}$/.test(day)) {
      const old = (menu.previousPrices || [])
        .filter(entry => day <= entry.until)
        .sort((a, b) => a.until.localeCompare(b.until))[0];
      if (old) return old.unitPrice;
    }
    return menu.unitPrice;
  }

  function normalizeQty(value) {
    const qty = Number(value);
    return Number.isInteger(qty) && qty > 0 ? Math.min(qty, 50) : 0;
  }

  function normalizeItems(items) {
    const totals = new Map();
    (Array.isArray(items) ? items : []).forEach(item => {
      const menu = getItem(item?.menuId);
      const qty = normalizeQty(item?.qty);
      if (!menu || !qty) return;
      totals.set(menu.id, Math.min(50, (totals.get(menu.id) || 0) + qty));
    });
    return catalog
      .filter(menu => totals.has(menu.id))
      .map(menu => ({ menuId: menu.id, qty: totals.get(menu.id) }));
  }

  function summarize(items, options) {
    const preserveSnapshot = options?.preserveSnapshot === true;
    const rawById = new Map(
      (Array.isArray(items) ? items : [])
        .filter(item => getItem(item?.menuId))
        .map(item => [String(item.menuId), item])
    );
    const normalized = normalizeItems(items);
    const details = normalized.map(item => {
      const menu = getItem(item.menuId);
      const snapshot = rawById.get(item.menuId) || {};
      // 저장해 둔 단가가 있으면 그대로, 없으면 그 배송일의 가격.
      const unitPrice = preserveSnapshot && Number.isFinite(Number(snapshot.unitPrice))
        ? Math.max(0, Number(snapshot.unitPrice))
        : priceOn(menu.id, options?.date);
      const name = preserveSnapshot && String(snapshot.name || '').trim()
        ? String(snapshot.name).trim()
        : menu.name;
      const amount = unitPrice * item.qty;
      return {
        menuId: menu.id,
        name,
        category: menu.category,
        unitPrice,
        qty: item.qty,
        amount
      };
    });
    return {
      items: details,
      totalQty: details.reduce((sum, item) => sum + item.qty, 0),
      totalAmount: details.reduce((sum, item) => sum + item.amount, 0)
    };
  }

  // 곱빼기 도시락은 카탈로그로 주문받지만 집계는 행사도시락과 분리한다.
  function isLargeLunchItem(item) {
    return String(item?.menuId || '') === LARGE_LUNCH_MENU_ID;
  }

  function totalsOf(items) {
    return {
      items,
      totalQty: items.reduce((sum, item) => sum + item.qty, 0),
      totalAmount: items.reduce((sum, item) => sum + item.amount, 0)
    };
  }

  function isRiceItem(item) {
    return String(item?.menuId || '') === RICE_MENU_ID;
  }

  // 곱빼기 도시락과 공기밥은 행사도시락이 아니다.
  // 주방이 따로 세어야 해서 총 행사도시락 수량에 섞이지 않게 갈라 놓는다.
  function splitLargeLunch(summary) {
    const items = Array.isArray(summary?.items) ? summary.items : [];
    return {
      largeLunch: totalsOf(items.filter(isLargeLunchItem)),
      rice: totalsOf(items.filter(isRiceItem)),
      catering: totalsOf(items.filter(item => !isLargeLunchItem(item) && !isRiceItem(item)))
    };
  }

  function qtyOf(items, menuId) {
    return (Array.isArray(items) ? items : [])
      .filter(item => String(item?.menuId || '') === menuId)
      .reduce((sum, item) => sum + (Number(item?.qty) || 0), 0);
  }

  return Object.freeze({
    catalog,
    getItem,
    priceOn,
    normalizeItems,
    summarize,
    splitLargeLunch,
    qtyOf,
    LARGE_LUNCH_MENU_ID,
    RICE_MENU_ID
  });
});
