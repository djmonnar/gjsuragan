'use strict';

// 선택주문은 수량이 몇 개든 '같은 날 같이 나가는 한 번의 배송'이다. 어느 화면에서 완료를 눌러도
// 주문이 끝나야 한다.
// 2026-10-06 에 실제 데이터를 보니 수량 2개 주문 8건 가운데 5건(4월 주문)이 1개만 차감된 채
// '진행중·잔여 1'로 남아 있었다. 남은 1개는 어느 날짜 목록에도 다시 나오지 않는다. 그 무렵에는 배송 관리
// 화면도 1개씩 차감했다. 그 뒤 배송 관리·카카오톡은 한 번에 끝내게 바뀌었지만 규칙이 화면마다 따로
// 있어서, 배송지도는 1개씩 차감하는 채로 남아 있었다.
// 각 화면의 실제 완료 함수를 소스에서 뽑아 가짜 저장소에 물려 돌려 본다.

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

function extractFunction(source, signature) {
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `${signature} 함수를 찾지 못했습니다.`);
  const bodyStart = source.indexOf('{', start);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`${signature} 함수 끝을 찾지 못했습니다.`);
}

const pad = n => String(n).padStart(2, '0');
const now = new Date();
const TODAY = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
const dowOf = ds => { const [y, m, d] = ds.split('-').map(Number); return new Date(y, m - 1, d).getDay(); };

// 오늘 나가는 주문 네 건: 수량 2개 선택주문과 4회 남은 정기배송을 직배송·택배로 하나씩.
const orders = () => [
  { id: 'onceDirect', name: '선택직배', orderType: 'once', status: 'active', remain: 2, total: 2, qty: 2, deliveredDates: [], onceDate: TODAY, startDate: TODAY, isDirect: true },
  { id: 'onceCourier', name: '선택택배', orderType: 'once', status: 'active', remain: 2, total: 2, qty: 2, deliveredDates: [], onceDate: TODAY, startDate: TODAY, isDirect: false },
  { id: 'subDirect', name: '정기직배', orderType: 'sub', status: 'active', remain: 4, total: 4, deliveredDates: [], cookDays: [dowOf(TODAY)], isDirect: true },
  { id: 'subCourier', name: '정기택배', orderType: 'sub', status: 'active', remain: 4, total: 4, deliveredDates: [], cookDays: [dowOf(TODAY)], isDirect: false }
];

function fakeStore() {
  const store = new Map(orders().map(order => [order.id, { ...order }]));
  const db = {
    collection: () => ({ doc: id => ({ id }) }),
    async runTransaction(work) {
      const pending = [];
      const value = await work({
        async get(ref) { const data = store.get(ref.id); return { exists: Boolean(data), data: () => ({ ...data }) }; },
        update(ref, patch) { pending.push([ref.id, patch]); }
      });
      for (const [id, patch] of pending) store.set(id, { ...store.get(id), ...patch });
      return value;
    }
  };
  return { store, db };
}

// load(context) 가 그 화면의 완료 함수를 싣는다.
function screen(load) {
  const { store, db } = fakeStore();
  const toasts = [];
  const context = {
    console: { log() {}, error() {} },
    document: { getElementById: id => (id === 'todayDate' ? { value: TODAY } : null), addEventListener() {} },
    addEventListener() {}, setTimeout: () => 0,
    confirm: () => true,
    toast: (message, type) => toasts.push({ message, type }),
    __DB: db
  };
  context.window = context;
  vm.createContext(context);
  // 화면은 고객 목록을 전역 custs 로 들고 있다. 실시간 구독이 하듯 저장소를 그대로 비춘다.
  Object.defineProperty(context, 'custs', { get: () => [...store.values()], configurable: true });
  vm.runInContext(read('assets/js/delivery-transaction.js'), context);
  load(context);
  return { api: context, store, toasts };
}

// 배송 관리 화면: 파일 전체를 싣는다. 마지막에 설치되는 완료 함수가 실제로 눌리는 함수다.
const staffScreen = context => vm.runInContext(read('assets/js/schedule-report.js'), context);
// 그 밖의 화면: 완료 함수만 뽑아 싣고, 그날 목록과 오늘 날짜는 최소한으로 대신한다.
const extracted = (...pairs) => context => {
  vm.runInContext(`function todayStr(){ return ${JSON.stringify(TODAY)}; } function listFor(){ return custs; }`, context);
  for (const [file, signature] of pairs) vm.runInContext(extractFunction(read(file), signature), context);
};

