'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const lookup = require('../../deliveryLookup');

// customers 는 orderNum 같음 조회만, deliveryLookupLimits 는 get/set 만 흉내 낸다.
function fakeDb(customers = [], limits = {}) {
  const store = { limits: { ...limits } };
  return {
    store,
    collection(name) {
      if (name === 'customers') {
        return {
          where(field, op, value) {
            assert.equal(field, 'orderNum');
            assert.equal(op, '==');
            return {
              limit() {
                return {
                  async get() {
                    const docs = customers
                      .filter(c => c.orderNum === value)
                      .map(c => ({ data: () => c }));
                    return { docs };
                  }
                };
              }
            };
          }
        };
      }
      assert.equal(name, lookup.LIMITS);
      return {
        doc(id) {
          return {
            async get() {
              const value = store.limits[id];
              return { exists: value !== undefined, data: () => value };
            },
            async set(value) { store.limits[id] = value; }
          };
        }
      };
    }
  };
}

const 정기 = {
  orderNum: '202609281234567',
  phone: '010-1234-5678',
  name: '홍길동',
  addr: '서울시 어딘가 1',
  set: 'A',
  orderType: 'sub',
  scheduleName: '월·수·금 조리 → 화·목·토 도착',
  total: 12,
  remain: 9,
  startDate: '2026-09-01',
  deliveredDates: ['2026-09-03', '2026-09-01', '2026-09-05'],
  status: 'active'
};

test('주문번호와 전화번호 뒤 4자리가 맞으면 남은 회차를 돌려준다', async () => {
  const db = fakeDb([정기]);
  const result = await lookup.lookupDelivery(db, { orderNo: ' 202609281234567 ', phoneLast4: '5678' });
  assert.equal(result.orderNo, '202609281234567');
  assert.deepEqual(result.lines, [{
    product: 'A세트',
    scheduleName: '월·수·금 조리 → 화·목·토 도착',
    orderType: 'sub',
    total: 12,
    remain: 9,
    used: 3,
    lastDeliveredDate: '2026-09-05',
    startDate: '2026-09-01',
    status: 'active'
  }]);
});

test('이름·주소·전화번호는 돌려주지 않는다', async () => {
  const result = await lookup.lookupDelivery(fakeDb([정기]), { orderNo: '202609281234567', phoneLast4: '5678' });
  const text = JSON.stringify(result);
  assert.ok(!text.includes('홍길동'));
  assert.ok(!text.includes('서울시'));
  assert.ok(!text.includes('1234-5678'));
});

test('전화번호가 틀리면 주문이 없을 때와 같은 답을 준다', async () => {
  const db = fakeDb([정기]);
  const wrong = await lookup.lookupDelivery(db, { orderNo: '202609281234567', phoneLast4: '0000' }).catch(e => e);
  const missing = await lookup.lookupDelivery(db, { orderNo: '202609289999999', phoneLast4: '5678' }).catch(e => e);
  assert.equal(wrong.status, 404);
  assert.equal(missing.status, 404);
  assert.equal(wrong.message, missing.message);
});

test('한 주문번호에 다섯 번 틀리면 30분 동안 막고, 맞는 번호도 받지 않는다', async () => {
  const db = fakeDb([정기]);
  const now = new Date('2026-09-28T01:00:00Z');
  for (let i = 0; i < lookup.MAX_FAILS; i++) {
    const error = await lookup.lookupDelivery(db, { orderNo: '202609281234567', phoneLast4: String(1000 + i) }, now).catch(e => e);
    assert.equal(error.status, 404);
  }
  const locked = await lookup.lookupDelivery(db, { orderNo: '202609281234567', phoneLast4: '5678' }, now).catch(e => e);
  assert.equal(locked.status, 429);

  const later = new Date(now.getTime() + lookup.LOCK_WINDOW_MS);
  const result = await lookup.lookupDelivery(db, { orderNo: '202609281234567', phoneLast4: '5678' }, later);
  assert.equal(result.lines[0].remain, 9);
});

