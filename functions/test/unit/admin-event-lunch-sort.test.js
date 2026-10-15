'use strict';

// 행사도시락 목록의 '배송 전 날짜순' 보기를 지킨다.
// 아직 배송하지 않은 행사(대기·접수)를 가까운 날짜부터 위에 모아야 다음에 나갈 행사가 바로 보인다.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const rootDir = path.resolve(__dirname, '../../..');
const adminSource = fs.readFileSync(path.join(rootDir, 'admin.html'), 'utf8');

function extractFunction(name) {
  const start = adminSource.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} 함수를 찾지 못했습니다.`);
  const paramsStart = adminSource.indexOf('(', start);
  let paramsDepth = 0;
  let bodyStart = -1;
  for (let index = paramsStart; index < adminSource.length; index += 1) {
    if (adminSource[index] === '(') paramsDepth += 1;
    if (adminSource[index] === ')') {
      paramsDepth -= 1;
      if (paramsDepth === 0) {
        bodyStart = adminSource.indexOf('{', index);
        break;
      }
    }
  }
  let bodyDepth = 0;
  for (let index = bodyStart; index < adminSource.length; index += 1) {
    if (adminSource[index] === '{') bodyDepth += 1;
    if (adminSource[index] === '}') {
      bodyDepth -= 1;
      if (bodyDepth === 0) return adminSource.slice(start, index + 1);
    }
  }
  throw new Error(`${name} 함수 끝을 찾지 못했습니다.`);
}

const view = vm.runInNewContext(`(() => {
  let eventLunchSortMode = 'order';
  ${['eventSortMillisValue', 'eventDateTimeMillis', 'eventLatestSortMillis', 'sortEventLunchesLatestFirst', 'eventCustomerName',
    'eventLunchNameKey', 'eventLunchDeliverySortMillis', 'isEventLunchDelivered', 'sortEventLunchesForView', 'eventLunchSortLabel'].map(extractFunction).join('\n')}
  return {
    ids(mode, items) { eventLunchSortMode = mode; return sortEventLunchesForView(items).map(item => item.id).join(','); },
    label(mode) { return eventLunchSortLabel(mode); }
  };
})()`);

const events = [
  { id: 'doneEarly', businessName: '팜러닝', eventDate: '2026-10-07', eventTime: '11:50', delivered: true, createdAt: '2026-10-01T00:00:00Z' },
  { id: 'nextWeek', businessName: '곤명초등학교', eventDate: '2026-10-17', eventTime: '12:00', source: 'publicEventOrder', createdAt: '2026-10-14T00:00:00Z' },
  { id: 'tomorrowLate', businessName: '논개시장', eventDate: '2026-10-16', eventTime: '10:00', source: 'publicEventOrder', createdAt: '2026-10-13T00:00:00Z' },
  { id: 'today', businessName: '한국항공우주연구원', eventDate: '2026-10-15', eventTime: '10:30', delivered: false, createdAt: '2026-10-10T00:00:00Z' },
  { id: 'tomorrowEarly', businessName: '진주시 안락공원', eventDate: '2026-10-16', eventTime: '09:30', source: 'publicEventOrder', createdAt: '2026-10-12T00:00:00Z' },
  { id: 'doneLate', businessName: '한국세라믹기술원', eventDate: '2026-10-14', eventTime: '11:30', delivered: true, createdAt: '2026-10-09T00:00:00Z' },
  // 비회원 접수는 delivered 가 남아 있어도 관리자가 등록·완료하기 전까지 배송 전이다.
  { id: 'publicMarked', businessName: '가나 상회', eventDate: '2026-10-20', eventTime: '12:00', source: 'publicEventOrder', delivered: true, createdAt: '2026-10-11T00:00:00Z' }
];

test('배송 전 날짜순은 대기·접수를 가까운 날짜·시간부터 먼저, 배송완료는 그 뒤 날짜순으로 둔다', () => {
  assert.deepEqual(view.ids('pending', events).split(','), ['today', 'tomorrowEarly', 'tomorrowLate', 'nextWeek', 'publicMarked', 'doneEarly', 'doneLate']);
  assert.equal(view.label('pending'), '배송 전 날짜순');
});

test('다른 보기는 그대로다', () => {
  assert.deepEqual(view.ids('delivery', events).split(','), ['doneEarly', 'doneLate', 'today', 'tomorrowEarly', 'tomorrowLate', 'nextWeek', 'publicMarked']);
  assert.deepEqual(view.ids('order', events).split(',').slice(0, 2), ['nextWeek', 'tomorrowLate']);
});

test('보기 목록과 저장해 두는 보기, 매뉴얼 이름이 같다', () => {
  const select = adminSource.match(/<select[^>]*id="event-list-sort"[\s\S]*?<\/select>/)[0];
  const options = [...select.matchAll(/<option value="([^"]+)">([^<]+)<\/option>/g)];
  const modes = vm.runInNewContext(adminSource.match(/const EVENT_LUNCH_SORT_MODES = (\[[^\]]*\]);/)[1]);
  assert.deepEqual(options.map(option => option[1]).sort(), [...modes].sort());
  options.forEach(([, mode, label]) => assert.equal(view.label(mode), label));
  const manual = fs.readFileSync(path.join(rootDir, 'manual.html'), 'utf8');
  assert.ok(manual.includes(`<strong>보기 → ${view.label('pending')}</strong>`));
});
