'use strict';

// 배송 관리 화면의 전체 완료·전체 완료 취소.
// 2026-10-06 에 날짜 칸이 20일 뒤인 채로 전체 완료가 눌려 주문 14건이 완료되고 5건이 종료됐다.
// 되돌리는 버튼이 없어 데이터를 직접 고쳐야 했다. 실제 화면 코드를 가짜 저장소에 물려 돌려 본다.

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const pad = n => String(n).padStart(2, '0');
const dayString = offset => {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const TODAY = dayString(0), YESTERDAY = dayString(-1), FUTURE = dayString(20);
const dowOf = ds => { const [y, m, d] = ds.split('-').map(Number); return new Date(y, m - 1, d).getDay(); };

// 그 날짜가 조리일인 정기 고객.
const sub = (id, name, ds, extra = {}) => ({ id, name, orderType: 'sub', status: 'active', remain: 4, total: 4,
  deliveredDates: [], cookDays: [dowOf(ds)], isDirect: true, ...extra });

function screen(customers, selectedDate) {
  const store = new Map(customers.map(c => [c.id, { ...c }]));
  const confirms = [], toasts = [];
  let answer = true, writes = 0;
  const db = {
    collection: () => ({ doc: id => ({ id }) }),
    async runTransaction(work) {
      const pending = [];
      await work({
        async get(ref) { const data = store.get(ref.id); return { exists: Boolean(data), data: () => ({ ...data }) }; },
        update(ref, patch) { pending.push([ref.id, patch]); }
      });
      for (const [id, patch] of pending) { store.set(id, { ...store.get(id), ...patch }); writes += 1; }
    }
  };
  const context = {
    console: { log() {}, error() {} },
    document: { getElementById: id => (id === 'todayDate' ? { value: selectedDate } : null), addEventListener() {} },
    addEventListener() {}, setTimeout: () => 0,
    confirm: message => { confirms.push(message); return answer; },
    toast: (message, type) => toasts.push({ message, type }),
    __DB: db
  };
  context.window = context;
  vm.createContext(context);
  // 화면은 고객 목록을 전역 let custs 로 들고 있다. 실시간 구독이 하듯 저장소를 그대로 비춘다.
  Object.defineProperty(context, 'custs', { get: () => [...store.values()], configurable: true });
  vm.runInContext(read('assets/js/delivery-transaction.js'), context);
  vm.runInContext(read('assets/js/schedule-report.js'), context);
  return { api: context, store, confirms, toasts, writes: () => writes, say(value) { answer = value; } };
}

test('아직 오지 않은 날짜는 전체 완료가 막힌다', async () => {
  const { api, store, confirms, toasts, writes } = screen([sub('a', '김병태', FUTURE), sub('b', '유병덕', FUTURE, { remain: 1 })], FUTURE);
  await api.markAll();
  assert.equal(writes(), 0);
  // 물어보지도 않는다. 확인을 누르면 진행되는 경고는 이미 한 번 뚫렸다.
  assert.equal(confirms.length, 0);
  assert.match(toasts[0].message, /아직 오지 않은 날짜라 완료 처리할 수 없습니다/);
  assert.equal(store.get('b').status, 'active');
  await api.markAllDirect();
  await api.markAllCourier();
  assert.equal(writes(), 0);
});

test('아직 오지 않은 날짜는 한 건씩 눌러도 막힌다', async () => {
  const { api, store, writes } = screen([sub('a', '김병태', FUTURE)], FUTURE);
  await api.markDone('a', FUTURE);
  assert.equal(writes(), 0);
  assert.deepEqual([...store.get('a').deliveredDates], []);
});

test('오늘 목록은 날짜와 요일을 보여주고 완료한다', async () => {
  const { api, store, confirms } = screen([sub('a', '김병태', TODAY), sub('b', '유병덕', TODAY, { remain: 1 })], TODAY);
  await api.markAll();
  const [, m, d] = TODAY.split('-').map(Number);
  assert.match(confirms[0], new RegExp(`^${m}월 ${d}일\\([일월화수목금토]\\) 전체 2건 배송완료 처리할까요\\?$`));
  assert.equal(store.get('a').remain, 3);
  assert.deepEqual([...store.get('a').deliveredDates], [TODAY]);
  assert.equal(store.get('b').remain, 0);
  assert.equal(store.get('b').status, 'end');
});

test('지난 날짜 목록은 오늘이 아니라고 한 번 더 알린다', async () => {
  const { api, store, confirms, say } = screen([sub('a', '김병태', YESTERDAY)], YESTERDAY);
  say(false);
  await api.markAll();
  assert.match(confirms[0], /※ 오늘\(\d+월 \d+일\([일월화수목금토]\)\)이 아닌 \d+월 \d+일\([일월화수목금토]\) 목록입니다\./);
  // 취소를 누르면 아무것도 바뀌지 않는다.
  assert.deepEqual([...store.get('a').deliveredDates], []);
  say(true);
  await api.markAll();
  assert.deepEqual([...store.get('a').deliveredDates], [YESTERDAY]);
});

test('전체 완료 취소는 그 날짜로 완료된 주문을 모두 되돌린다', async () => {
  const before = [
    sub('a', '김병태', TODAY, { remain: 2, deliveredDates: ['2026-09-21', '2026-09-28'], lastDeliveredDate: '2026-09-28', deliveryState: 'done', deliveredAt: '2026-09-28T23:39:04.760Z' }),
    // 마지막 한 번이 남은 주문. 완료하면 종료되어 다음 목록에서 빠진다.
    sub('b', '유병덕', TODAY, { remain: 1, deliveredDates: ['2026-09-14', '2026-09-21', '2026-09-28'], lastDeliveredDate: '2026-09-28', deliveryState: 'done' }),
    // 처음 받는 주문.
    sub('c', '강점상', TODAY, { remain: 12, total: 12 }),
    // 수량 2개짜리 선택주문. 직원 화면은 한 번에 전부 완료한다.
    { id: 'd', name: '선택주문', orderType: 'once', status: 'active', remain: 2, total: 2, qty: 2, deliveredDates: [], onceDate: TODAY, startDate: TODAY, isDirect: false },
    // 그날 목록에 없는 다른 요일 고객. 건드리면 안 된다.
    sub('z', '다른요일', dayString(1), { remain: 5, deliveredDates: ['2026-09-30'] })
  ];
  const { api, store, confirms, toasts } = screen(before, TODAY);
  await api.markAll();
  assert.equal(store.get('b').status, 'end');
  assert.equal(store.get('d').remain, 0);
  assert.equal(store.get('z').remain, 5);

  await api.cancelAllDeliveries();
  const asked = confirms[confirms.length - 1];
  assert.match(asked, /배송완료 4건을 모두 취소할까요\?/);
  assert.match(asked, /김병태, 유병덕, 강점상, 선택주문/);
  for (const was of before) {
    const now = store.get(was.id);
    assert.equal(now.remain, was.remain, `${was.name} 잔여`);
    assert.equal(now.status, 'active', `${was.name} 상태`);
    assert.deepEqual([...now.deliveredDates], was.deliveredDates, `${was.name} 완료 이력`);
  }
  // 완료할 때 같이 적어 둔 값도 맞춰 되돌린다.
  assert.equal(store.get('a').lastDeliveredDate, '2026-09-28');
  assert.equal(store.get('a').deliveryState, 'done');
  assert.equal(store.get('c').lastDeliveredDate, '');
  assert.equal(store.get('c').deliveryState, '');
  assert.equal(store.get('c').deliveredAt, '');
  assert.match(toasts[toasts.length - 1].message, /배송완료 4건 취소됨/);
});

test('종료되어 그날 목록에서 빠진 주문도 전체 완료 취소 대상이다', async () => {
  // 잔여가 0이 되어 종료된 주문은 다른 요일 설정으로 바뀌었어도 되돌려야 한다.
  const ended = sub('e', '이정훈', dayString(3), { remain: 0, status: 'end', deliveredDates: ['2026-10-01', TODAY] });
  const { api, store } = screen([ended], TODAY);
  await api.cancelAllDeliveries();
  assert.equal(store.get('e').remain, 1);
  assert.equal(store.get('e').status, 'active');
  assert.deepEqual([...store.get('e').deliveredDates], ['2026-10-01']);
});

test('완료된 건이 없거나 확인을 취소하면 아무것도 바꾸지 않는다', async () => {
  const empty = screen([sub('a', '김병태', TODAY)], TODAY);
  await empty.api.cancelAllDeliveries();
  assert.equal(empty.confirms.length, 0);
  assert.match(empty.toasts[0].message, /완료 처리된 건이 없습니다/);

  const declined = screen([sub('a', '김병태', TODAY, { remain: 3, deliveredDates: [TODAY] })], TODAY);
  declined.say(false);
  await declined.api.cancelAllDeliveries();
  assert.equal(declined.writes(), 0);
  assert.deepEqual([...declined.store.get('a').deliveredDates], [TODAY]);
});

test('한 건이 실패해도 나머지는 되돌리고 실패를 알린다', async () => {
  const { api, store, toasts } = screen([
    sub('a', '김병태', TODAY, { remain: 3, deliveredDates: [TODAY] }),
    // 잔여 값이 깨진 주문. 추측해서 고치지 않고 실패로 알린다.
    sub('x', '깨진주문', TODAY, { remain: 'invalid', deliveredDates: [TODAY] })
  ], TODAY);
  await api.cancelAllDeliveries();
  assert.equal(store.get('a').remain, 4);
  assert.equal(store.get('x').remain, 'invalid');
  assert.match(toasts[toasts.length - 1].message, /1건 취소, 1건 실패/);
  assert.equal(toasts[toasts.length - 1].type, 'er');
});

test('화면에 전체 완료 취소 버튼이 있고 안내에도 적혀 있다', () => {
  const html = read('index.html');
  assert.match(html, /onclick="cancelAllDeliveries\(\)"[^>]*>전체 완료 취소<\/button>/);
  // 화면 안 매뉴얼과 따로 있는 매뉴얼 둘 다.
  assert.match(html, /아직 오지 않은 날짜는 완료 처리할 수 없고/);
  assert.match(html, /<span class="mn-btn">전체 완료 취소<\/span>/);
  const manual = read('manual.html');
  assert.match(manual, /<strong>전체 완료 취소<\/strong>/);
  assert.match(manual, /아직 오지 않은 날짜는 완료 처리할 수 없고/);
  // 예전 안내는 확인 창만 믿으라고 했다. 그 확인 창이 뚫렸다.
  assert.doesNotMatch(manual, /실수 걱정은 없어요/);
});
