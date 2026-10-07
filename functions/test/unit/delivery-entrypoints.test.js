'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '../../..');

function read(relativePath) {
  return fs.readFileSync(path.join(rootDir, relativePath), 'utf8');
}

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

// 선택주문을 한 번에 끝내는 규칙은 배송 처리 한곳(delivery-transaction.js)에 있다.
// 예전에는 화면이 옵션(completeAllForOnce)으로 정했고, 옵션을 주지 않은 배송지도만 1개씩 차감했다.
// 실제로 눌렀을 때의 결과는 once-order-single-delivery.test.js 가 화면별로 돌려 본다.
test('선택주문을 한 번에 끝내는 규칙을 화면이 따로 정하지 않는다', () => {
  for (const file of ['assets/js/schedule-report.js', 'map/index.html', 'assets/js/imweb.js', 'assets/js/rendering.js']) {
    assert.doesNotMatch(read(file), /completeAllForOnce|completeAll\s*:/, file);
  }
  const core = read('assets/js/delivery-transaction.js');
  assert.doesNotMatch(core, /completeAllForOnce|opts\.completeAll/);
  assert.match(extractFunction(core, 'function deliveryStatePatch'), /current\.orderType === 'once' \? 0 :/);
});

test('화면의 완료 함수는 모두 같은 배송 처리를 거친다', () => {
  const entries = [
    ['assets/js/schedule-report.js', 'async function stableMarkDone'],
    ['map/index.html', 'async function markDone('],
    ['assets/js/imweb.js', 'async function markDone('],
    ['assets/js/imweb.js', 'async function markAll('],
    ['assets/js/rendering.js', 'async function markAllDirect('],
    ['assets/js/rendering.js', 'async function markAllCourier(']
  ];
  for (const [file, signature] of entries) {
    const body = extractFunction(read(file), signature);
    assert.match(body, /runDeliveryTransaction\([^;]+['"]complete['"]/s, `${file} ${signature}`);
    // 잔여 횟수를 화면이 직접 계산해 쓰지 않는다.
    assert.doesNotMatch(body, /remain\s*:/, `${file} ${signature}`);
  }
});

test('직원 일괄 완료는 직원 화면의 완료 함수를 그대로 사용한다', () => {
  const source = read('assets/js/schedule-report.js');
  const markMany = extractFunction(source, 'async function markMany');
  const installHandlers = extractFunction(source, 'function installStableDeliveryHandlers');
  assert.match(markMany, /await\s+stableMarkDone\(c\.id,\s*ds\)/);
  assert.match(installHandlers, /window\.markAll\s*=/);
  assert.match(installHandlers, /window\.markAllDirect\s*=/);
  assert.match(installHandlers, /window\.markAllCourier\s*=/);
});

test('직원 화면의 완료는 오지 않은 날짜를 먼저 막고, 일괄 완료는 날짜를 보여준다', () => {
  const source = read('assets/js/schedule-report.js');
  const markDone = extractFunction(source, 'async function stableMarkDone');
  const markMany = extractFunction(source, 'async function markMany');
  // 기록을 쓰기 전에 막아야 한다.
  assert.ok(markDone.indexOf('blockedFutureDate(ds)') > -1 && markDone.indexOf('blockedFutureDate(ds)') < markDone.indexOf('runDeliveryTransaction('));
  assert.ok(markMany.indexOf('blockedFutureDate(ds)') > -1 && markMany.indexOf('blockedFutureDate(ds)') < markMany.indexOf('confirm('));
  assert.match(markMany, /deliveryDateText\(ds\)/);
});

test('직원 화면의 취소는 한 건이든 전체든 같은 방식으로 되돌린다', () => {
  const source = read('assets/js/schedule-report.js');
  const undo = extractFunction(source, 'async function stableUndoMarkDone');
  const cancelMany = extractFunction(source, 'async function cancelMany');
  const installHandlers = extractFunction(source, 'function installStableDeliveryHandlers');
  for (const body of [undo, cancelMany]) {
    assert.match(body, /runDeliveryTransaction\([^;]+['"]cancel['"],\s*null,\s*\{\s*cancelPatch:\s*cancelExtraPatch\s*\}\)/s);
  }
  // 그날 목록이 아니라 그 날짜로 완료된 모든 주문이 대상이다. 종료된 주문은 목록에서 빠질 수 있다.
  assert.match(cancelMany, /custs[^;]*\.filter\(c=>wasDeliveredOn\(c,ds\)\)/s);
  assert.doesNotMatch(cancelMany, /listFor\(/);
  assert.match(installHandlers, /window\.cancelAllDeliveries\s*=/);
});
