'use strict';

// 같은 업체가 몇 분 사이에 두 번 가입하면 날짜는 둘 다 같다.
// 중복 배지만 띄우고 시각을 안 보여주면 어느 쪽을 지워야 하는지 알 수 없다.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const rootDir = path.resolve(__dirname, '../../..');
const adminSource = fs.readFileSync(path.join(rootDir, 'admin.html'), 'utf8');

function extractFunction(name) {
  const start = adminSource.indexOf(`function ${name}`);
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

const newMemberDays = Number(
  /const NEW_MEMBER_BADGE_DAYS = (\d+);/.exec(adminSource)?.[1]
);
assert.ok(Number.isInteger(newMemberDays), 'NEW_MEMBER_BADGE_DAYS 를 읽지 못했습니다.');

const member = vm.runInNewContext(`(() => {
  const NEW_MEMBER_BADGE_DAYS = ${newMemberDays};
  ${extractFunction('dateStr')}
  ${extractFunction('timestampToDate')}
  ${extractFunction('kstDateStrFromTimestamp')}
  ${extractFunction('userCreatedDateStr')}
  ${extractFunction('memberCreatedTimeStr')}
  ${extractFunction('isNewMember')}
  ${extractFunction('memberCreatedMetaText')}
  return { memberCreatedTimeStr, memberCreatedMetaText, NEW_MEMBER_BADGE_DAYS };
})()`);

const DAY_MS = 24 * 60 * 60 * 1000;
const justNow = () => new Date(Date.now() - 60 * 1000).toISOString();
const longAgo = () => new Date(Date.now() - (member.NEW_MEMBER_BADGE_DAYS + 30) * DAY_MS).toISOString();

test('가입 시각을 KST 로 보여준다', () => {
  // 2026-09-16T23:28Z 는 한국시간으로 2026-09-17 08:28 이다.
  assert.equal(
    member.memberCreatedTimeStr({ createdAt: '2026-09-16T23:28:00.000Z' }),
    '2026-09-17 08:28'
  );
});

test('자정 직전 가입도 날짜가 밀리지 않는다', () => {
  // 2026-09-17T14:59Z = 한국시간 2026-09-17 23:59
  assert.equal(
    member.memberCreatedTimeStr({ createdAt: '2026-09-17T14:59:00.000Z' }),
    '2026-09-17 23:59'
  );
  // 2026-09-17T15:00Z = 한국시간 2026-09-18 00:00
  assert.equal(
    member.memberCreatedTimeStr({ createdAt: '2026-09-17T15:00:00.000Z' }),
    '2026-09-18 00:00'
  );
});

test('중복이면 같은 날 두 건도 분 단위로 갈린다', () => {
  const first = { createdAt: '2026-09-16T23:12:00.000Z' };
  const second = { createdAt: '2026-09-16T23:28:00.000Z' };
  assert.equal(member.memberCreatedMetaText(first, 2), '가입 2026-09-17 08:12');
  assert.equal(member.memberCreatedMetaText(second, 2), '가입 2026-09-17 08:28');
  assert.notEqual(member.memberCreatedMetaText(first, 2), member.memberCreatedMetaText(second, 2));
});

test('중복이면 오래된 회원이어도 가입 시각을 보여준다', () => {
  // 중복은 가입한 지 오래된 뒤에 발견될 수 있다. NEW 기간이 지났다고 숨기면 안 된다.
  const old = { createdAt: longAgo() };
  assert.match(member.memberCreatedMetaText(old, 2), /^가입 \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
});

test('중복이 아니면 예전과 같다', () => {
  assert.match(member.memberCreatedMetaText({ createdAt: justNow() }, 1), /^가입 \d{4}-\d{2}-\d{2}$/);
  assert.equal(member.memberCreatedMetaText({ createdAt: longAgo() }, 1), '고객 상세정보 보기');
  assert.equal(member.memberCreatedMetaText({ createdAt: longAgo() }, 0), '고객 상세정보 보기');
});

test('가입 시각이 없으면 중복이어도 예전 동작으로 떨어진다', () => {
  // 가입 시각이 비어 있다고 행이 깨지면 안 된다.
  assert.equal(member.memberCreatedTimeStr({}), '');
  assert.equal(member.memberCreatedMetaText({}, 2), '고객 상세정보 보기');
  assert.equal(member.memberCreatedMetaText({ createdAt: 'not-a-date' }, 2), '고객 상세정보 보기');
});
