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

test('관리자가 직접 등록한 업체와 같아도 가입을 막지 않는다', () => {
  // 직접 등록한 업체는 로그인 계정이 없다. "기존 계정으로 로그인하세요"라고 돌려보내면
  // 그 업체는 앱을 쓸 길이 없다. 가입은 받고 관리자가 '가입 계정과 합치기'로 합친다.
  const candidate = { businessName: '센코필라테스', phone: '010-4424-0000' };
  const 직접등록 = { uid: 'biz_1790035140440', businessName: '센코필라테스', phone: '01044240000', adminRegistered: true };
  assert.equal(guard.findDuplicateAccount([직접등록], candidate, 'new-uid'), null);
  // 표시가 빠진 옛 문서도 uid 로 알아본다.
  assert.equal(guard.findDuplicateAccount([{ ...직접등록, adminRegistered: undefined }], candidate, 'new-uid'), null);
  // 같은 업체가 이미 앱으로 가입해 있으면 그 계정 때문에는 여전히 막힌다.
  const 가입계정 = { uid: 'auth-senko', businessName: '센코 필라테스', phone: '010 4424 0000' };
  assert.equal(guard.findDuplicateAccount([직접등록, 가입계정], candidate, 'new-uid')?.uid, 'auth-senko');
});

test('직접 등록 업체 판정은 관리자 화면과 같다', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const adminSource = fs.readFileSync(path.resolve(__dirname, '../../../admin.html'), 'utf8');
  // 한쪽만 바꾸면, 화면에는 '직접 등록'으로 보이는데 가입은 막히는 업체가 생긴다.
  assert.match(adminSource, /function isAdminRegisteredBusiness\(user = \{\}\) \{\s*return Boolean\(user\.adminRegistered\) \|\| String\(user\.uid \|\| ''\)\.startsWith\('biz_'\);/);
  assert.equal(guard.isAdminRegistered({ adminRegistered: true }), true);
  assert.equal(guard.isAdminRegistered({ uid: 'biz_123' }), true);
  assert.equal(guard.isAdminRegistered({ uid: 'auth-uid' }), false);
  assert.equal(guard.isAdminRegistered(), false);
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
