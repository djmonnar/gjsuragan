'use strict';

// 같은 업체가 두 번 가입하는 것을 막는다.
//
// 손님이 이메일을 잘못 치고(soonsoof@naver.con) 로그인이 안 되니 다시 가입하면
// 계정이 둘로 갈라진다. 로그인 계정이 다르니 시스템은 다른 업체로 볼 수밖에 없고,
// 주문표에 두 줄이 잡혀 하루치가 두 배로 청구된다.
//
// 판정 기준은 관리자 화면의 '중복 의심'(memberDuplicateKey)과 같다 —
// 업체명과 전화번호가 둘 다 같을 때만 같은 업체로 본다.
// 전화번호만 같은 경우는 막지 않는다. 한 사장님이 약국과 돌봄센터를 같은 번호로
// 따로 운영하는 일이 실제로 있고, 그런 업체의 가입을 막으면 안 된다.

function normalizeName(value) {
  return String(value ?? '').replace(/\s+/g, '').toLowerCase();
}

// 전화번호는 적는 형식이 제각각이다(010-1234-5678 / 01012345678 / +82 10 ...).
// 숫자만 남기고, 국가번호 82 로 시작하면 국내 형식으로 맞춘다.
function normalizePhone(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('82')) return `0${digits.slice(2)}`;
  return digits;
}

function duplicateKey(businessName, phone) {
  const name = normalizeName(businessName);
  const digits = normalizePhone(phone);
  // 둘 중 하나라도 비면 판정하지 않는다. 업체명만으로는 지점이 여럿인 곳이 걸리고,
  // 번호만으로는 위의 한 사장님 여러 업체가 걸린다.
  if (!name || !digits) return '';
  return `${name}|${digits}`;
}

// 지워지거나 정지된 계정은 막지 않는다.
// 그만뒀다 다시 시작하는 업체가 가입을 못 하면 안 된다.
function blocksSignup(user = {}) {
  return !user.deleted && !user.disabled;
}

// 이미 가입된 업체를 찾는다. 없으면 null.
// selfUid 는 가입을 다시 시도하는 본인 계정이다. 자기 자신 때문에 막히면 안 된다.
function findDuplicateAccount(existingUsers, candidate = {}, selfUid = '') {
  const key = duplicateKey(candidate.businessName, candidate.phone);
  if (!key) return null;
  const match = (existingUsers || []).find(entry => {
    if (!entry || !entry.uid || entry.uid === selfUid) return false;
    if (!blocksSignup(entry)) return false;
    return duplicateKey(entry.businessName, entry.phone) === key;
  });
  return match || null;
}

module.exports = {
  normalizeName,
  normalizePhone,
  duplicateKey,
  blocksSignup,
  findDuplicateAccount
};
