const test = require('node:test');
const assert = require('node:assert/strict');

const { syncImwebOrders } = require('../../imwebSync');

// Firestore 대신 쓰는 최소 구현. add / delete / get 만 있으면 된다.
function fakeDb(seed = {}) {
  const store = new Map();
  for (const [id, data] of Object.entries(seed)) store.set(id, data);
  let autoId = 0;

  return {
    store,
    collection(name) {
      return {
        async get() {
          const docs = [...store.entries()]
            .filter(([id]) => id.startsWith(`${name}/`))
            .map(([id, data]) => ({ id: id.slice(name.length + 1), data: () => data }));
          return { forEach: callback => docs.forEach(callback) };
        },
        async add(data) {
          autoId++;
          const id = `${name}-${autoId}`;
          store.set(`${name}/${id}`, data);
          return { id };
        },
        doc(id) {
          return {
            async delete() { store.delete(`${name}/${id}`); }
          };
        }
      };
    }
  };
}

const ORDER_TIME = Math.floor(Date.UTC(2026, 7, 24, 1, 0) / 1000); // 2026-08-24(월) 10:00 KST

function order(orderNo, status = 'pay_done') {
  return {
    order_no: orderNo,
    order_date: '20260824',
    order_time: ORDER_TIME,
    status,
    delivery: {
      memo: '',
      address: { name: '차진', phone: '010-0000-0000', address: '경남 진주시', address_detail: '8' }
    }
  };
}

function subItem(optionText) {
  return { prod_name: '반찬 정기구독 A세트', options: [{ value_name_list: optionText.split('|') }] };
}

function fakeClient(orders, itemsByOrderNo) {
  return {
    async getToken() { return 'token'; },
    async getOrders() { return orders; },
    async getProdOrders(_token, orderNo) { return [{ items: itemsByOrderNo[orderNo] || [] }]; },
    itemsFromProdOrders(prodOrders) {
      return (prodOrders || []).flatMap(po => po.items || []);
    }
  };
}

function customers(db) {
  return [...db.store.entries()]
    .filter(([id]) => id.startsWith('customers/'))
    .map(([, data]) => data);
}

test('정기구독 두 줄 주문이 두 건으로 등록된다', async () => {
  const db = fakeDb();
  const client = fakeClient([order('202608240989736')], {
    '202608240989736': [
      subItem('주 3회|월/수/금 조리|총 12회'),
      subItem('주 2회|화/목 조리|총 8회')
    ]
  });

  const result = await syncImwebOrders({ db, client, env: {} });

  assert.equal(result.saved, 2);
  const saved = customers(db);
  assert.deepEqual(saved.map(c => c.syncKey), ['202608240989736', '202608240989736-2']);
  assert.deepEqual(saved.map(c => c.cookDays), [[1, 3, 5], [2, 4]]);
  assert.deepEqual(saved.map(c => c.total), [12, 8]);
  assert.ok(saved.every(c => c.autoRegistered === true));
});

test('이미 등록된 주문은 다시 등록하지 않는다', async () => {
  const db = fakeDb({
    'customers/existing': { syncKey: '202608240989736', name: '차진' }
  });
  const client = fakeClient([order('202608240989736')], {
    '202608240989736': [subItem('주 3회|월/수/금 조리|총 12회')]
  });

  const result = await syncImwebOrders({ db, client, env: {} });

  assert.equal(result.saved, 0);
  assert.equal(result.skipped, 1);
  assert.equal(customers(db).length, 1);
});

test('onlyOrderNos 를 주면 이미 등록된 주문에서 빠진 줄만 채운다', async () => {
  // 예전에 한 건만 등록된 상태를 재현한다. 첫 줄은 syncKey 가 주문번호 그대로다.
  const db = fakeDb({
    'customers/existing': { syncKey: '202608240989736', name: '차진' }
  });
  const client = fakeClient([order('202608240989736'), order('999')], {
    '202608240989736': [
      subItem('주 3회|월/수/금 조리|총 12회'),
      subItem('주 2회|화/목 조리|총 8회')
    ],
    999: [subItem('주 1회|월 조리|총 4회')]
  });

  const result = await syncImwebOrders({
    db, client, env: {}, onlyOrderNos: ['202608240989736']
  });

  assert.equal(result.saved, 1, '빠진 줄 하나만 추가되어야 한다');
  const added = customers(db).find(c => c.syncKey === '202608240989736-2');
  assert.ok(added, '두 번째 줄이 등록되어야 한다');
  assert.deepEqual(added.cookDays, [2, 4]);
  assert.equal(customers(db).some(c => c.orderNum === '999'), false, '지정하지 않은 주문은 건드리지 않는다');
});

test('취소된 주문은 관련 문서를 모두 지우고 취소 로그를 남긴다', async () => {
  const db = fakeDb({
    'customers/a': { syncKey: '202608240989736', name: '차진' },
    'customers/b': { syncKey: '202608240989736-2', name: '차진' }
  });
  const client = fakeClient([order('202608240989736', '취소완료')], {});

  const result = await syncImwebOrders({ db, client, env: {} });

  assert.equal(result.deleted, 2);
  assert.equal(customers(db).length, 0);
  const logs = [...db.store.entries()].filter(([id]) => id.startsWith('imwebCancelLogs/'));
  assert.equal(logs.length, 1);
  assert.equal(logs[0][1].deletedCount, 2);
  assert.equal(logs[0][1].source, 'cloud_function');
});

test('배송완료된 주문은 등록하지 않는다', async () => {
  const db = fakeDb();
  const client = fakeClient([order('202608240989736', '배송완료')], {
    '202608240989736': [subItem('주 3회|월/수/금 조리|총 12회')]
  });

  const result = await syncImwebOrders({ db, client, env: {} });

  assert.equal(result.saved, 0);
  assert.equal(result.skipped, 1);
  assert.equal(customers(db).length, 0);
});

test('배송 보류 상태는 등록 대상이다', async () => {
  const db = fakeDb();
  const client = fakeClient([order('202608240989736', '배송 보류')], {
    '202608240989736': [subItem('주 2회|화/목 조리|총 8회')]
  });

  const result = await syncImwebOrders({ db, client, env: {} });
  assert.equal(result.saved, 1);
});
