'use strict';

// 손님이 아임웹 홈페이지에서 주문번호로 남은 배송 회차를 본다.
// 로그인 없이 부르는 경로라 두 가지를 지킨다.
//   1. 주문번호만으로는 안 보여준다. 받는 분 전화번호 뒤 4자리가 맞아야 한다.
//      아임웹 주문번호는 날짜 + 일련번호라 짐작할 수 있다.
//   2. 이름·주소·전화번호는 돌려주지 않는다. 상품과 회차만 보여준다.
// 한 주문번호에 틀린 조회가 몰리면 잠시 막는다. 4자리는 만 번이면 다 넣어볼 수 있다.

const crypto = require('crypto');
const { PRODUCT_LABELS } = require('./imwebParser');

const CUSTOMERS = 'customers';
const LIMITS = 'deliveryLookupLimits';
const MAX_FAILS = 5;
const LOCK_WINDOW_MS = 30 * 60 * 1000;
const NOT_FOUND_MESSAGE = '주문번호와 전화번호 뒤 4자리를 다시 확인해주세요.';

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

// 아임웹 주문번호는 숫자뿐이지만, 직접 등록한 주문은 다른 모양일 수 있어 글자와 - 도 받는다.
function normalizeOrderNo(value) {
  return String(value || '').replace(/\s+/g, '');
}

function isValidOrderNo(orderNo) {
  return /^[A-Za-z0-9-]{4,40}$/.test(orderNo);
}

function phoneDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

function phoneMatches(phone, last4) {
  const digits = phoneDigits(phone);
  return last4.length === 4 && digits.length >= 4 && digits.endsWith(last4);
}

// 관리자가 손으로 고친 문서에는 숫자가 문자열이거나 비어 있을 수 있다.
// 손님 화면에 NaN 이 나가면 안 되니 0 이상의 정수로만 내보낸다.
function toCount(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

function lineStatus(record, remain) {
  if (remain <= 0 || record.status === 'end') return 'done';
  if (record.status === 'pause' || record.needsReview === true) return 'pause';
  return 'active';
}

function summarizeLine(record) {
  const data = record || {};
  const remain = toCount(data.remain);
  // 남은 횟수가 전체보다 크게 고쳐진 문서가 있어도 '배송 완료'가 음수가 되지 않게 한다.
  const total = Math.max(toCount(data.total), remain);
  const deliveredDates = (Array.isArray(data.deliveredDates) ? data.deliveredDates : [])
    .map(String)
    .filter(date => /^\d{4}-\d{2}-\d{2}$/.test(date))
    .sort();
  return {
    product: PRODUCT_LABELS[data.set] || String(data.set || ''),
    scheduleName: String(data.scheduleName || ''),
    orderType: data.orderType === 'once' ? 'once' : 'sub',
    total,
    remain,
    used: total - remain,
    lastDeliveredDate: deliveredDates[deliveredDates.length - 1] || '',
    startDate: /^\d{4}-\d{2}-\d{2}$/.test(String(data.startDate || '')) ? String(data.startDate) : '',
    status: lineStatus(data, remain)
  };
}

function limitDocId(orderNo) {
  return crypto.createHash('sha256').update(orderNo).digest('hex').slice(0, 40);
}

function isLocked(limit, nowMs) {
  if (!limit) return false;
  const fails = Number(limit.fails) || 0;
  const since = Number(limit.windowStartMs) || 0;
  return fails >= MAX_FAILS && nowMs - since < LOCK_WINDOW_MS;
}

function nextLimit(limit, nowMs) {
  const since = Number(limit?.windowStartMs) || 0;
  if (!limit || nowMs - since >= LOCK_WINDOW_MS) return { fails: 1, windowStartMs: nowMs };
  return { fails: (Number(limit.fails) || 0) + 1, windowStartMs: since };
}

async function lookupDelivery(db, body, now = new Date()) {
  const orderNo = normalizeOrderNo(body?.orderNo);
  const last4 = phoneDigits(body?.phoneLast4);
  if (!isValidOrderNo(orderNo)) throw httpError(400, '주문번호를 확인해주세요.');
  if (last4.length !== 4) throw httpError(400, '전화번호 뒤 4자리를 숫자로 입력해주세요.');

  const nowMs = now.getTime();
  const limitRef = db.collection(LIMITS).doc(limitDocId(orderNo));
  const limitSnap = await limitRef.get();
  const limit = limitSnap.exists ? limitSnap.data() : null;
  if (isLocked(limit, nowMs)) {
    throw httpError(429, '조회를 여러 번 틀려 잠시 막아두었습니다. 30분 뒤에 다시 시도해주세요.');
  }

  const snap = await db.collection(CUSTOMERS).where('orderNum', '==', orderNo).limit(20).get();
  const matches = snap.docs
    .map(doc => doc.data() || {})
    .filter(record => phoneMatches(record.phone, last4));

  if (!matches.length) {
    // 주문이 없을 때와 번호가 틀렸을 때 같은 답을 준다. 어느 주문번호가 있는지 알려주지 않는다.
    await limitRef.set(nextLimit(limit, nowMs));
    throw httpError(404, NOT_FOUND_MESSAGE);
  }

  const lines = matches
    .map(summarizeLine)
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
  return { orderNo, lines };
}

module.exports = {
  LIMITS,
  LOCK_WINDOW_MS,
  MAX_FAILS,
  NOT_FOUND_MESSAGE,
  isLocked,
  lookupDelivery,
  nextLimit,
  normalizeOrderNo,
  phoneMatches,
  summarizeLine,
  toCount
};
