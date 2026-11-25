'use strict';

// 업체 배송지: 관리자 쪽(userPrivate)이 비어 있으면 손님이 내 정보에서 넣은 주소(users)를 쓴다 (2026-11-25).
// 관리자가 주소 없이 먼저 등록한 업체의 주소가 빈 관리자 값에 가려 기사님 화면에 안 나왔다.
// 서버(functions/userPrivateMerge.js)와 관리자 화면(admin.html)이 같게 합치는지, 기사님 화면이
// 빈 주소를 「주소 미입력」으로 알리는지, 매뉴얼이 같은 문구를 적는지 본다.

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const { mergeUserPrivate } = require('../../userPrivateMerge');
const M = require('../../monthlyDeliveryModel');

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

const adminMerge = vm.runInNewContext(`${extractFunction(read('admin.html'), 'function mergeUserPrivate(')}\nmergeUserPrivate`, {});

const CASES = [
  {
    name: '관리자 배송지가 비면 손님 주소와 상세주소를 쓴다',
    user: { businessName: '가상 업체', deliveryPlace: '경남 진주시 가상로 1', deliveryPlaceDetail: '3층' },
    priv: { deliveryPlace: '', deliveryPlaceDetail: '', adminMemo: '관리자 메모' },
    expect: { deliveryPlace: '경남 진주시 가상로 1', deliveryPlaceDetail: '3층', adminMemo: '관리자 메모' }
  },
  {
    name: '빈칸만 있는 관리자 배송지도 빈 것으로 본다',
    user: { deliveryPlace: '경남 진주시 가상로 1' },
    priv: { deliveryPlace: '   ', deliveryPlaceDetail: '옛 상세' },
    expect: { deliveryPlace: '경남 진주시 가상로 1', deliveryPlaceDetail: '' }
  },
  {
    name: '관리자 배송지가 있으면 관리자 값이 이긴다',
    user: { deliveryPlace: '손님 주소', deliveryPlaceDetail: '손님 상세' },
    priv: { deliveryPlace: '관리자 주소', deliveryPlaceDetail: '관리자 상세' },
    expect: { deliveryPlace: '관리자 주소', deliveryPlaceDetail: '관리자 상세' }
  },
  {
    name: 'userPrivate 문서가 없으면 손님 문서 그대로',
    user: { deliveryPlace: '손님 주소', deliveryPlaceDetail: '' },
    priv: undefined,
    expect: { deliveryPlace: '손님 주소', deliveryPlaceDetail: '' }
  },
  {
    name: '둘 다 비면 빈 채로 둔다',
    user: { businessName: '가상 업체' },
    priv: { deliveryPlace: '' },
    expect: { deliveryPlace: '' }
  },
  {
    name: '옛 address 칸도 같은 규칙',
    user: { address: '옛 손님 주소' },
    priv: { address: '' },
    expect: { address: '옛 손님 주소' }
  },
  {
    name: '배송지 말고는 관리자 값이 빈칸이어도 이긴다',
    user: { adminMemo: '예전 메모', disposableLunch: true },
    priv: { adminMemo: '', disposableLunch: false },
    expect: { adminMemo: '', disposableLunch: false }
  }
];

for (const item of CASES) {
  test(`배송지 합치기: ${item.name}`, () => {
    const merged = mergeUserPrivate(item.user, item.priv);
    for (const [key, value] of Object.entries(item.expect)) assert.equal(merged[key], value, key);
    assert.deepEqual({ ...adminMerge(item.user, item.priv) }, merged, '관리자 화면도 같게 합쳐야 한다');
  });
}

test('없는 문서(null·undefined)를 받아도 깨지지 않는다', () => {
  assert.deepEqual(mergeUserPrivate(undefined, undefined), {});
  assert.deepEqual(mergeUserPrivate(null, { deliveryPlace: '관리자 주소' }), { deliveryPlace: '관리자 주소' });
  assert.deepEqual({ ...adminMerge(null, null) }, {});
});