const SCREENS = [
  { name: '배송 관리 — 한 건 완료', load: staffScreen, press: api => api.markDone('onceDirect', TODAY), once: ['onceDirect'] },
  { name: '배송 관리 — 전체 완료', load: staffScreen, press: api => api.markAll(), once: ['onceDirect', 'onceCourier'] },
  { name: '배송 관리 — 직배송 전체 완료', load: staffScreen, press: api => api.markAllDirect(), once: ['onceDirect'] },
  { name: '배송 관리 — 택배 전체 완료', load: staffScreen, press: api => api.markAllCourier(), once: ['onceCourier'] },
  { name: '배송지도 — 완료', load: extracted(['map/index.html', 'async function markDone(']), press: api => api.markDone('onceDirect', TODAY), once: ['onceDirect'] },
  // 아래 넷은 배송 관리 화면에서 위의 함수에 가려져 눌리지 않는다. 그래도 남아 있는 한 같은 결과를 내야 한다.
  { name: '가려진 기본 함수 — 한 건 완료(imweb.js)', load: extracted(['assets/js/imweb.js', 'async function markDone(']), press: api => api.markDone('onceCourier', TODAY), once: ['onceCourier'] },
  { name: '가려진 기본 함수 — 전체 완료(imweb.js)', load: extracted(['assets/js/imweb.js', 'async function markAll(']), press: api => api.markAll(), once: ['onceDirect', 'onceCourier'] },
  { name: '가려진 기본 함수 — 직배송 전체 완료(rendering.js)', load: extracted(['assets/js/rendering.js', 'async function markAllDirect(']), press: api => api.markAllDirect(), once: ['onceDirect'] },
  { name: '가려진 기본 함수 — 택배 전체 완료(rendering.js)', load: extracted(['assets/js/rendering.js', 'async function markAllCourier(']), press: api => api.markAllCourier(), once: ['onceCourier'] }
];

for (const entry of SCREENS) {
  test(`${entry.name}: 수량 2개 선택주문은 한 번에 끝나고, 정기배송은 1회만 줄어든다`, async () => {
    const before = new Map(orders().map(order => [order.id, order]));
    const { api, store } = screen(entry.load);
    await entry.press(api);
    for (const id of entry.once) {
      const order = store.get(id);
      assert.equal(order.remain, 0, `${id} 잔여`);
      assert.equal(order.status, 'end', `${id} 상태`);
      assert.deepEqual([...order.deliveredDates], [TODAY], `${id} 완료 이력`);
    }
    for (const [id, order] of store) {
      if (order.orderType !== 'sub') continue;
      const touched = order.deliveredDates.includes(TODAY);
      assert.equal(order.remain, touched ? 3 : 4, `${id} 잔여`);
      assert.equal(order.status, 'active', `${id} 상태`);
    }
    // 누르지 않은 주문은 그대로다.
    for (const [id, order] of store) {
      if (order.deliveredDates.includes(TODAY)) continue;
      assert.equal(order.remain, before.get(id).remain, `${id} 는 건드리지 않는다`);
    }
  });
}

test('배송지도에서 완료를 취소하면 수량이 그대로 돌아온다', async () => {
  const { api, store } = screen(extracted(
    ['map/index.html', 'async function markDone('],
    ['map/index.html', 'async function undoMarkDone(']
  ));
  await api.markDone('onceDirect', TODAY);
  assert.equal(store.get('onceDirect').remain, 0);
  await api.undoMarkDone('onceDirect', TODAY);
  const order = store.get('onceDirect');
  assert.equal(order.remain, 2);
  assert.equal(order.status, 'active');
  assert.deepEqual([...order.deliveredDates], []);
});

test('예전 규칙으로 1개만 차감된 채 남은 주문은 그 날짜에서 다시 완료되지 않는다', async () => {
  // 이런 주문은 완료를 다시 눌러서는 닫히지 않는다 — 이미 그 날짜로 완료돼 있기 때문이다. 데이터로 정리한다.
  const { api, store, toasts } = screen(extracted(['map/index.html', 'async function markDone(']));
  store.set('onceDirect', { ...store.get('onceDirect'), remain: 1, deliveredDates: [TODAY] });
  await api.markDone('onceDirect', TODAY);
  assert.equal(store.get('onceDirect').remain, 1);
  assert.match(toasts[toasts.length - 1].message, /이미 완료 처리된 날짜/);
});

test('카카오톡 "오늘 배송 완료"도 같은 결과를 낸다', async () => {
  // 서버 쪽 완료는 functions/index.js 에 따로 있다. 화면과 규칙이 어긋나지 않게 같은 주문으로 돌려 본다.
  const source = read('functions/index.js');
  const { store, db } = fakeStore();
  const context = { db };
  vm.createContext(context);
  for (const signature of [
    'function kakaoDow(', 'function kakaoWasDeliveredOn(', 'function kakaoIsDeliverySub(',
    'function kakaoIsDeliveryOnce(', 'function kakaoIsDelivery(', 'async function kakaoMarkCustomerDelivered('
  ]) vm.runInContext(extractFunction(source, signature), context);

  for (const id of ['onceDirect', 'onceCourier', 'subDirect']) {
    const result = await context.kakaoMarkCustomerDelivered(id, TODAY);
    assert.equal(result.changed, true, id);
  }
  for (const id of ['onceDirect', 'onceCourier']) {
    assert.equal(store.get(id).remain, 0, id);
    assert.equal(store.get(id).status, 'end', id);
  }
  assert.equal(store.get('subDirect').remain, 3);
  assert.equal(store.get('subDirect').status, 'active');
  assert.equal(store.get('subCourier').remain, 4);
});

