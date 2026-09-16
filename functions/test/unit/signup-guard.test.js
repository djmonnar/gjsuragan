'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const guard = require('../../signupGuard');

const 순수식품 = { uid: 'uid-1', businessName: '주식회사 순수식품', phone: '01020343477' };

test('전화번호 형식이 달라도 같은 번호로 본다', () => {
  assert.equal(guard.normalizePhone('010-2034-3477'), '01020343477');
  assert.equal(guard.normalizePhone('010 2034 3477'), '01020343477');
  assert.equal(guard.normalizePhone('+82 10-2034-3477'), '01020343477');
  assert.equal(guard.normalizePhone(''), '');
  assert.equal(guard.normalizePhone(null), '');
});

test('업체명은 띄어쓰기와 대소문자를 무시한다', () => {
  assert.equal(guard.normalizeName('주식회사 순수식품'), '주식회사순수식품');
  assert.equal(guard.normalizeName(' ABC 식당 '), 'abc식당');
});

test('이메일만 다르게 두 번 가입하면 잡는다', () => {
  // 실제로 난 일: soonsoof@naver.com 과 soonsoof@naver.con 으로 두 번 가입했다.
  const found = guard.findDuplicateAccount([순수식품], {
    businessName: '주식회사 순수식품',
    phone: '01020343477'
  });
  assert.equal(found?.uid, 'uid-1');
});

test('전화번호만 같고 업체명이 다르면 막지 않는다', () => {
  // 한 사장님이 약국과 돌봄센터를 같은 번호로 따로 운영하는 일이 있다.
  const found = guard.findDuplicateAccount(
    [{ uid: 'uid-1', businessName: '하얀약국', phone: '01020343477' }],
    { businessName: '다함께돌봄', phone: '01020343477' }
  );
  assert.equal(found, null);
});

test('업체명만 같고 번호가 다르면 막지 않는다', () => {
  // 지점이 여럿인 업체가 있다.
  const found = guard.findDuplicateAccount([순수식품], {
    businessName: '주식회사 순수식품',
    phone: '01099998888'
  });
  assert.equal(found, null);
});

test('지워지거나 정지된 계정은 막지 않는다', () => {
  // 그만뒀다 다시 시작하는 업체가 가입을 못 하면 안 된다.
  const candidate = { businessName: '주식회사 순수식품', phone: '01020343477' };
  assert.equal(guard.findDuplicateAccount([{ ...순수식품, deleted: true }], candidate), null);
  assert.equal(guard.findDuplicateAccount([{ ...순수식품, disabled: true }], candidate), null);
});

test('자기 계정 때문에 막히지 않는다', () => {
  // 가입이 중간에 끊겨 다시 시도하는 경우 본인 문서가 이미 있을 수 있다.
  const candidate = { businessName: '주식회사 순수식품', phone: '01020343477' };
  assert.equal(guard.findDuplicateAccount([순수식품], candidate, 'uid-1'), null);
  assert.equal(guard.findDuplicateAccount([순수식품], candidate, 'uid-other')?.uid, 'uid-1');
});

test('업체명이나 번호가 비면 아무것도 막지 않는다', () => {
  // 한쪽만으로 판정하면 엉뚱한 업체가 걸린다.
  assert.equal(guard.duplicateKey('주식회사 순수식품', ''), '');
  assert.equal(guard.duplicateKey('', '01020343477'), '');
  assert.equal(guard.findDuplicateAccount([순수식품], { businessName: '주식회사 순수식품' }), null);
  assert.equal(guard.findDuplicateAccount(
    [{ uid: 'uid-2', businessName: '이름없음', phone: '' }],
    { businessName: '이름없음', phone: '' }
  ), null);
});

test('목록이 비어 있거나 망가져 있어도 터지지 않는다', () => {
  const candidate = { businessName: '주식회사 순수식품', phone: '01020343477' };
  assert.equal(guard.findDuplicateAccount([], candidate), null);
  assert.equal(guard.findDuplicateAccount(null, candidate), null);
  assert.equal(guard.findDuplicateAccount([null, undefined, {}], candidate), null);
  assert.equal(guard.findDuplicateAccount([순수식품], {}), null);
});