test('월식 배송·카톡 목록은 모두 이 규칙으로 합친다', () => {
  for (const file of ['functions/monthlyDelivery.js', 'functions/index.js']) {
    const source = read(file);
    assert.match(source, /mergeUserPrivate\(/, `${file} 가 mergeUserPrivate 를 써야 한다`);
    assert.doesNotMatch(source, /\.\.\.\(privateByUid\[doc\.id\] \|\| \{\}\)/, `${file} 에 옛 합치기가 남아 있다`);
    assert.doesNotMatch(source, /\.\.\.\(privateUsers\[uid\] \|\| \{\}\)/, `${file} 에 옛 합치기가 남아 있다`);
  }
  assert.doesNotMatch(read('admin.html'), /\{ \.\.\.publicData, \.\.\.\(privateByUid\[doc\.id\] \|\| \{\}\)/);
});

test('합친 업체 정보로 기사님 줄에 손님 주소가 나온다', () => {
  const user = mergeUserPrivate(
    { businessName: '가상 업체', defaultLunch: 2, deliveryPlace: '경남 진주시 가상로 1', deliveryPlaceDetail: '3층' },
    { deliveryPlace: '', deliveryPlaceDetail: '' }
  );
  const [row] = M.resolveRows({ date: '2026-10-07', users: { a: user } });
  assert.equal(row.address, '경남 진주시 가상로 1');
  assert.equal(row.addressDetail, '3층');
});

test('잠금 스냅숏의 빈 배송지가 지금 배송지를 가리지 않는다', () => {
  // 주소가 비어 있을 때 잠근 날: 스냅숏에 빈 배송지가 얼어 있다. 수량은 스냅숏대로.
  const users = { a: { businessName: '가상 업체', defaultLunch: 2, deliveryPlace: '경남 진주시 가상로 1', deliveryPlaceDetail: '3층' } };
  const snapshots = { a: { uid: 'a', businessName: '가상 업체', lunchCount: 5, saladCount: 0, deliveryPlace: '' } };
  const [row] = M.resolveRows({ date: '2026-10-07', users, snapshots, locked: true });
  assert.equal(row.lunchCount, 5, '수량은 잠근 값');
  assert.equal(row.address, '경남 진주시 가상로 1');
  assert.equal(row.addressDetail, '3층');

  // 잠근 순간 주소가 있었으면 그 주소가 그대로 간다.
  const [frozen] = M.resolveRows({ date: '2026-10-07', users, snapshots: { a: { ...snapshots.a, deliveryPlace: '잠근 주소' } }, locked: true });
  assert.equal(frozen.address, '잠근 주소');
});

test('관리자 주문 화면도 잠금 스냅숏을 같은 규칙으로 얹는다', () => {
  assert.match(read('admin.html'), /defaultSourceMap\.set\(uid, mergeUserPrivate\(allUsers\[uid\], user\)\)/);
});

test('행사 정류장은 상세주소도 싣는다', () => {
  const [row] = M.eventRows({
    date: '2026-10-07',
    administrators: [],
    publicOrders: { p1: { eventDate: '2026-10-07', place: '가상 행사장', placeDetail: '2층 회의실', items: [{ name: '도시락', qty: 3 }] } }
  });
  assert.equal(row.address, '가상 행사장');
  assert.equal(row.addressDetail, '2층 회의실');
});

const driver = read('assets/js/monthly-delivery-driver.js');
const NO_ADDRESS = /const NO_ADDRESS = '([^']+)';/.exec(driver)?.[1];

function driverContact() {
  const code = [
    "const esc = value => String(value ?? '').replace(/[&<>\"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '\"':'&quot;', \"'\":'&#39;' }[c]));",
    `const NO_ADDRESS = ${JSON.stringify(NO_ADDRESS)};`,
    extractFunction(driver, 'function contact('),
    'contact'
  ].join('\n');
  return vm.runInNewContext(code, {});
}

test('기사님 화면: 주소가 없으면 「주소 미입력」을 띄우고 길찾기를 뺀다', () => {
  assert.ok(NO_ADDRESS, 'NO_ADDRESS 문구를 찾지 못했습니다');
  const contact = driverContact();
  const empty = contact({ address: '', phone: '010-0000-0000' });
  assert.match(empty, /md-no-address/);
  assert.ok(empty.includes(NO_ADDRESS));
  assert.doesNotMatch(empty, /길찾기/);
  assert.match(empty, /tel:01000000000/, '전화는 그대로 둔다');
  assert.match(contact({ address: '   ' }), /md-no-address/, '빈칸만 있는 주소도 비어 있는 것');

  const filled = contact({ address: '경남 진주시 가상로 1', addressDetail: '3층' });
  assert.doesNotMatch(filled, /md-no-address/);
  assert.match(filled, /경남 진주시 가상로 1 3층/);
  assert.match(filled, /길찾기/);
});

test('매뉴얼이 기사님 화면과 같은 문구를 적는다', () => {
  assert.ok(read('manual.html').includes(`「${NO_ADDRESS}」`), 'manual.html 의 월식 배송 안내에 주소 미입력 문구가 없다');
  assert.match(read('assets/css/monthly-delivery.css'), /\.md-no-address\{/);
});
