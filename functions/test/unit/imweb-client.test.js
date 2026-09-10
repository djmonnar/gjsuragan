const test = require('node:test');
const assert = require('node:assert/strict');

const client = require('../../imwebClient');

// fetch 를 가짜로 갈아끼운다. 페이지를 어디서 왜 끊는지가 이 테스트의 관심사다.
function withFakeFetch(pagesByStatus, run) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async url => {
    const params = new URL(url).searchParams;
    const status = params.get('status') || '';
    const page = Number(params.get('page') || 1);
    calls.push({ status, page });
    const pages = pagesByStatus[status] || [];
    const body = pages[page - 1] ?? { code: 200, data: { list: [] } };
    return { async text() { return JSON.stringify(body); }, status: 200 };
  };
  return Promise.resolve(run(calls)).finally(() => { globalThis.fetch = original; });
}

function listPage(orderNos) {
  return { code: 200, data: { list: orderNos.map(no => ({ order_no: String(no) })) } };
}

const hundred = n => Array.from({ length: 100 }, (_, i) => n * 1000 + i);

test('마지막 페이지에서 멈춘 이유를 로그로 남긴다', async () => {
  await withFakeFetch({ '': [listPage([1, 2, 3])] }, async () => {
    const logs = [];
    const orders = await client.getOrders('t', [], message => logs.push(message));
    assert.equal(orders.length, 3);
    assert.ok(logs.some(m => m.includes('1페이지') && m.includes('마지막 페이지(3건)')), logs.join(' | '));
  });
});

test('100건이 꽉 차면 다음 페이지를 더 읽는다', async () => {
  await withFakeFetch({ '': [listPage(hundred(1)), listPage([2001, 2002])] }, async calls => {
    const logs = [];
    const orders = await client.getOrders('t', [], message => logs.push(message));
    assert.equal(orders.length, 102, '한 페이지에서 끊기면 뒤쪽 주문이 통째로 안 보인다');
    assert.deepEqual(calls.map(c => c.page), [1, 2]);
    assert.ok(logs.some(m => m.includes('2페이지')), logs.join(' | '));
  });
});

test('같은 목록이 반복되면 중단하고 그 사실을 남긴다', async () => {
  const repeated = listPage(hundred(1));
  await withFakeFetch({ '': [repeated, repeated] }, async () => {
    const logs = [];
    const orders = await client.getOrders('t', [], message => logs.push(message));
    assert.equal(orders.length, 100);
    assert.ok(logs.some(m => m.includes('앞 페이지와 같은 목록')), logs.join(' | '));
  });
});

test('조회 오류도 이유로 남는다', async () => {
  await withFakeFetch({ '': [{ code: 500, msg: '서버 오류' }] }, async () => {
    const logs = [];
    const orders = await client.getOrders('t', [], message => logs.push(message));
    assert.equal(orders.length, 0);
    assert.ok(logs.some(m => m.includes('주문 조회 오류')), logs.join(' | '));
    assert.ok(logs.some(m => m.includes('오류로 중단')), logs.join(' | '));
  });
});

test('보류 상태 조회는 이미 담은 주문을 다시 세지 않는다', async () => {
  await withFakeFetch({
    '': [listPage([1, 2])],
    delivery_hold: [listPage([2, 3])]
  }, async () => {
    const logs = [];
    const orders = await client.getOrders('t', ['delivery_hold'], message => logs.push(message));
    assert.deepEqual(orders.map(o => o.order_no), ['1', '2', '3']);
    assert.ok(logs.some(m => m.includes("상태 'delivery_hold'") && m.includes('새로 담은 1건')), logs.join(' | '));
  });
});
