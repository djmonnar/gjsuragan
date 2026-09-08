'use strict';

// 관리자 비밀번호 재설정 링크 API 가 관리자 인증 뒤에서만 동작하고,
// 관리자 화면이 그 API 를 호출하는지 소스 모양으로 확인한다.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '../../..');
const functionsSource = fs.readFileSync(path.resolve(__dirname, '../../index.js'), 'utf8');
const adminSource = fs.readFileSync(path.join(rootDir, 'admin.html'), 'utf8');

test('재설정 링크 경로는 관리자 토큰 검사 뒤에 온다', () => {
  const routeAt = functionsSource.indexOf("pathname === '/api/admin/password-reset-link'");
  const adminCheckAt = functionsSource.indexOf('await verifyAdminRequest(req)');
  assert.notEqual(routeAt, -1, '재설정 링크 경로가 없습니다.');
  assert.notEqual(adminCheckAt, -1);
  assert.ok(adminCheckAt < routeAt, '관리자 검사가 경로 처리보다 먼저여야 한다');
});

test('핸들러는 가입되지 않은 이메일과 비활성 계정을 거르고 Firebase 정식 링크를 만든다', () => {
  const start = functionsSource.indexOf('async function handlePasswordResetLink(');
  assert.notEqual(start, -1);
  const body = functionsSource.slice(start, functionsSource.indexOf('async function handleMealOcrParse('));
  assert.match(body, /getUserByEmail\(email\)/);
  assert.match(body, /auth\/user-not-found/);
  assert.match(body, /error\.status = 404/);
  assert.match(body, /account\.disabled/);
  assert.match(body, /generatePasswordResetLink\(email/);
  assert.match(body, /auth\/unauthorized-continue-uri/);
  assert.doesNotMatch(body, /sendPasswordResetEmail/, '서버는 메일을 보내지 않고 링크만 돌려준다');
});

test('관리자 회원 수정 화면에 재설정 링크 버튼이 있고 API 를 Bearer 토큰으로 부른다', () => {
  assert.match(adminSource, /onclick="createPasswordResetLink\(\)"/);
  const fn = adminSource.slice(adminSource.indexOf('async function createPasswordResetLink('), adminSource.indexOf('function copyPasswordResetLink('));
  assert.match(fn, /\/api\/admin\/password-reset-link/);
  assert.match(fn, /getIdToken\(\)/);
  assert.match(fn, /Authorization/);
  const openMember = adminSource.slice(adminSource.indexOf('function openMemberEdit(uid) {'), adminSource.indexOf('function openMemberEdit(uid) {') + 2000);
  assert.match(openMember, /resetPasswordResetLinkBox\(\);/, '회원 수정 창을 열 때 이전 링크를 지워야 한다');
});