// ── 박스 표시 ──
// '마지막 직배송은 보냉가방 대신 박스로 발송'. 선택주문은 그 한 번이 마지막 배송이다.
// 잔여를 횟수로 읽어 '잔여 1'일 때만 띄우면 수량 2개 선택주문에서 표시가 빠진다.
const boxCases = [
  ['수량 2개 직배송 선택주문', { orderType: 'once', isDirect: true, status: 'active', remain: 2, total: 2, qty: 2 }, true],
  ['수량 1개 직배송 선택주문', { orderType: 'once', isDirect: true, status: 'active', remain: 1, total: 1, qty: 1 }, true],
  ['마지막 회차인 직배송 정기', { orderType: 'sub', isDirect: true, status: 'active', remain: 1, total: 4 }, true],
  ['회차가 남은 직배송 정기', { orderType: 'sub', isDirect: true, status: 'active', remain: 2, total: 4 }, false],
  ['택배 선택주문', { orderType: 'once', isDirect: false, status: 'active', remain: 2, total: 2, qty: 2 }, false],
  ['택배 정기 마지막 회차', { orderType: 'sub', isDirect: false, status: 'active', remain: 1, total: 4 }, false]
];

test('배송 관리의 박스 표시는 직배송 선택주문이면 수량과 상관없이 뜬다', () => {
  const context = {};
  vm.createContext(context);
  vm.runInContext(extractFunction(read('assets/js/rendering.js'), 'function isLastBoxDelivery('), context);
  for (const [label, order, expected] of boxCases) {
    assert.equal(context.isLastBoxDelivery(order), expected, label);
  }
  // 완료되어 끝난 주문에는 띄우지 않는다.
  assert.equal(context.isLastBoxDelivery({ orderType: 'once', isDirect: true, status: 'end', remain: 0, total: 2 }), false);
});

test('배송지도의 박스 표시도 같은 기준이다', () => {
  const context = {};
  vm.createContext(context);
  vm.runInContext(extractFunction(read('map/index.html'), 'function lastBoxDeliveryBadge('), context);
  for (const [label, order, expected] of boxCases) {
    assert.equal(context.lastBoxDeliveryBadge(order).includes('박스'), expected, label);
  }
  assert.equal(context.lastBoxDeliveryBadge({ orderType: 'once', isDirect: true, status: 'end', remain: 0, total: 2 }), '');
});

// ── 안내 ──
test('매뉴얼이 실제 동작과 같은 말을 한다', () => {
  const { deliveryStatePatch } = require('../../../assets/js/delivery-transaction');
  const order = { orderType: 'once', status: 'active', remain: 2, total: 2, qty: 2, deliveredDates: [] };
  const completed = deliveryStatePatch(order, TODAY, 'complete').patch;
  const restored = deliveryStatePatch({ ...order, ...completed }, TODAY, 'cancel').patch;
  // 안내에 적은 두 가지: 완료를 누르면 바로 끝나고, 취소하면 수량이 그대로 돌아온다.
  assert.equal(completed.status, 'end');
  assert.equal(restored.remain, order.qty);

  const manual = read('manual.html');
  assert.match(manual, /선택주문은 수량이 몇 개든 한 번에 같이 나가는 배송<\/strong>이라, 완료를 누르면 그 주문이 바로 끝납니다/);
  assert.match(manual, /배송 관리에서 눌러도 배송지도에서 눌러도 같습니다/);
  assert.match(manual, /완료를 취소하면 수량이 그대로 돌아옵니다/);
  // 예전 안내는 수량 칸을 한 줄로만 설명했다. 2개 이상이 왜 한 줄인지 적는다.
  assert.match(manual, /2개 이상이어도 같은 날 같이 나가는 한 번의 배송이라 한 줄로 나옵니다/);

  const inApp = read('index.html');
  assert.match(inApp, /선택주문은 수량이 몇 개든 한 번에 같이 나가는 배송<\/b>이라 완료를 누르면 바로 종료되고, 취소하면 수량이 그대로 돌아옵니다/);
  assert.match(inApp, /완료 규칙은 배송 관리와 같습니다\(선택주문은 완료를 누르면 바로 종료\)/);
  assert.match(inApp, /정기배송은 마지막 회차에, 선택주문은 수량과 상관없이 항상 표시됩니다/);
  // 정기배송만 1회 차감이다. 예전 문장은 모든 주문이 1회 차감되는 것처럼 읽혔다.
  assert.match(inApp, /배송 완료를 누르면 정기배송은 <b>잔여 횟수가 1회 차감<\/b>/);
});
