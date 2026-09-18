'use strict';

// 태블릿 주방 화면에 띄우는 오늘의 주문 집계.
// admin.html 의 주문 탭 요약 카드와 같은 숫자를 내야 한다.
// 다른 숫자가 나오면 주방이 잘못 만든다.
//
// 표시 업체 수는 주방에서 쓸 일이 없어 빼고, 나머지 여섯 가지만 센다.
//   도시락 · 샐러드 · 일회용도시락 · 행사도시락 · 곱빼기도시락 · 공기밥
//
// 곱빼기도시락과 공기밥은 행사도시락 카탈로그로 주문받지만 주방이 따로 세므로
// 행사도시락 수량에 섞지 않는다 (catering-catalog 의 splitLargeLunch 와 같은 규칙).

const catering = require('../assets/js/catering-catalog.js');

function count(value) {
  const number = Math.floor(Number(value));
  return Number.isSafeInteger(number) && number > 0 ? number : 0;
}

// 월식 업체 한 곳의 행사 추가주문을 갈라 센다.
function cateringSplit(items) {
  return catering.splitLargeLunch(catering.summarize(items || [], { preserveSnapshot: true }));
}

// 한 줄의 행사도시락 수량. 품목이 있으면 그 합, 없으면 적어둔 개수.
function eventRowQty(row = {}) {
  if (Array.isArray(row.items) && row.items.length) {
    return row.items.reduce((sum, item) => sum + count(item.qty ?? item.count), 0);
  }
  return count(row.count);
}

// rows      월식 업체의 오늘 주문 (kakaoFetchMonthlyMealRows 가 낸 모양)
// eventRows 단독 행사도시락 주문 (adminEvents · eventOrders)
function totalsFromRows(rows = [], eventRows = []) {
  const totals = { lunch: 0, salad: 0, eventLunch: 0, catering: 0, largeLunch: 0, rice: 0 };
  (Array.isArray(rows) ? rows : []).forEach(row => {
    totals.lunch += count(row.lunchCount ?? row.lunchQty ?? row.lunch);
    totals.salad += count(row.saladCount ?? row.saladQty ?? row.salad);
    totals.eventLunch += count(row.eventLunchCount ?? row.eventLunchQty ?? row.eventLunch);
    const split = cateringSplit(row.cateringItems);
    totals.catering += count(split.catering.totalQty);
    totals.largeLunch += count(split.largeLunch.totalQty);
    totals.rice += count(split.rice.totalQty);
  });
  // 총 행사도시락 = 월식 업체의 행사 추가주문 + 단독 행사도시락 주문
  (Array.isArray(eventRows) ? eventRows : []).forEach(row => {
    totals.catering += eventRowQty(row);
  });
  return totals;
}

// 그 업체가 오늘 주문한 것이 하나라도 있는지. 곱빼기·공기밥만 시킨 곳도 세어야 한다.
function hasAnyOrder(row = {}) {
  const meals = count(row.lunchCount ?? row.lunchQty ?? row.lunch)
    + count(row.saladCount ?? row.saladQty ?? row.salad)
    + count(row.eventLunchCount ?? row.eventLunchQty ?? row.eventLunch);
  if (meals > 0) return true;
  return count(catering.summarize(row.cateringItems || []).totalQty) > 0;
}

module.exports = { totalsFromRows, hasAnyOrder, eventRowQty };
