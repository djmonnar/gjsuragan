'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const rootDir = path.resolve(__dirname, '../../..');
const adminSource = fs.readFileSync(path.join(rootDir, 'admin.html'), 'utf8');
const customerSource = fs.readFileSync(path.join(rootDir, 'customer.html'), 'utf8');

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

const adminPricing = vm.runInNewContext(`(() => {
  ${extractFunction(adminSource, 'function userLunchPrice')}
  ${extractFunction(adminSource, 'function userSaladPrice')}
  return { userLunchPrice, userSaladPrice };
})()`);

const settlementPricesSource = extractFunction(customerSource, 'function customerSettlementPrices');
const registrationSource = extractFunction(customerSource, 'async function doRegister');

function customerSettlementPrices(userProfile, settlement) {
  const pricing = vm.runInNewContext(`((userProfile) => {
    ${settlementPricesSource}
    return customerSettlementPrices;
  })`)(userProfile);
  return JSON.parse(JSON.stringify(pricing(settlement)));
}

test('가격 필드가 없는 고객은 PR 이전과 같이 관리자 가격이 0이다', () => {
  assert.equal(adminPricing.userLunchPrice({}), 0);
  assert.equal(adminPricing.userSaladPrice({}), 0);
  assert.doesNotMatch(extractFunction(adminSource, 'function userLunchPrice'), /8000|DEFAULT_USER_MEAL_PRICE/);
  assert.doesNotMatch(extractFunction(adminSource, 'function userSaladPrice'), /8000|DEFAULT_USER_MEAL_PRICE/);
});

test('가격 필드가 없는 고객 정산은 임의의 8000원 대신 0이다', () => {
  assert.deepEqual(customerSettlementPrices({}, {}), { lunch: 0, salad: 0, eventLunch: 0 });
  assert.doesNotMatch(settlementPricesSource, /8000|DEFAULT_MEAL_PRICE/);
});

test('관리자 또는 기존 고객에게 저장된 가격은 그대로 사용한다', () => {
  assert.equal(adminPricing.userLunchPrice({ lunchPrice: 7500 }), 7500);
  assert.equal(adminPricing.userLunchPrice({ priceLunch: 7200 }), 7200);
  assert.equal(adminPricing.userSaladPrice({ saladPrice: 6800 }), 6800);
  assert.equal(adminPricing.userSaladPrice({ priceSalad: 6500 }), 6500);

  assert.deepEqual(
    customerSettlementPrices({ lunchPrice: 7500, saladPrice: 6800 }, {}),
    { lunch: 7500, salad: 6800, eventLunch: 7500 }
  );
});

test('정산에 저장된 가격과 행사도시락 가격이 프로필 가격보다 우선한다', () => {
  assert.deepEqual(
    customerSettlementPrices(
      { lunchPrice: 7500, saladPrice: 6800 },
      { lunchPrice: 8100, saladPrice: 7900, eventPrice: 15000 }
    ),
    { lunch: 8100, salad: 7900, eventLunch: 15000 }
  );
});

test('신규 가입 payload는 가격 필드를 자동 저장하지 않는다', () => {
  assert.doesNotMatch(registrationSource, /\b(?:lunchPrice|saladPrice|priceLunch|priceSalad)\s*:/);
  assert.doesNotMatch(registrationSource, /DEFAULT_MEAL_PRICE/);
});
