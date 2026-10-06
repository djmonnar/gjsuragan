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

test('직원 화면은 선택주문 완료 시 기존 즉시 종료 옵션을 유지한다', () => {
  const source = read('assets/js/schedule-report.js');
  const markDone = extractFunction(source, 'async function stableMarkDone');
  assert.match(markDone, /completeAllForOnce\s*:\s*true/);
});

test('배송지도는 선택주문도 기존처럼 한 회차만 차감한다', () => {
  const source = read('map/index.html');
  const markDone = extractFunction(source, 'async function markDone');
  assert.match(markDone, /runDeliveryTransaction\([^;]+['"]complete['"]\)/s);
  assert.doesNotMatch(markDone, /completeAllForOnce/);
});

test('아임웹 기본 완료 함수는 기존처럼 한 회차만 차감한다', () => {
  const source = read('assets/js/imweb.js');
  const markDone = extractFunction(source, 'async function markDone');
  assert.match(markDone, /runDeliveryTransaction\([^;]+['"]complete['"]\)/s);
  assert.doesNotMatch(markDone, /completeAllForOnce/);
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