test('창이 지나면 틀린 횟수를 처음부터 센다', () => {
  const start = { fails: 3, windowStartMs: 0 };
  assert.deepEqual(lookup.nextLimit(start, 1000), { fails: 4, windowStartMs: 0 });
  assert.deepEqual(lookup.nextLimit(start, lookup.LOCK_WINDOW_MS), { fails: 1, windowStartMs: lookup.LOCK_WINDOW_MS });
  assert.deepEqual(lookup.nextLimit(null, 5), { fails: 1, windowStartMs: 5 });
});

test('입력이 모자라면 조회하지 않고 400 을 준다', async () => {
  const db = fakeDb([정기]);
  assert.equal((await lookup.lookupDelivery(db, { orderNo: '', phoneLast4: '5678' }).catch(e => e)).status, 400);
  assert.equal((await lookup.lookupDelivery(db, { orderNo: '202609281234567', phoneLast4: '56' }).catch(e => e)).status, 400);
  assert.equal((await lookup.lookupDelivery(db, { orderNo: '../x', phoneLast4: '5678' }).catch(e => e)).status, 400);
  assert.deepEqual(db.store.limits, {});
});

test('한 주문에 상품 줄이 여러 개면 모두 보여준다', async () => {
  const 둘째 = { ...정기, set: 'B', scheduleName: '화·목 조리', total: 8, remain: 8, deliveredDates: [], startDate: '2026-09-02' };
  const result = await lookup.lookupDelivery(fakeDb([둘째, 정기]), { orderNo: '202609281234567', phoneLast4: '5678' });
  assert.deepEqual(result.lines.map(line => line.product), ['A세트', 'B세트']);
});

test('값이 빠지거나 이상한 문서도 NaN 없이 요약한다', () => {
  const line = lookup.summarizeLine({ total: '', remain: 'abc', deliveredDates: 'x' });
  assert.deepEqual(line, {
    product: '',
    scheduleName: '',
    orderType: 'sub',
    total: 0,
    remain: 0,
    used: 0,
    lastDeliveredDate: '',
    startDate: '',
    status: 'done'
  });
  // 남은 횟수를 전체보다 크게 고쳐둔 문서
  const over = lookup.summarizeLine({ total: 4, remain: 6, status: 'active' });
  assert.equal(over.total, 6);
  assert.equal(over.used, 0);
});

test('상태: 남은 횟수가 없으면 완료, 멈춤·확인 필요면 일시정지', () => {
  assert.equal(lookup.summarizeLine({ total: 12, remain: 0, status: 'active' }).status, 'done');
  assert.equal(lookup.summarizeLine({ total: 12, remain: 3, status: 'pause' }).status, 'pause');
  assert.equal(lookup.summarizeLine({ total: 12, remain: 3, status: 'active', needsReview: true }).status, 'pause');
  assert.equal(lookup.summarizeLine({ total: 1, remain: 1, orderType: 'once', set: 'beef_la' }).product, '양념 LA갈비');
});

test('전화번호는 형식과 상관없이 뒤 4자리로 맞춘다', () => {
  assert.ok(lookup.phoneMatches('010 1234 5678', '5678'));
  assert.ok(lookup.phoneMatches('+82-10-1234-5678', '5678'));
  assert.ok(!lookup.phoneMatches('', '5678'));
  assert.ok(!lookup.phoneMatches('010-1234-5678', ''));
});

test('매뉴얼에 적은 잠금 횟수와 시간이 코드와 같다', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const root = path.resolve(__dirname, '..', '..', '..');
  const minutes = lookup.LOCK_WINDOW_MS / 60000;
  for (const file of ['manual.html', 'imwebmanual.html', 'functions/IMWEB_SYNC_SETUP.md']) {
    const text = fs.readFileSync(path.join(root, file), 'utf8').replace(/<[^>]+>/g, '');
    assert.match(text, new RegExp(`${lookup.MAX_FAILS}번 틀리[^\\n]*${minutes}분`), file);
  }
});
