'use strict';

// 제이엘티씨파트너스 건: 9월 14일부터 도시락을 시작했는데 9월 11일에 3개가 정산서에 올라왔다.
// 마감(오전 9시 20분)이 지난 뒤에 가입했는데도 가입 당일 기본수량이 주문으로 잡혔기 때문이다.
//
// 원인은 isUserActiveOnDate 가 가입 '날짜' 만 비교하고 '시각' 은 보지 않은 것이다.
//   return (!createdDate || createdDate <= dStr) && ...
// 가입 당일이 마감 뒤였다면 그날은 주문을 받을 수 없다.

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
  let paren = 0;
  let afterParams = start;
  for (let i = adminSource.indexOf('(', start); i < adminSource.length; i += 1) {
    if (adminSource[i] === '(') paren += 1;
    else if (adminSource[i] === ')') { paren -= 1; if (!paren) { afterParams = i; break; } }
  }
  let depth = 0;
  for (let i = adminSource.indexOf('{', afterParams); i < adminSource.length; i += 1) {
    if (adminSource[i] === '{') depth += 1;
    else if (adminSource[i] === '}') { depth -= 1; if (!depth) return adminSource.slice(start, i + 1); }
  }
  throw new Error(`${name} 함수 끝을 찾지 못했습니다.`);
}

function load(deadline = { hour: 9, minute: 20 }) {
  const context = { adminDeadline: deadline, currentDateStr: '2026-09-11' };
  vm.createContext(context);
  vm.runInContext([
    'function dateStr(d) { return d.toISOString().split("T")[0]; }',
    extractFunction('timestampToDate'),
    extractFunction('kstDateStrFromTimestamp'),
    extractFunction('userCreatedDateStr'),
    extractFunction('userServiceStartDateStr'),
    extractFunction('isMealPausedOnDate'),
    extractFunction('userJoinedAfterDeadline'),
    extractFunction('isUserActiveOnDate')
  ].join('\n'), context);
  return context;
}

// 한국시간을 UTC ISO 로 바꾼다. 가입 시각은 Firestore 에 UTC 로 들어간다.
function kst(dateStr, hour, minute) {
  return new Date(`${dateStr}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+09:00`).toISOString();
}

test('마감 뒤에 가입하면 가입 당일은 주문 대상이 아니다', () => {
  const ctx = load();
  const user = { createdAt: kst('2026-09-11', 9, 30) }; // 9시 30분 가입

  assert.equal(ctx.isUserActiveOnDate(user, '2026-09-11'), false, '가입 당일은 빠져야 한다');
  assert.equal(ctx.isUserActiveOnDate(user, '2026-09-14'), true, '다음 영업일부터는 정상 주문');
});

test('마감 전에 가입하면 가입 당일부터 주문 대상이다', () => {
  const ctx = load();
  const user = { createdAt: kst('2026-09-11', 8, 0) };

  assert.equal(ctx.isUserActiveOnDate(user, '2026-09-11'), true);
});

test('마감 시각 정각은 이미 마감이다', () => {
  const ctx = load();
  assert.equal(ctx.isUserActiveOnDate({ createdAt: kst('2026-09-11', 9, 20) }, '2026-09-11'), false);
  assert.equal(ctx.isUserActiveOnDate({ createdAt: kst('2026-09-11', 9, 19) }, '2026-09-11'), true);
});

test('가입 전 날짜는 예전처럼 빠진다', () => {
  const ctx = load();
  const user = { createdAt: kst('2026-09-11', 8, 0) };
  assert.equal(ctx.isUserActiveOnDate(user, '2026-09-10'), false);
});

test('마감 설정을 바꾸면 그 기준을 따른다', () => {
  const ctx = load({ hour: 10, minute: 0 });
  const user = { createdAt: kst('2026-09-11', 9, 30) };
  assert.equal(ctx.isUserActiveOnDate(user, '2026-09-11'), true, '마감이 10시면 9시 30분 가입은 당일 주문 가능');
});

