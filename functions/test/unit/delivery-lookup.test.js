'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const lookup = require('../../deliveryLookup');

// customers 는 phone·ordererPhone in 조회만, deliveryLookupLimits 는 get/set 만 흉내 낸다.
function fakeDb(customers = []) {
  const store = { limits: {}, queries: [] };
  return {
    store,
    collection(name) {
      if (name === 'customers') {
        return {
          where(field, op, values) {
            assert.ok(['phone', 'ordererPhone'].includes(field));
            assert.equal(op, 'in');
            assert.ok(values.length <= 30, 'Firestore in 은 30개까지');
            store.queries.push(values);
            return {
              limit() {
                return {
                  async get() {
                    const docs = customers
                      .map((c, i) => ({ id: `doc${i}`, c }))
                      .filter(({ c }) => values.includes(c[field]))
                      .map(({ id, c }) => ({ id, data: () => c }));
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
  orderDate: '2026-08-30',
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

const 손님 = { name: '홍길동', phone: '01012345678' };

test('이름과 전화번호가 맞으면 남은 회차를 돌려준다', async () => {
  const result = await lookup.lookupDelivery(fakeDb([정기]), 손님);
  assert.deepEqual(result, {
    hiddenCount: 0,
    lines: [{
      product: 'A세트',
      scheduleName: '월·수·금 조리 → 화·목·토 도착',
      orderType: 'sub',
      orderDate: '2026-08-30',
      total: 12,
      remain: 9,
      used: 3,
      lastDeliveredDate: '2026-09-05',
      startDate: '2026-09-01',
      status: 'active'
    }]
  });
});

test('이름 띄어쓰기와 전화번호 적는 법이 달라도 찾는다', async () => {
  const 붙여쓴번호 = { ...정기, phone: '01012345678' };
  const db = fakeDb([붙여쓴번호]);
  const result = await lookup.lookupDelivery(db, { name: ' 홍 길동 ', phone: '010-1234-5678' });
  assert.equal(result.lines.length, 1);
  const 국가번호 = await lookup.lookupDelivery(fakeDb([정기]), { name: '홍길동', phone: '+82 10 1234 5678' });
  assert.equal(국가번호.lines.length, 1);
});

test('문서에 흔히 적히는 전화번호 모양을 모두 찾는다', () => {
  assert.deepEqual(lookup.phoneVariants('01012345678').sort(), [
    '010 1234 5678', '010-1234-5678', '010.1234.5678', '01012345678'
  ].sort());
  const ten = lookup.phoneVariants('0111234567');
  assert.ok(ten.includes('011-123-4567'));
  assert.ok(ten.includes('0111234567'));
});

test('주소·전화번호·주문번호는 돌려주지 않는다', async () => {
  const text = JSON.stringify(await lookup.lookupDelivery(fakeDb([정기]), 손님));
  assert.ok(!text.includes('서울시'));
  assert.ok(!text.includes('5678'));
  assert.ok(!text.includes('202609281234567'));
});

test('선물 주문은 주문자 이름·번호로 찾는다', async () => {
  const 선물 = { ...정기, name: '차진', phone: '010-4146-8860', ordererName: '홍길동', ordererPhone: '010-1234-5678' };
  const result = await lookup.lookupDelivery(fakeDb([선물]), 손님);
  assert.equal(result.lines.length, 1);
  // 받는 분도 자기 이름·번호로 볼 수 있다.
  const 받는분 = await lookup.lookupDelivery(fakeDb([선물]), { name: '차진', phone: '01041468860' });
  assert.equal(받는분.lines.length, 1);
  // 주문자 이름에 받는 분 번호처럼 쌍을 섞으면 찾지 않는다.
  const 섞음 = await lookup.lookupDelivery(fakeDb([선물]), { name: '홍길동', phone: '01041468860' }).catch(e => e);
  assert.equal(섞음.status, 404);
});

test('주문자와 받는 분이 같은 주문은 한 번만 보여준다', async () => {
  const 본인 = { ...정기, ordererName: '홍길동', ordererPhone: '01012345678' };
  const result = await lookup.lookupDelivery(fakeDb([본인]), 손님);
  assert.equal(result.lines.length, 1);
});

test('같은 번호라도 이름이 다르면 없는 번호와 같은 답을 준다', async () => {
  const db = fakeDb([정기]);
  const wrongName = await lookup.lookupDelivery(db, { name: '김철수', phone: '01012345678' }).catch(e => e);
  const missing = await lookup.lookupDelivery(db, { name: '홍길동', phone: '01099998888' }).catch(e => e);
  assert.equal(wrongName.status, 404);
  assert.equal(missing.status, 404);
  assert.equal(wrongName.message, missing.message);
});

test('한 번호로 다섯 번 틀리면 30분 동안 막고, 맞는 이름도 받지 않는다', async () => {
  const db = fakeDb([정기]);
  const now = new Date('2026-09-28T01:00:00Z');
  for (let i = 0; i < lookup.MAX_FAILS; i++) {
    const error = await lookup.lookupDelivery(db, { name: `틀림${i}`, phone: '01012345678' }, { now }).catch(e => e);
    assert.equal(error.status, 404);
  }
  const locked = await lookup.lookupDelivery(db, 손님, { now }).catch(e => e);
  assert.equal(locked.status, 429);

  const later = new Date(now.getTime() + lookup.LOCK_WINDOW_MS);
  const result = await lookup.lookupDelivery(db, 손님, { now: later });
  assert.equal(result.lines[0].remain, 9);
});

test('한 곳(IP)에서 여러 번호를 넣어보면 그곳을 막는다', async () => {
  const db = fakeDb([정기]);
  const now = new Date('2026-09-28T01:00:00Z');
  for (let i = 0; i < lookup.MAX_FAILS_PER_IP; i++) {
    const phone = `0101111${String(i).padStart(4, '0')}`;
    await lookup.lookupDelivery(db, { name: '홍길동', phone }, { now, ip: '1.2.3.4' }).catch(e => e);
  }
  const locked = await lookup.lookupDelivery(db, 손님, { now, ip: '1.2.3.4' }).catch(e => e);
  assert.equal(locked.status, 429);
  // 다른 곳에서는 그대로 조회된다.
  const other = await lookup.lookupDelivery(db, 손님, { now, ip: '5.6.7.8' });
  assert.equal(other.lines.length, 1);
});

test('창이 지나면 틀린 횟수를 처음부터 센다', () => {
  const start = { fails: 3, windowStartMs: 0 };
  assert.deepEqual(lookup.nextLimit(start, 1000), { fails: 4, windowStartMs: 0 });
  assert.deepEqual(lookup.nextLimit(start, lookup.LOCK_WINDOW_MS), { fails: 1, windowStartMs: lookup.LOCK_WINDOW_MS });
  assert.deepEqual(lookup.nextLimit(null, 5), { fails: 1, windowStartMs: 5 });
});

test('입력이 모자라면 조회하지 않고 400 을 준다', async () => {
  const db = fakeDb([정기]);
  assert.equal((await lookup.lookupDelivery(db, { name: '', phone: '01012345678' }).catch(e => e)).status, 400);
  assert.equal((await lookup.lookupDelivery(db, { name: '홍길동', phone: '5678' }).catch(e => e)).status, 400);
  assert.equal((await lookup.lookupDelivery(db, { name: '홍길동', phone: '0212345678' }).catch(e => e)).status, 400);
  assert.deepEqual(db.store.limits, {});
  assert.deepEqual(db.store.queries, []);
});

test('진행 중인 주문을 먼저, 그 안에서는 최근 주문을 먼저 보여준다', async () => {
  const 끝난것 = { ...정기, set: 'C', remain: 0, status: 'end', orderDate: '2026-09-20' };
  const 옛것 = { ...정기, set: 'B', orderDate: '2026-07-01' };
  const 멈춤 = { ...정기, set: 'beef_la', orderType: 'once', total: 1, remain: 1, status: 'pause', orderDate: '2026-09-25' };
  const result = await lookup.lookupDelivery(fakeDb([끝난것, 옛것, 멈춤, 정기]), 손님);
  assert.deepEqual(result.lines.map(line => line.product), ['A세트', 'B세트', '양념 LA갈비', 'C세트']);
});

test(`주문이 많으면 ${lookup.MAX_LINES}건까지만 보여주고 나머지 수를 알려준다`, async () => {
  const many = Array.from({ length: lookup.MAX_LINES + 3 }, (_, i) => ({
    ...정기, orderDate: `2026-01-${String(i + 1).padStart(2, '0')}`
  }));
  const result = await lookup.lookupDelivery(fakeDb(many), 손님);
  assert.equal(result.lines.length, lookup.MAX_LINES);
  assert.equal(result.hiddenCount, 3);
});

test('값이 빠지거나 이상한 문서도 NaN 없이 요약한다', () => {
  const line = lookup.summarizeLine({ total: '', remain: 'abc', deliveredDates: 'x', orderDate: '어제' });
  assert.deepEqual(line, {
    product: '',
    scheduleName: '',
    orderType: 'sub',
    orderDate: '',
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

test('매뉴얼에 적은 잠금 횟수와 시간이 코드와 같다', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const root = path.resolve(__dirname, '..', '..', '..');
  const minutes = lookup.LOCK_WINDOW_MS / 60000;
  for (const file of ['manual.html', 'imwebmanual.html', 'functions/IMWEB_SYNC_SETUP.md']) {
    const text = fs.readFileSync(path.join(root, file), 'utf8').replace(/<[^>]+>/g, '');
    assert.match(text, new RegExp(`${lookup.MAX_FAILS}번 틀리[^\\n]*${minutes}분`), file);
    assert.match(text, new RegExp(`${lookup.MAX_LINES}건`), file);
  }
  const setup = fs.readFileSync(path.join(root, 'functions/IMWEB_SYNC_SETUP.md'), 'utf8');
  assert.match(setup, new RegExp(`같은 IP 에서 ${lookup.MAX_FAILS_PER_IP}번 틀려도 ${minutes}분`));
});
