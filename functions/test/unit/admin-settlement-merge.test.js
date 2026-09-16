'use strict';

// 정산 행 합치기의 '합칠 대상' 목록을 지킨다.
// 다시 가입했거나 복구한 계정은 그 달 배송이 0이라 정산 행이 없다.
// 목록을 정산 행에서 만들면 정작 합쳐 넣어야 할 계정이 빠진다.

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

const merge = vm.runInNewContext(`(() => {
  let allUsers = {};
  ${extractFunction('normalizedBusinessKey')}
  ${extractFunction('settlementMergeTargetFor')}
  ${extractFunction('settlementMergeCandidates')}
  return {
    setUsers(next) { allUsers = next; },
    candidateUids(sourceRow) { return settlementMergeCandidates(sourceRow).map(row => row.uid); },
    candidateNames(sourceRow) { return settlementMergeCandidates(sourceRow).map(row => row.user.businessName || ''); },
    targetUidFor(sourceRow) { return settlementMergeTargetFor(sourceRow)?.uid ?? null; }
  };
})()`);

const 하얀약국 = { businessName: '하얀약국', lunchPrice: 8500 };
const 다른업체 = { businessName: '가나다식당', lunchPrice: 9000 };

test('그 달에 배송이 없는 등록 업체도 합칠 대상에 나온다', () => {
  // 복구한 계정은 그 달 배송이 0이다. 여기서 빠지면 합칠 곳이 없어 막힌다.
  merge.setUsers({ 'uid-하얀약국': 하얀약국, 'uid-가나다': 다른업체 });
  const uids = merge.candidateUids({ uid: 'uid-신안동', user: { businessName: '신안동하얀약국' } });
  assert.deepEqual([...uids], ['uid-가나다', 'uid-하얀약국']);
});

test('옮기는 쪽 자신은 대상에서 빠진다', () => {
  merge.setUsers({ 'uid-하얀약국': 하얀약국, 'uid-가나다': 다른업체 });
  const uids = merge.candidateUids({ uid: 'uid-가나다', user: { businessName: '가나다식당' } });
  assert.deepEqual([...uids], ['uid-하얀약국']);
});

test('삭제·정지된 계정은 대상에 나오지 않는다', () => {
  // 삭제·정지된 계정은 allUsers 가 아니라 deletedUsers 로 간다.
  // 탈퇴한 계정으로 배송 기록을 옮기면 또 갈라진다.
  merge.setUsers({ 'uid-하얀약국': 하얀약국 });
  const uids = merge.candidateUids({ uid: 'manual_28', user: { businessName: '다함께돌봄' } });
  assert.equal(uids.includes('uid-삭제된계정'), false);
  assert.deepEqual([...uids], ['uid-하얀약국']);
});

test('대상 목록은 업체명 가나다순이다', () => {
  merge.setUsers({
    a: { businessName: '하얀약국' },
    b: { businessName: '가나다식당' },
    c: { businessName: '나라식당' }
  });
  const names = merge.candidateNames({ uid: 'manual_1', user: { businessName: '수기입력' } });
  assert.deepEqual([...names], ['가나다식당', '나라식당', '하얀약국']);
});

test('업체명이 하나만 맞으면 그 업체를 미리 골라둔다', () => {
  merge.setUsers({ 'uid-하얀약국': 하얀약국, 'uid-가나다': 다른업체 });
  assert.equal(merge.targetUidFor({ uid: 'manual_1', user: { businessName: '하얀 약국' } }), 'uid-하얀약국');
});

test('같은 이름이 둘이면 미리 고르지 않는다', () => {
  // 잘못 고른 채로 합치면 다른 업체 정산에 남의 배송이 붙는다. 사람이 고르게 둔다.
  merge.setUsers({
    'uid-1': { businessName: '하얀약국' },
    'uid-2': { businessName: '하얀약국' }
  });
  assert.equal(merge.targetUidFor({ uid: 'manual_1', user: { businessName: '하얀약국' } }), null);
});

test('업체명이 없으면 미리 고르지 않는다', () => {
  merge.setUsers({ 'uid-하얀약국': 하얀약국 });
  assert.equal(merge.targetUidFor({ uid: 'manual_1', user: {} }), null);
});