test('가입 시각을 모르면 예전처럼 가입일부터 잡는다', () => {
  const ctx = load();
  assert.equal(ctx.isUserActiveOnDate({}, '2026-09-11'), true, '가입 정보가 없는 기존 고객이 빠지면 안 된다');
});

test('일시정지 판정은 그대로다', () => {
  const ctx = load();
  const user = { createdAt: kst('2026-09-01', 8, 0), mealPaused: true, mealPauseStartDate: '2026-09-10' };
  assert.equal(ctx.isUserActiveOnDate(user, '2026-09-11'), false);
  assert.equal(ctx.isUserActiveOnDate(user, '2026-09-09'), true);
});

// 미리 등록만 해두고 나중에 시작하는 업체가, 그 사이 평일마다 기본수량으로
// 청구되던 문제. 업체별 '서비스 시작일' 을 정하면 그 전날까지는 잡지 않는다.
test('서비스 시작일 전에는 주문에 잡히지 않는다', () => {
  const ctx = load();
  const user = { createdAt: kst('2026-09-11', 8, 0), serviceStartDate: '2026-09-21' };

  assert.equal(ctx.isUserActiveOnDate(user, '2026-09-11'), false, '가입일이어도 시작 전이면 안 잡힌다');
  assert.equal(ctx.isUserActiveOnDate(user, '2026-09-18'), false);
  assert.equal(ctx.isUserActiveOnDate(user, '2026-09-20'), false, '시작 전날까지는 안 잡힌다');
  assert.equal(ctx.isUserActiveOnDate(user, '2026-09-21'), true, '시작일 당일부터 잡힌다');
  assert.equal(ctx.isUserActiveOnDate(user, '2026-09-22'), true);
});

test('서비스 시작일을 비워두면 예전처럼 가입 기준으로 잡는다', () => {
  const ctx = load();
  const before = { createdAt: kst('2026-09-11', 8, 0) };
  const after = { createdAt: kst('2026-09-11', 9, 30) };

  assert.equal(ctx.isUserActiveOnDate({ ...before, serviceStartDate: '' }, '2026-09-11'), true);
  assert.equal(ctx.isUserActiveOnDate({ ...after, serviceStartDate: '' }, '2026-09-11'), false);
});

test('형식이 어긋난 시작일은 무시한다', () => {
  const ctx = load();
  const user = { createdAt: kst('2026-09-11', 8, 0), serviceStartDate: '2026/09/21' };
  assert.equal(ctx.isUserActiveOnDate(user, '2026-09-11'), true, '잘못된 값 때문에 업체가 통째로 빠지면 안 된다');
  assert.equal(ctx.userServiceStartDateStr(user), '');
});

test('시작일이 지나도 일시정지는 그대로 적용된다', () => {
  const ctx = load();
  const user = {
    createdAt: kst('2026-09-01', 8, 0),
    serviceStartDate: '2026-09-10',
    mealPaused: true,
    mealPauseStartDate: '2026-09-14'
  };
  assert.equal(ctx.isUserActiveOnDate(user, '2026-09-11'), true);
  assert.equal(ctx.isUserActiveOnDate(user, '2026-09-15'), false);
});

test('저장 경로가 서비스 시작일을 실제로 담는다', () => {
  // 화면에만 있고 저장이 안 되면 아무 소용이 없다. 저장 코드 자체를 고정한다.
  const save = adminSource.slice(adminSource.indexOf("const isCreate = document.getElementById('edit-mode')"));
  const body = save.slice(0, save.indexOf('await batch.commit()'));
  assert.match(body, /const serviceStartDate = document\.getElementById\('edit-service-start'\)\.value/);
  assert.match(body, /serviceStartDate: serviceStartDate \|\| firebase\.firestore\.FieldValue\.delete\(\)/);
});

test('수정 모달을 열면 저장된 시작일이 채워진다', () => {
  assert.match(adminSource, /getElementById\('edit-service-start'\)\.value = userServiceStartDateStr\(u\)/);
});
