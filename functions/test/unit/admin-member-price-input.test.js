'use strict';

// 고객정보 창에서 단가 칸을 비워두면 0원으로 저장되던 문제.
//
// 센코필라테스(2026-09-22 관리자 등록)는 단가 칸을 비운 채 저장됐다. 칸에는 흐린
// 안내 글씨로 8000 이 보여 입력된 줄 알았지만 실제로는 lunchPrice: 0 이 들어갔고,
// 배송 목록 금액은 '-', 9월 정산(8개)과 10월 정산은 0원 청구로 2주 동안 쌓였다.
//
// 빈 칸은 기본 단가로 저장하고, 0 은 일부러 넣은 0원으로 남긴다.
// 화면도 저장된 값을 그대로 보여준다(0원이면 0).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const rootDir = path.resolve(__dirname, '../../..');
const adminSource = fs.readFileSync(path.join(rootDir, 'admin.html'), 'utf8');

function extractFunction(signature) {
  const start = adminSource.indexOf(signature);
  assert.notEqual(start, -1, `${signature} 함수를 찾지 못했습니다.`);
  const bodyStart = adminSource.indexOf('{', adminSource.indexOf(')', start));
  let depth = 0;
  for (let index = bodyStart; index < adminSource.length; index += 1) {
    if (adminSource[index] === '{') depth += 1;
    if (adminSource[index] === '}') {
      depth -= 1;
      if (depth === 0) return adminSource.slice(start, index + 1);
    }
  }
  throw new Error(`${signature} 함수 끝을 찾지 못했습니다.`);
}

const defaultMealPrice = Number(adminSource.match(/const\s+DEFAULT_MEAL_PRICE\s*=\s*(\d+)/)[1]);
const defaultMealPriceLabel = `${defaultMealPrice.toLocaleString('ko-KR')}원`;

const pricing = vm.runInNewContext(`(() => {
  const DEFAULT_MEAL_PRICE = ${defaultMealPrice};
  ${extractFunction('function parsePrice(')}
  ${extractFunction('function memberPriceFromInput(')}
  ${extractFunction('function userLunchPrice(')}
  ${extractFunction('function settlementLunchAmount(')}
  return { memberPriceFromInput, userLunchPrice, settlementLunchAmount };
})()`);

test('단가 칸을 비워두면 기본 단가로 저장한다', () => {
  assert.equal(pricing.memberPriceFromInput(''), defaultMealPrice);
  assert.equal(pricing.memberPriceFromInput('   '), defaultMealPrice);
  assert.equal(pricing.memberPriceFromInput(undefined), defaultMealPrice);
  assert.equal(pricing.memberPriceFromInput(null), defaultMealPrice);
});

test('입력한 단가는 그대로 저장하고, 0 은 일부러 넣은 0원으로 남긴다', () => {
  assert.equal(pricing.memberPriceFromInput('8500'), 8500);
  assert.equal(pricing.memberPriceFromInput('7000'), 7000);
  assert.equal(pricing.memberPriceFromInput('0'), 0);
});

test('숫자가 아니거나 음수여도 NaN·음수 단가가 저장되지 않는다', () => {
  assert.equal(pricing.memberPriceFromInput('abc'), defaultMealPrice);
  assert.equal(pricing.memberPriceFromInput('-500'), 0);
  ['', 'abc', '-500', '0', '8500', undefined].forEach(raw => {
    const price = pricing.memberPriceFromInput(raw);
    assert.ok(Number.isInteger(price) && price >= 0, `${raw} → ${price}`);
  });
});

test('단가를 비운 채 등록한 업체도 배송 8개가 0원이 되지 않는다', () => {
  // 센코필라테스 9월: 2개씩 4일 = 8개
  const lunchPrice = pricing.memberPriceFromInput('');
  const user = { lunchPrice, priceLunch: lunchPrice };
  assert.equal(pricing.settlementLunchAmount({ lunch: 8, lunchPrice: pricing.userLunchPrice(user) }), 8 * defaultMealPrice);
  assert.equal(pricing.settlementLunchAmount({ lunch: 8, lunchPrice: pricing.userLunchPrice(user) }), 64000);
});

test('고객정보 저장은 단가 칸을 memberPriceFromInput 으로 읽는다', () => {
  const saveSource = extractFunction('async function saveMember(');
  assert.match(saveSource, /const lunchPrice = memberPriceFromInput\(document\.getElementById\('edit-lunch-price'\)\.value\)/);
  assert.match(saveSource, /const saladPrice = memberPriceFromInput\(document\.getElementById\('edit-salad-price'\)\.value\)/);
  assert.doesNotMatch(saveSource, /edit-(lunch|salad)-price'\)\.value,\s*10\)\s*\|\|\s*0/,
    '빈 칸을 || 0 으로 받으면 다시 0원으로 저장된다');
});

test('고객정보 창은 단가 칸을 실제 값으로 채운다', () => {
  // 새 업체: 기본 단가를 값으로 넣는다. 흐린 안내 글씨만 보이면 입력된 줄 안다.
  assert.match(adminSource, /getElementById\('edit-lunch-price'\)\.value = DEFAULT_MEAL_PRICE;/);
  assert.match(adminSource, /getElementById\('edit-salad-price'\)\.value = DEFAULT_MEAL_PRICE;/);
  // 기존 업체: 저장된 단가 그대로. || '' 로 0 을 비우면 0원 업체가 8000원처럼 보인다.
  assert.match(adminSource, /getElementById\('edit-lunch-price'\)\.value = userLunchPrice\(u\);/);
  assert.match(adminSource, /getElementById\('edit-salad-price'\)\.value = userSaladPrice\(u\);/);
  assert.doesNotMatch(adminSource, /getElementById\('edit-(lunch|salad)-price'\)\.value = ''/);
  assert.doesNotMatch(adminSource, /getElementById\('edit-(lunch|salad)-price'\)\.value = user(Lunch|Salad)Price\(u\) \|\| ''/);
});

test('단가 칸의 안내 글씨는 값처럼 보이지 않고 기본 단가와 같은 금액을 적는다', () => {
  ['edit-lunch-price', 'edit-salad-price'].forEach(id => {
    const input = adminSource.match(new RegExp(`<input[^>]*id="${id}"[^>]*>`));
    assert.ok(input, `${id} 입력칸을 찾지 못했습니다.`);
    const placeholder = input[0].match(/placeholder="([^"]*)"/)?.[1] || '';
    assert.doesNotMatch(placeholder, /^\d+$/, `${id} 안내 글씨가 숫자뿐이면 입력된 값으로 보인다`);
    assert.ok(placeholder.includes(defaultMealPriceLabel), `${id} 안내 글씨: ${placeholder}`);
  });
  const hint = adminSource.match(/id="edit-price-hint"[^>]*>([\s\S]*?)<\/div>/);
  assert.ok(hint, '단가 안내 문구를 찾지 못했습니다.');
  assert.ok(hint[1].includes(`기본 단가 ${defaultMealPriceLabel}`), hint[1].trim());
  assert.match(hint[1], /0을 넣으면 0원으로 청구/);
});
