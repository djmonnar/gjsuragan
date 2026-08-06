'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '../../..');
const manualSchedule = require('../../../assets/js/manual-delivery-dates');

function read(relativePath){
  return fs.readFileSync(path.join(rootDir, relativePath), 'utf8');
}

test('수동 배송일은 유효한 날짜만 중복 없이 정렬한다', () => {
  assert.deepEqual(
    manualSchedule.normalizeManualDeliveryDates([
      '2026-08-20', '2026-08-11', '2026-08-20', '2026-02-30', '', null
    ]),
    ['2026-08-11', '2026-08-20']
  );
});

test('수동 일정은 지정한 날짜에만 배송 대상으로 잡힌다', () => {
  const customer = {
    scheduleMode:'manual',
    manualDeliveryDates:['2026-08-11', '2026-08-14']
  };
  assert.equal(manualSchedule.isManualDeliverySchedule(customer), true);
  assert.equal(manualSchedule.manualScheduleIncludes(customer, '2026-08-11'), true);
  assert.equal(manualSchedule.manualScheduleIncludes(customer, '2026-08-12'), false);
  assert.equal(manualSchedule.isManualDeliverySchedule({cookDays:[1]}), false);
});

test('완료 이력과 지난 미완료 날짜를 빼고 앞으로 갈 날짜만 계산한다', () => {
  const customer = {
    scheduleMode:'manual',
    deliveredDates:['2026-08-11'],
    manualDeliveryDates:['2026-08-10', '2026-08-11', '2026-08-14', '2026-09-02']
  };
  assert.deepEqual(
    manualSchedule.manualUpcomingDeliveryDates(customer, '2026-08-12'),
    ['2026-08-14', '2026-09-02']
  );
});

test('남은 횟수와 선택한 미래 배송일 수가 정확히 같아야 한다', () => {
  const dates = ['2026-08-11', '2026-08-14', '2026-08-20'];
  const delivered = ['2026-08-11'];
  assert.equal(manualSchedule.manualScheduleSelectionValid(dates, delivered, '2026-08-12', 2), true);
  assert.equal(manualSchedule.manualScheduleSelectionValid(dates, delivered, '2026-08-12', 3), false);
});

test('등록·수정 모달과 배송관리 경로가 수동 날짜 목록을 사용한다', () => {
  const addModal = read('src/index/parts/50-modal-add.html');
  const editModal = read('src/index/parts/52-modal-edit.html');
  const authCore = read('assets/js/auth-core.js');
  const scheduleReport = read('assets/js/schedule-report.js');
  const rendering = read('assets/js/rendering.js');

  assert.match(addModal, /<option value="manual">수동 입력<\/option>/);
  assert.match(editModal, /<option value="manual">수동 입력<\/option>/);
  assert.match(authCore, /manualDeliveryDates/);
  assert.match(authCore, /manualScheduleSelectionValid/);
  assert.match(scheduleReport, /manualScheduleIncludes\(c, ds\)/);
  assert.match(rendering, /manualUpcomingDeliveryDates\(c, today\)/);
});

test('manual delivery order follows calendar order regardless of click order', () => {
  const dates = ['2026-08-22', '2026-08-06', '2026-08-15', '2026-08-14'];
  assert.equal(manualSchedule.manualDeliveryOrderNumber(dates, '2026-08-06'), 1);
  assert.equal(manualSchedule.manualDeliveryOrderNumber(dates, '2026-08-14'), 2);
  assert.equal(manualSchedule.manualDeliveryOrderNumber(dates, '2026-08-15'), 3);
  assert.equal(manualSchedule.manualDeliveryOrderNumber(dates, '2026-08-22'), 4);
  assert.equal(manualSchedule.manualDeliveryOrderNumber(dates, '2026-08-30'), 0);
});

test('manual delivery order labels use circled numbers through twenty', () => {
  assert.equal(manualSchedule.manualDeliveryOrderLabel(1), '①');
  assert.equal(manualSchedule.manualDeliveryOrderLabel(13), '⑬');
  assert.equal(manualSchedule.manualDeliveryOrderLabel(20), '⑳');
  assert.equal(manualSchedule.manualDeliveryOrderLabel(21), '21');
  assert.equal(manualSchedule.manualDeliveryOrderLabel(0), '');
});
