const test = require('node:test');
const assert = require('node:assert/strict');

const parser = require('../../imwebParser');
const imwebSync = require('../../imwebSync');

function subItem(prodName, optionText, extra = {}) {
  return {
    prod_name: prodName,
    options: [{ value_name_list: optionText.split('|') }],
    ...extra
  };
}

// 2026-08-24(월) 12:03 KST 주문. 차진 고객 실제 주문번호 202608240989736 상황.
const CHAJIN_ORDER_TIME = Math.floor(Date.UTC(2026, 7, 24, 3, 3) / 1000);

function chajinOrder() {
  return {
    order_no: '202608240989736',
    order_date: '20260824',
    order_time: CHAJIN_ORDER_TIME,
    delivery: {
      memo: '공동 현관 비밀번호: #1234',
      address: {
        name: '차진',
        phone: '010-4146-8860',
        address: '경남 진주시 서장대로278번길',
        address_detail: '8'
      }
    }
  };
}

test('한 주문의 정기구독 두 줄이 각각 등록된다', () => {
  const order = chajinOrder();
  const items = [
    subItem('반찬 정기구독 A세트', '주 3회|월/수/금 조리|총 12회', { delivery: { deliv_type: 'direct' } }),
    subItem('반찬 정기구독 A세트', '주 2회|화/목 조리|총 8회', { delivery: { deliv_type: 'direct' } })
  ];

  const entries = parser.parseOrderItems(order, order.order_no, items);

  assert.equal(entries.length, 2, '상품 줄 수만큼 등록 대상이 나와야 한다');
  assert.ok(entries.every(entry => entry.isSub));

  const [first, second] = entries;
  assert.equal(first.syncKey, '202608240989736', '첫 줄은 주문번호 그대로여야 기존 등록과 충돌하지 않는다');
  assert.equal(second.syncKey, '202608240989736-2');

  assert.equal(first.parsed.scheduleName, '월·수·금 조리 → 화·목·토 도착');
  assert.deepEqual(first.parsed.cookDays, [1, 3, 5]);
  assert.equal(first.parsed.total, 12);

  assert.equal(second.parsed.scheduleName, '화·목 조리 → 수·금 도착');
  assert.deepEqual(second.parsed.cookDays, [2, 4]);
  assert.equal(second.parsed.total, 8, '두 번째 줄의 총 회수를 따로 읽어야 한다');
  assert.equal(second.parsed.remain, 8);
});

test('정기구독 두 줄을 합치면 뒤쪽 일정이 사라진다 — 예전 동작 재현', () => {
  // 예전 앱스스크립트는 옵션값을 이어붙여 한 건만 만들었다.
  // matchSchedule 이 맨 앞의 '조리' 하나만 잡아서 화·목이 통째로 없어졌다.
  const merged = parser.matchSchedule('주 3회 월/수/금 조리 총 12회 주 2회 화/목 조리 총 8회');
  assert.deepEqual(merged.cookDays, [1, 3, 5], '앞의 월·수·금만 남고');
  assert.equal(merged.cookDays.includes(2), false, '뒤의 화 조리는 사라진다');
  assert.equal(merged.cookDays.includes(4), false, '뒤의 목 조리는 사라진다');
  // 총 회수도 앞의 것만 잡혀서 뒤쪽 구독의 12회가 8회를 덮어썼다.
  assert.equal('주 3회 월/수/금 조리 총 12회 주 2회 화/목 조리 총 8회'.match(/총\s*(\d+)회/)[1], '12');
});

test('첫 배송일은 조리 전날 12시 마감을 지킨다', () => {
  const order = chajinOrder();
  const item = subItem('반찬 정기구독 A세트', '주 2회|화/목 조리|총 8회');
  const { parsed } = parser.parseOrderItems(order, order.order_no, [item])[0];
  // 8/24(월) 12:03 주문 → 8/25(화) 조리는 전날 마감을 넘겼으므로 8/27(목)이 첫 조리일.
  assert.equal(parsed.startDate, '2026-08-27');
});

test('마감 전 주문은 다음 조리일에 바로 잡힌다', () => {
  const beforeCutoff = Math.floor(Date.UTC(2026, 7, 24, 1, 0) / 1000); // 8/24(월) 10:00 KST
  assert.equal(parser.firstShipDate([2, 4], beforeCutoff), '2026-08-25');
});

test('정기와 선택이 섞인 주문도 줄마다 따로 판단한다', () => {
  const order = chajinOrder();
  const items = [
    subItem('반찬 정기구독 A세트', '주 2회|화/목 조리|총 8회'),
    { prod_name: '수제 돼지양념갈비', options: [], payment: { count: 2 } }
  ];

  const entries = parser.parseOrderItems(order, order.order_no, items);
  assert.equal(entries[0].isSub, true);
  assert.equal(entries[0].parsed.orderType, 'sub');
  assert.equal(entries[1].isSub, false);
  assert.equal(entries[1].parsed.orderType, 'once');
  assert.equal(entries[1].parsed.qty, 2);
  // 단품은 12시 이후 주문이라 다음날로 넘어간다.
  assert.equal(entries[1].parsed.onceDate, '2026-08-25');
});

