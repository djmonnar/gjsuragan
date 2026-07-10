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

function extractNumericConstant(source, name) {
  const match = source.match(new RegExp(`const\\s+${name}\\s*=\\s*(\\d+)`));
  assert.ok(match, `${name} 상수를 찾지 못했습니다.`);
  return Number(match[1]);
}

const adminDefaultMealPrice = extractNumericConstant(adminSource, 'DEFAULT_MEAL_PRICE');
const customerDefaultMealPrice = extractNumericConstant(customerSource, 'DEFAULT_MEAL_PRICE');

const adminPricing = vm.runInNewContext(`(() => {
  const DEFAULT_MEAL_PRICE = ${adminDefaultMealPrice};
  ${extractFunction(adminSource, 'function userLunchPrice')}
  ${extractFunction(adminSource, 'function userSaladPrice')}
  return { userLunchPrice, userSaladPrice };
})()`);

const settlementPricesSource = extractFunction(customerSource, 'function customerSettlementPrices');
const registrationSource = extractFunction(customerSource, 'async function doRegister');
const eventSettlementRowSource = extractFunction(adminSource, 'function eventSettlementRow');

function customerSettlementPrices(userProfile, settlement) {
  const pricing = vm.runInNewContext(`((userProfile) => {
    const DEFAULT_MEAL_PRICE = ${customerDefaultMealPrice};
    ${settlementPricesSource}
    return customerSettlementPrices;
  })`)(userProfile);
  return JSON.parse(JSON.stringify(pricing(settlement)));
}

test('월식 기본가격 상수는 관리자와 고객 화면에서 8000원이다', () => {
  assert.equal(adminDefaultMealPrice, 8000);
  assert.equal(customerDefaultMealPrice, 8000);
});

test('가격 필드가 없는 월식 고객의 관리자 가격은 8000원이다', () => {
  assert.equal(adminPricing.userLunchPrice({}), 8000);
  assert.equal(adminPricing.userSaladPrice({}), 8000);
  assert.match(extractFunction(adminSource, 'function userLunchPrice'), /\?\?\s*DEFAULT_MEAL_PRICE/);
  assert.match(extractFunction(adminSource, 'function userSaladPrice'), /\?\?\s*DEFAULT_MEAL_PRICE/);
  assert.doesNotMatch(extractFunction(adminSource, 'function userLunchPrice'), /\|\|\s*DEFAULT_MEAL_PRICE/);
  assert.doesNotMatch(extractFunction(adminSource, 'function userSaladPrice'), /\|\|\s*DEFAULT_MEAL_PRICE/);
});

test('가격 필드가 없는 월식 고객 정산은 8000원이고 행사 가격은 별도다', () => {
  assert.deepEqual(customerSettlementPrices({}, {}), { lunch: 8000, salad: 8000, eventLunch: 0 });
  assert.doesNotMatch(settlementPricesSource, /\|\|\s*DEFAULT_MEAL_PRICE/);
});

test('관리자가 지정한 9000원은 기본가격보다 우선한다', () => {
  assert.equal(adminPricing.userLunchPrice({ lunchPrice: 9000 }), 9000);
  assert.equal(adminPricing.userSaladPrice({ saladPrice: 9000 }), 9000);
  assert.deepEqual(
    customerSettlementPrices({ lunchPrice: 9000, saladPrice: 9000 }, {}),
    { lunch: 9000, salad: 9000, eventLunch: 9000 }
  );
});

test('기존 lunchPrice와 saladPrice 값은 그대로 사용한다', () => {
  assert.equal(adminPricing.userLunchPrice({ lunchPrice: 7500 }), 7500);
  assert.equal(adminPricing.userSaladPrice({ saladPrice: 6800 }), 6800);
  assert.deepEqual(
    customerSettlementPrices({ lunchPrice: 7500, saladPrice: 6800 }, {}),
    { lunch: 7500, salad: 6800, eventLunch: 7500 }
  );
});

test('기존 priceLunch와 priceSalad만 있어도 해당 값을 사용한다', () => {
  assert.equal(adminPricing.userLunchPrice({ priceLunch: 7200 }), 7200);
  assert.equal(adminPricing.userSaladPrice({ priceSalad: 6500 }), 6500);
  assert.deepEqual(
    customerSettlementPrices({ priceLunch: 7200, priceSalad: 6500 }, {}),
    { lunch: 7200, salad: 6500, eventLunch: 0 }
  );
});

test('관리자가 명시적으로 지정한 0원은 8000원으로 바뀌지 않는다', () => {
  assert.equal(adminPricing.userLunchPrice({ lunchPrice: 0, priceLunch: 9000 }), 0);
  assert.equal(adminPricing.userSaladPrice({ saladPrice: 0, priceSalad: 9000 }), 0);
  assert.deepEqual(
    customerSettlementPrices(
      { lunchPrice: 9000, saladPrice: 9000 },
      { lunchPrice: 0, saladPrice: 0, eventPrice: 0 }
    ),
    { lunch: 0, salad: 0, eventLunch: 0 }
  );
});

test('정산에 저장된 월식 가격과 행사 가격이 프로필 가격보다 우선한다', () => {
  assert.deepEqual(
    customerSettlementPrices(
      { lunchPrice: 7500, saladPrice: 6800 },
      { lunchPrice: 8100, saladPrice: 7900, eventPrice: 15000 }
    ),
    { lunch: 8100, salad: 7900, eventLunch: 15000 }
  );
});

test('별도 행사도시락 정산은 기존 행사 품목 가격 계산을 유지한다', () => {
  assert.match(eventSettlementRowSource, /eventAveragePrice\(item\)/);
  assert.doesNotMatch(eventSettlementRowSource, /DEFAULT_MEAL_PRICE/);
});

test('신규 가입 payload는 가격 필드를 자동 저장하지 않는다', () => {
  assert.doesNotMatch(registrationSource, /\b(?:lunchPrice|saladPrice|priceLunch|priceSalad)\s*:/);
  assert.doesNotMatch(registrationSource, /DEFAULT_MEAL_PRICE/);
});

test('기본가격 계산은 기존 고객 객체에 가격 필드를 쓰거나 마이그레이션하지 않는다', () => {
  const profile = {};
  assert.equal(adminPricing.userLunchPrice(profile), 8000);
  assert.deepEqual(customerSettlementPrices(profile, {}), { lunch: 8000, salad: 8000, eventLunch: 0 });
  assert.deepEqual(profile, {});
  assert.doesNotMatch(extractFunction(adminSource, 'function userLunchPrice'), /\.(?:set|update|add)\s*\(/);
  assert.doesNotMatch(settlementPricesSource, /\.(?:set|update|add)\s*\(/);
});
