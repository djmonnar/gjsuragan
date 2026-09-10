const test = require('node:test');
const assert = require('node:assert/strict');

const imwebSyncModule = require('../../imwebSync');
const { syncImwebOrders } = imwebSyncModule;

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
            async get() {
              const key = `${name}/${id}`;
              return { exists: store.has(key), data: () => store.get(key) };
            },
            async set(data, options) {
              const key = `${name}/${id}`;
              const previous = options?.merge ? (store.get(key) || {}) : {};
              store.set(key, { ...previous, ...data });
            },
            async delete() { store.delete(`${name}/${id}`); }
          };
        }
      };
    }
  };
}

const ORDER_TIME = Math.floor(Date.UTC(2026, 7, 24, 1, 0) / 1000); // 2026-08-24(월) 10:00 KST

function order(orderNo, status = 'pay_done', extra = {}) {
  return {
    order_no: orderNo,
    order_date: '20260824',
    order_time: ORDER_TIME,
    status,
    delivery: {
      memo: '',
      address: { name: '차진', phone: '010-0000-0000', address: '경남 진주시', address_detail: '8' }
    },
    ...extra
  };
}

// 상품 줄마다 상태가 다른 주문(부분취소)을 흉내낸다.
function fakeClientWithProdOrders(orders, prodOrdersByOrderNo) {
  return {
    async getToken() { return 'token'; },
    async getOrders() { return orders; },
    async getProdOrders(_token, orderNo) { return prodOrdersByOrderNo[orderNo] || []; },
    itemsFromProdOrders(prodOrders) {
      return (prodOrders || []).flatMap(po => po.items || []);
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

  const result = await syncImwebOrders({ db, client, env: {}, registerFrom: '' });

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

  const result = await syncImwebOrders({ db, client, env: {}, registerFrom: '' });

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
    db, client, env: {}, registerFrom: '', onlyOrderNos: ['202608240989736']
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

  const result = await syncImwebOrders({ db, client, env: {}, registerFrom: '' });

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

  const result = await syncImwebOrders({ db, client, env: {}, registerFrom: '' });

  assert.equal(result.saved, 0);
  assert.equal(result.skipped, 1);
  assert.equal(customers(db).length, 0);
});

test('배송 보류 상태는 등록 대상이다', async () => {
  const db = fakeDb();
  const client = fakeClient([order('202608240989736', '배송 보류')], {
    '202608240989736': [subItem('주 2회|화/목 조리|총 8회')]
  });

  const result = await syncImwebOrders({ db, client, env: {}, registerFrom: '' });
  assert.equal(result.saved, 1);
});

test('취소를 철회한 주문은 다시 등록된다', async () => {
  // 취소요청을 물리면 주문은 결제완료로 살아 있는데 claim_* 에 취소 흔적만 남는다.
  // 예전에는 이 흔적 하나만 보고 주문 전체를 취소로 처리해서 영영 등록되지 않았다.
  const db = fakeDb();
  const client = fakeClient([order('202608240989736', 'pay_done', { claim_status: '취소철회', claim_type: 'CANCEL' })], {
    '202608240989736': [subItem('주 3회|월/수/금 조리|총 12회')]
  });

  const result = await syncImwebOrders({ db, client, env: {}, registerFrom: '' });

  assert.equal(result.saved, 1);
  assert.equal(result.deleted, 0);
  assert.equal(customers(db).length, 1);
});

test('부분취소는 취소된 줄만 빼고 나머지 줄을 등록한다', async () => {
  const db = fakeDb();
  const client = fakeClientWithProdOrders([order('202608240989736')], {
    '202608240989736': [
      { status: 'pay_done', items: [subItem('주 3회|월/수/금 조리|총 12회')] },
      { status: 'cancel_done', items: [subItem('주 2회|화/목 조리|총 8회')] }
    ]
  });

  const result = await syncImwebOrders({ db, client, env: {}, registerFrom: '' });

  assert.equal(result.saved, 1);
  const saved = customers(db);
  assert.deepEqual(saved.map(c => c.syncKey), ['202608240989736']);
  assert.deepEqual(saved.map(c => c.cookDays), [[1, 3, 5]]);
});

test('이미 등록된 주문도 취소 흔적이 있으면 취소된 줄만 지운다', async () => {
  const db = fakeDb({
    'customers/a': { syncKey: '202608240989736', name: '차진' },
    'customers/b': { syncKey: '202608240989736-2', name: '차진' }
  });
  const client = fakeClientWithProdOrders(
    [order('202608240989736', 'pay_done', { claim_status: 'cancel_done', claim_type: 'CANCEL' })], {
      '202608240989736': [
        { status: 'pay_done', items: [subItem('주 3회|월/수/금 조리|총 12회')] },
        { status: 'cancel_done', items: [subItem('주 2회|화/목 조리|총 8회')] }
      ]
    });

  const result = await syncImwebOrders({ db, client, env: {}, registerFrom: '' });

  assert.equal(result.deleted, 1);
  assert.equal(result.saved, 0);
  assert.deepEqual(customers(db).map(c => c.syncKey), ['202608240989736']);
  const logs = [...db.store.entries()].filter(([id]) => id.startsWith('imwebCancelLogs/'));
  assert.equal(logs.length, 1);
  assert.deepEqual(logs[0][1].deletedDocIds, ['b']);
  assert.equal(logs[0][1].cancelStatus, 'cancel_done', '취소 로그에는 주문 상태가 아니라 실제 취소 상태가 남아야 한다');
});

test('상품 줄이 전부 취소면 주문 전체를 지운다', async () => {
  const db = fakeDb({
    'customers/a': { syncKey: '202608240989736', name: '차진' },
    'customers/b': { syncKey: '202608240989736-2', name: '차진' }
  });
  const client = fakeClientWithProdOrders(
    [order('202608240989736', 'pay_done', { claim_status: 'cancel_done' })], {
      '202608240989736': [
        { status: 'cancel_done', items: [subItem('주 3회|월/수/금 조리|총 12회')] },
        { status: 'cancel_done', items: [subItem('주 2회|화/목 조리|총 8회')] }
      ]
    });

  const result = await syncImwebOrders({ db, client, env: {}, registerFrom: '' });

  assert.equal(result.deleted, 2);
  assert.equal(customers(db).length, 0);
});

test('취소 흔적이 있어도 상품 줄을 못 읽으면 아무것도 지우지 않는다', async () => {
  const db = fakeDb({ 'customers/a': { syncKey: '202608240989736', name: '차진' } });
  const client = fakeClientWithProdOrders(
    [order('202608240989736', 'pay_done', { claim_status: 'cancel_done' })], {});
  const logs = [];

  const result = await syncImwebOrders({ db, client, env: {}, registerFrom: '', log: message => logs.push(message) });

  assert.equal(result.deleted, 0);
  assert.equal(customers(db).length, 1);
  assert.ok(logs.some(message => message.includes('판정 보류')), '판정을 미뤘다는 로그가 남아야 한다');
});

function missedOrders(db) {
  return [...db.store.entries()]
    .filter(([id]) => id.startsWith('imwebMissedOrders/'))
    .map(([id, data]) => ({ id: id.slice('imwebMissedOrders/'.length), ...data }));
}

test('등록 기준일 이전 주문은 등록하지 않고 놓친 주문으로만 적어둔다', async () => {
  const db = fakeDb();
  const client = fakeClient([order('202608240989736')], {
    '202608240989736': [subItem('주 3회|월/수/금 조리|총 12회')]
  });
  const logs = [];

  const result = await syncImwebOrders({
    db, client, env: {}, registerFrom: '2026-09-01', log: message => logs.push(message)
  });

  assert.equal(result.saved, 0);
  assert.equal(result.missed, 1);
  assert.equal(customers(db).length, 0, '배송목록에 갑자기 등록되면 안 된다');

  const [record] = missedOrders(db);
  assert.equal(record.id, '202608240989736', '문서 id 는 syncKey 여야 한다');
  assert.equal(record.orderNo, '202608240989736');
  assert.equal(record.orderDate, '2026-08-24');
  assert.equal(record.name, '차진');
  assert.equal(record.scheduleName, '월·수·금 조리 → 화·목·토 도착');
  assert.match(record.reason, /등록 기준일\(2026-09-01\) 이전 주문/);
  assert.equal(record.reasonCode, 'before_cutoff');
  assert.equal(record.customerData.syncKey, '202608240989736',
    '화면에서 그대로 등록할 수 있게 고객 문서를 통째로 담아둔다');
  assert.equal(record.customerData.orderType, 'sub');
  assert.deepEqual(record.customerData.cookDays, [1, 3, 5]);
  assert.equal(record.acknowledged, undefined, '확인 여부는 함수가 건드리지 않는다');
  assert.ok(logs.some(message => message.includes('등록 보류')));
});

test('기준일 이후 주문은 그대로 등록된다', async () => {
  const db = fakeDb();
  const client = fakeClient([order('202608240989736')], {
    '202608240989736': [subItem('주 3회|월/수/금 조리|총 12회')]
  });

  const result = await syncImwebOrders({ db, client, env: {}, registerFrom: '2026-08-01' });

  assert.equal(result.saved, 1);
  assert.equal(result.missed, 0);
  assert.equal(missedOrders(db).length, 0);
});

test('놓친 주문을 확인 처리하면 다음 실행이 덮어쓰지 않는다', async () => {
  const db = fakeDb({
    'imwebMissedOrders/202608240989736': {
      syncKey: '202608240989736', orderNo: '202608240989736', acknowledged: true
    }
  });
  const client = fakeClient([order('202608240989736')], {
    '202608240989736': [subItem('주 3회|월/수/금 조리|총 12회')]
  });

  const result = await syncImwebOrders({ db, client, env: {}, registerFrom: '2026-09-01' });

  assert.equal(result.missed, 1);
  assert.equal(customers(db).length, 0);
  const [record] = missedOrders(db);
  assert.equal(record.acknowledged, true, '확인 표시가 유지돼야 한다');
});

test('기준일이 없으면 예전처럼 전부 등록한다', async () => {
  const db = fakeDb();
  const client = fakeClient([order('202608240989736')], {
    '202608240989736': [subItem('주 3회|월/수/금 조리|총 12회')]
  });

  const result = await syncImwebOrders({ db, client, env: {}, registerFrom: '' });

  assert.equal(result.saved, 1);
  assert.equal(result.missed, 0);
});

test('config/imwebSync 의 registerFrom 을 기준일로 읽는다', async () => {
  const configDb = value => ({
    collection: () => ({ doc: () => ({ async get() { return value; } }) })
  });

  const fallback = imwebSyncModule.DEFAULT_REGISTER_FROM;
  assert.match(fallback, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(await imwebSyncModule.loadRegisterFrom(configDb({ exists: false })), fallback,
    '설정이 없어도 기본 기준일이 걸려서 옛날 주문이 쏟아지지 않는다');
  assert.equal(await imwebSyncModule.loadRegisterFrom(
    configDb({ exists: true, data: () => ({ registerFrom: '2026-09-20' }) })), '2026-09-20');
  assert.equal(await imwebSyncModule.loadRegisterFrom(
    configDb({ exists: true, data: () => ({ registerFrom: '2026/09/10' }) })), fallback,
    '형식이 어긋난 값은 기본 기준일로 되돌린다');
});

test('설정을 깜빡해도 옛날 주문이 배송목록에 쏟아지지 않는다', async () => {
  // config/imwebSync 에 registerFrom 을 넣지 않은 상태. 기본 기준일이 걸려야 한다.
  const db = fakeDb();
  const client = fakeClient([order('202608240989736')], {
    '202608240989736': [subItem('주 3회|월/수/금 조리|총 12회')]
  });

  const result = await syncImwebOrders({ db, client, env: {} });

  assert.equal(result.saved, 0);
  assert.equal(result.missed, 1);
  assert.equal(customers(db).length, 0);
  assert.equal(missedOrders(db).length, 1);
});

test('취소 흔적 때문에 빠졌던 주문은 이유를 그렇게 적는다', async () => {
  const db = fakeDb();
  const client = fakeClient(
    [order('202608240989736', 'pay_done', { claim_status: '취소철회', claim_type: 'CANCEL' })], {
      '202608240989736': [subItem('주 3회|월/수/금 조리|총 12회')]
    });

  const result = await syncImwebOrders({ db, client, env: {}, registerFrom: '2026-09-01' });

  assert.equal(result.missed, 1);
  const [record] = missedOrders(db);
  assert.equal(record.reasonCode, 'cancel_trace');
  assert.match(record.reason, /취소 흔적/);
});

test('등록 보류 사유 문구는 상황별로 갈린다', () => {
  assert.equal(imwebSyncModule.missedReason(false, '', '2026-09-10').reasonCode, 'unknown_date');
  assert.equal(imwebSyncModule.missedReason(true, '2026-08-24', '2026-09-10').reasonCode, 'cancel_trace');
  assert.equal(imwebSyncModule.missedReason(false, '2026-08-24', '2026-09-10').reasonCode, 'before_cutoff');
  assert.match(imwebSyncModule.missedReason(false, '2026-08-24', '2026-09-10').reason, /2026-09-10/);
});

test('등록용 문서가 빠진 옛 보류 기록은 다시 채우고 확인 표시는 지키지 않는다', async () => {
  // 예전 버전이 남긴 기록에는 customerData 가 없다. 그대로 두면 화면에서 등록할 수 없다.
  const db = fakeDb({
    'imwebMissedOrders/202608240989736': {
      syncKey: '202608240989736', orderNo: '202608240989736', name: '차진'
    }
  });
  const client = fakeClient([order('202608240989736')], {
    '202608240989736': [subItem('주 3회|월/수/금 조리|총 12회')]
  });

  await syncImwebOrders({ db, client, env: {}, registerFrom: '2026-09-01' });

  const [record] = missedOrders(db);
  assert.ok(record.customerData, '등록용 문서가 채워져야 한다');
  assert.equal(record.customerData.orderType, 'sub');
  assert.equal(record.name, '차진');
});
