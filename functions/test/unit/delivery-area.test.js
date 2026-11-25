'use strict';

// 배송 권역. 진주는 직배송, 사천은 직배송을 가지 않고 택배로 보낸다 (2026-11).
// 관리자 화면(auth-core.js·rendering.js)과 아임웹 자동등록(imwebParser.js)이 같은 판단을 해야 한다.
// 화면 함수를 소스에서 그대로 뽑아 돌린다.

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const parser = require('../../imwebParser');

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

function extractConst(source, name) {
  const match = new RegExp(`const ${name} = [^;]+;`).exec(source);
  assert.ok(match, `${name} 상수를 찾지 못했습니다.`);
  return match[0];
}

const authCore = read('assets/js/auth-core.js');
const rendering = read('assets/js/rendering.js');

function load() {
  const asked = [];
  const context = {
    asked,
    answer: true,
    confirm(message) { asked.push(message); return context.answer; },
    // customerRiskReasons 가 부르는 다른 화면 함수는 이 테스트와 상관없는 값으로 둔다.
    riskOrderDateValid: () => true,
    customerOrderDate: () => '',
    customerProductKey: () => 'A',
    customerUniqueBy: (items, key) => items.filter((item, index) => items.findIndex(other => key(other) === key(item)) === index)
  };
  const code = [
    extractConst(authCore, 'DIRECT_AREA_PATTERN'),
    extractConst(authCore, 'COURIER_ONLY_AREA_PATTERN'),
    extractFunction(authCore, 'function isCourierOnlyArea('),
    extractFunction(authCore, 'function isDirectDeliveryArea('),
    extractFunction(authCore, 'function confirmDeliveryTypeForArea('),
    extractFunction(rendering, 'function customerRiskReasons('),
    'globalThis.api = { isCourierOnlyArea, isDirectDeliveryArea, confirmDeliveryTypeForArea, customerRiskReasons };'
  ].join('\n');
  vm.runInNewContext(code, context);
  return context;
}

const JINJU = '경남 진주시 가상로 1';
const SACHEON = '경남 사천시 가상로 12';
const ELSEWHERE = '서울 강남구 가상로 3';

test('진주는 직배송 권역, 사천은 택배 권역이다', () => {
  const { api } = load();
  assert.equal(api.isDirectDeliveryArea(JINJU), true);
  assert.equal(api.isDirectDeliveryArea(SACHEON), false, '사천은 더 이상 직배송 권역이 아니다');
  assert.equal(api.isCourierOnlyArea(SACHEON), true);
  assert.equal(api.isCourierOnlyArea(JINJU), false);
  assert.equal(api.isDirectDeliveryArea(''), false);
  assert.equal(api.isCourierOnlyArea(undefined), false);
});

test('관리자 화면과 아임웹 자동등록이 사천을 똑같이 본다', () => {
  const { api } = load();
  for (const address of [JINJU, SACHEON, ELSEWHERE, '경남 사천시 사천읍', '']) {
    assert.equal(api.isCourierOnlyArea(address), parser.isCourierOnlyArea(address), address);
  }
});

test('사천을 직배송으로 저장하려 하면 한 번 묻는다', () => {
  const ctx = load();
  ctx.answer = false;
  assert.equal(ctx.api.confirmDeliveryTypeForArea(SACHEON, true), false, '취소하면 저장하지 않는다');
  assert.equal(ctx.asked.length, 1);
  assert.match(ctx.asked[0], /사천은 직배송을 가지 않고 택배로/);
  ctx.answer = true;
  assert.equal(ctx.api.confirmDeliveryTypeForArea(SACHEON, true), true, '그래도 직배송이면 막지는 않는다');
});

test('사천 택배는 묻지 않고 저장한다', () => {
  const ctx = load();
  assert.equal(ctx.api.confirmDeliveryTypeForArea(SACHEON, false), true);
  assert.equal(ctx.asked.length, 0);
});

test('진주를 택배로 저장하려 하면 한 번 묻는다', () => {
  const ctx = load();
  ctx.answer = false;
  assert.equal(ctx.api.confirmDeliveryTypeForArea(JINJU, false), false);
  assert.match(ctx.asked[0], /진주 지역/);
  assert.doesNotMatch(ctx.asked[0], /사천/);
  assert.equal(ctx.api.confirmDeliveryTypeForArea(JINJU, true), true, '진주 직배송은 묻지 않는다');
  assert.equal(ctx.api.confirmDeliveryTypeForArea(ELSEWHERE, false), true);
  assert.equal(ctx.asked.length, 1);
});

test('사천 직배송 주문은 확인 필요로 뜬다', () => {
  const { api } = load();
  const reasons = api.customerRiskReasons({ status: 'active', isDirect: true, addr: SACHEON, orderType: 'sub' });
  assert.deepEqual([...reasons], ['사천 지역인데 직배송입니다 (사천은 택배)']);
});

test('사천 택배·끝난 주문, 진주 직배송은 확인 필요가 아니다', () => {
  const { api } = load();
  assert.equal(api.customerRiskReasons({ status: 'active', isDirect: false, addr: SACHEON, orderType: 'sub' }).length, 0);
  assert.equal(api.customerRiskReasons({ status: 'end', isDirect: true, addr: SACHEON, orderType: 'sub' }).length, 0);
  assert.equal(api.customerRiskReasons({ status: 'active', isDirect: true, addr: JINJU, orderType: 'sub' }).length, 0);
});

test('진주 택배 주문은 확인 필요로 뜬다', () => {
  const { api } = load();
  const reasons = api.customerRiskReasons({ status: 'active', isDirect: false, address: JINJU, orderType: 'sub' });
  assert.deepEqual([...reasons], ['진주 지역인데 택배배송입니다']);
});

test('매뉴얼이 사천을 직배송 지역으로 적지 않는다', () => {
  for (const file of ['manual.html', 'src/index/parts/38-page-manual.html', 'src/index/parts/50-modal-add.html']) {
    assert.doesNotMatch(read(file), /사천·진주/, `${file} 에 옛 안내(사천·진주 직배송)가 남아 있다`);
  }
});
