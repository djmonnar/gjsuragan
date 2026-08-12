(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.GJS_CATERING = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const LARGE_LUNCH_MENU_ID = 'large-lunch-10000';

  const catalog = Object.freeze([
    { id: LARGE_LUNCH_MENU_ID, name: '곱빼기 도시락', category: '도시락', unitPrice: 10000 },
    { id: 'pork-set-9000', name: '제육 한상 (간장, 양념)', category: '한상 도시락', unitPrice: 9000 },
    { id: 'chicken-set-9500', name: '순살닭구이 한상', category: '한상 도시락', unitPrice: 9500 },
    { id: 'chicken-tteokgalbi-13900', name: '양념닭구이&떡갈비', category: '한정식', unitPrice: 13900 },
    { id: 'kimchi-pork-tteokgalbi-14900', name: '김치제육&떡갈비', category: '한정식', unitPrice: 14900 },
    { id: 'soy-pork-chicken-15900', name: '간장제육&양념닭구이', category: '한정식', unitPrice: 15900 },
    { id: 'grilled-pork-soy-pork-17900', name: '직화제육&간장제육 한정식', category: '한정식', unitPrice: 17900 },
    { id: 'bulgogi-set-18900', name: '소불고기 한정식', category: '한정식', unitPrice: 18900 },
    { id: 'bulgogi-fish-19900', name: '소불고기&생선구이 한정식', category: '한정식', unitPrice: 19900 },
    { id: 'eel-abalone-27900', name: '프리미엄 장어구이&전복', category: '프리미엄', unitPrice: 27900 },
    { id: 'la-galbi-salmon-29900', name: '프리미엄 LA갈비&연어스테이크', category: '프리미엄', unitPrice: 29900 },
    { id: 'premium-vip-33900', name: '프리미엄 VIP 도시락', category: '프리미엄', unitPrice: 33900 }
  ].map(Object.freeze));

  const catalogById = new Map(catalog.map(item => [item.id, item]));

  function getItem(menuId) {
    return catalogById.get(String(menuId || '').trim()) || null;
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
      const unitPrice = preserveSnapshot && Number.isFinite(Number(snapshot.unitPrice))
        ? Math.max(0, Number(snapshot.unitPrice))
        : menu.unitPrice;
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

  function splitLargeLunch(summary) {
    const items = Array.isArray(summary?.items) ? summary.items : [];
    return {
      largeLunch: totalsOf(items.filter(isLargeLunchItem)),
      catering: totalsOf(items.filter(item => !isLargeLunchItem(item)))
    };
  }

  return Object.freeze({
    catalog,
    getItem,
    normalizeItems,
    summarize,
    splitLargeLunch,
    LARGE_LUNCH_MENU_ID
  });
});
