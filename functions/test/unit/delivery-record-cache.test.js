'use strict';

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

function buildCache() {
  const reads = [];
  const store = {};
  const ref = date => ({
    async get() {
      reads.push(date);
      const records = store[date];
      return { exists: Boolean(records), data: () => ({ records }) };
    }
  });
  const context = vm.runInNewContext(`(() => {
    const deliveryDateCache = new Map();
    const deliveryArchiveCache = new Map();
    const DELIVERY_CACHE_TTL_MS = 15 * 1000;
    const console = { warn() {} };
    ${extractFunction('cacheDeliveryRows')}
    ${extractFunction('cachedDeliveryRows')}
    ${extractFunction('invalidateDeliveryDateCache')}
    async ${extractFunction('readDeliveryDateDoc')}
    return { deliveryDateCache, cacheDeliveryRows, cachedDeliveryRows, invalidateDeliveryDateCache, readDeliveryDateDoc };
  })()`, { Date });
  return { ...context, reads, store, ref };
}

test('같은 날짜를 연달아 읽으면 한 번만 서버에 간다', async () => {
  const cache = buildCache();
  cache.store['2026-08-28'] = { uid1: { delivered: false } };
  const first = await cache.readDeliveryDateDoc('2026-08-28', cache.ref, cache.deliveryDateCache, '신규');
  const second = await cache.readDeliveryDateDoc('2026-08-28', cache.ref, cache.deliveryDateCache, '신규');
  assert.deepEqual(first, { uid1: { delivered: false } });
  assert.equal(second, first);
  assert.deepEqual(cache.reads, ['2026-08-28']);
});

test('다른 기기에서 배송완료를 누른 뒤에는 캐시가 오래됐으면 다시 읽는다', async () => {
  const cache = buildCache();
  const twentySecondsAgo = Date.now() - 20 * 1000;
  cache.cacheDeliveryRows(cache.deliveryDateCache, '2026-08-28', { uid1: { delivered: false } }, twentySecondsAgo);
  cache.store['2026-08-28'] = { uid1: { delivered: true, eventLunchQty: 23 } };
  const rows = await cache.readDeliveryDateDoc('2026-08-28', cache.ref, cache.deliveryDateCache, '신규');
  assert.equal(rows.uid1.delivered, true);
  assert.deepEqual(cache.reads, ['2026-08-28']);
});

test('캐시를 비우면 유효시간이 남았어도 서버 기록을 다시 읽는다', async () => {
  const cache = buildCache();
  cache.cacheDeliveryRows(cache.deliveryDateCache, '2026-08-28', { uid1: { delivered: false } });
  cache.store['2026-08-28'] = { uid1: { delivered: true } };
  cache.invalidateDeliveryDateCache();
  const rows = await cache.readDeliveryDateDoc('2026-08-28', cache.ref, cache.deliveryDateCache, '신규');
  assert.equal(rows.uid1.delivered, true);
});

test('정산 불러오기와 주문 탭은 배송기록 캐시를 비운 뒤 집계한다', () => {
  const loadSettlements = extractFunction('loadSettlements');
  const invalidateAt = loadSettlements.indexOf('invalidateDeliveryDateCache()');
  const loadAt = loadSettlements.indexOf('loadDeliveryRecordsForDates(');
  assert.notEqual(invalidateAt, -1);
  assert.ok(invalidateAt < loadAt, '정산은 캐시를 비운 뒤에 배송기록을 읽어야 한다');

  const loadOrders = extractFunction('loadOrders');
  assert.match(loadOrders, /invalidateDeliveryDateCache\(currentDateStr\)/);
  assert.match(extractFunction('autoBillCompletedDeliveries'), /invalidateDeliveryDateCache\(\)/);
  assert.match(extractFunction('rebuildSettlementsForUids'), /invalidateDeliveryDateCache\(\)/);
});