test('상품을 알아보지 못하면 등록하지 않는다', () => {
  const order = chajinOrder();
  const entries = parser.parseOrderItems(order, order.order_no, [
    { prod_name: '알 수 없는 상품', options: [] }
  ]);
  assert.equal(entries[0].parsed, null);
});

test('배송일을 못 찾은 세트는 확인 필요로 멈춘다', () => {
  const order = chajinOrder();
  const entries = parser.parseOrderItems(order, order.order_no, [
    { prod_name: 'B세트 반찬', options: [] }
  ]);
  const { parsed } = entries[0];
  assert.equal(parsed.status, 'pause');
  assert.equal(parsed.needsReview, true);
  assert.equal(parsed.onceDate, '');
});

test('상품명에서 배송일을 읽는다', () => {
  const order = chajinOrder();
  const entries = parser.parseOrderItems(order, order.order_no, [
    { prod_name: 'C세트 9월 3일 배송', options: [] }
  ]);
  assert.equal(entries[0].parsed.onceDate, '2026-09-03');
  assert.equal(entries[0].parsed.needsReview, false);
});

test('직배송은 옵션의 희망날짜를 쓴다', () => {
  const order = chajinOrder();
  const entries = parser.parseOrderItems(order, order.order_no, [
    {
      prod_name: 'A세트',
      delivery: { deliv_type: 'direct' },
      options: [{ value_name_list: ['배송희망날짜 9/2'] }]
    }
  ]);
  assert.equal(entries[0].parsed.onceDate, '2026-09-02');
  assert.equal(entries[0].parsed.isDirect, true);
});

test('공동현관 비밀번호를 배송메모에서 뽑는다', () => {
  assert.equal(parser.parseDoor('공동 현관 비밀번호: #1234'), '#1234');
  assert.equal(parser.parseDoor('택배 보관함에 넣어주세요'), '');
});

test('주문 상태를 취소·종료·허용으로 가른다', () => {
  assert.equal(parser.isCancelStatus('취소완료'), true);
  assert.equal(parser.isCancelStatus('pay_cancel'), true);
  assert.equal(parser.isTerminalStatus('배송완료'), true);
  assert.equal(parser.isAllowStatus('배송 보류'), true);
  assert.equal(parser.isAllowStatus('pay_done'), true);
  assert.equal(parser.isAllowStatus('배송완료'), false);
});

test('syncKey 는 첫 줄만 주문번호를 그대로 쓴다', () => {
  assert.equal(parser.buildSyncKey('123', 1), '123');
  assert.equal(parser.buildSyncKey('123', 2), '123-2');
});

test('동기화는 IMWEB_SYNC_ENABLED 가 true 일 때만 켜진다', () => {
  assert.equal(imwebSync.isSyncEnabled({}), false);
  assert.equal(imwebSync.isSyncEnabled({ IMWEB_SYNC_ENABLED: 'false' }), false);
  assert.equal(imwebSync.isSyncEnabled({ IMWEB_SYNC_ENABLED: 'true' }), true);
  assert.equal(imwebSync.isSyncEnabled({ IMWEB_SYNC_ENABLED: 'TRUE' }), true);
});

test('config/imwebSync 문서가 켜고 끄는 스위치가 된다', async () => {
  const configDoc = value => ({
    collection: () => ({ doc: () => ({ async get() { return value; } }) })
  });

  assert.equal(await imwebSync.loadSyncEnabled(configDoc({ exists: false }), {}), false,
    '문서가 없으면 꺼진 것으로 본다');
  assert.equal(await imwebSync.loadSyncEnabled(configDoc({ exists: true, data: () => ({}) }), {}), false);
  assert.equal(await imwebSync.loadSyncEnabled(configDoc({ exists: true, data: () => ({ enabled: false }) }), {}), false);
  assert.equal(await imwebSync.loadSyncEnabled(configDoc({ exists: true, data: () => ({ enabled: true }) }), {}), true);

  const throwingDb = { collection: () => { throw new Error('권한 없음'); } };
  assert.equal(await imwebSync.loadSyncEnabled(throwingDb, {}), false,
    '설정을 못 읽으면 켜지 않는다');
  assert.equal(await imwebSync.loadSyncEnabled(throwingDb, { IMWEB_SYNC_ENABLED: 'true' }), true,
    '환경변수로도 켤 수 있다');
});

test('취소 삭제 대상은 주문번호와 하위 줄까지 찾는다', () => {
  const existing = new Map([
    ['202608240989736', [{ id: 'a' }]],
    ['202608240989736-2', [{ id: 'b' }]],
    ['202608240989737', [{ id: 'c' }]]
  ]);
  const ids = imwebSync.recordsForOrderNo(existing, '202608240989736').map(r => r.id);
  assert.deepEqual(ids.sort(), ['a', 'b']);
});
