const assert = require('assert');
const { parseMealPlanOcr } = require('../mealPlanParser');

const textResult = parseMealPlanOcr({
  baseDate: '2026-05-25',
  text: [
    '5월 26일 (화)',
    '멸치육수떡국',
    '야채듬뿍카레',
    '야채춘권',
    '<꽃맛살브로콜리샐러드>',
    '&',
    '스리라차마요드레싱',
    '5월 27일 (수)',
    '맑은콩나물국',
    '김치제육',
    '<베이컨크림파스타샐러드>',
    '&',
    '발사믹드레싱'
  ].join('\n')
});

assert.deepStrictEqual(textResult.rows.map(row => row.date), ['2026-05-26', '2026-05-27']);
assert(textResult.rows[0].lunchItems.includes('멸치육수떡국'));
assert(textResult.rows[0].saladItems.includes('꽃맛살브로콜리샐러드'));
assert(textResult.rows[0].saladItems.includes('스리라차마요드레싱'));

function field(text, x, y, width = 90, height = 24) {
  return {
    inferText: text,
    boundingPoly: {
      vertices: [
        { x, y },
        { x: x + width, y },
        { x: x + width, y: y + height },
        { x, y: y + height }
      ]
    }
  };
}

const layoutResult = parseMealPlanOcr({
  baseDate: '2026-05-25',
  fields: [
    field('5월', 100, 50, 50),
    field('26일', 155, 50, 55),
    field('(화)', 215, 50, 45),
    field('5월', 300, 50, 50),
    field('27일', 355, 50, 55),
    field('(수)', 415, 50, 45),
    field('멸치육수떡국', 105, 150, 120),
    field('야채듬뿍카레', 105, 185, 120),
    field('<꽃맛살브로콜리샐러드>', 105, 310, 170),
    field('스리라차마요드레싱', 105, 345, 150),
    field('맑은콩나물국', 305, 150, 120),
    field('김치제육', 305, 185, 90),
    field('<베이컨크림파스타샐러드>', 305, 310, 190),
    field('발사믹드레싱', 305, 345, 120)
  ]
});

assert.deepStrictEqual(layoutResult.rows.map(row => row.date), ['2026-05-26', '2026-05-27']);
assert(layoutResult.rows[1].lunchItems.includes('맑은콩나물국'));
assert(layoutResult.rows[1].saladItems.includes('베이컨크림파스타샐러드'));

console.log(`OK: text ${textResult.rows.length} days / layout ${layoutResult.rows.length} days`);
