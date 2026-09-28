'use strict';

// 손님이 홈페이지(gjsuragan.co.kr)에서 주문자 이름과 전화번호로 남은 배송 회차를 본다.
// 주문번호로 찾지 않는 까닭: 네이버페이로 결제한 손님은 네이버가 매긴 번호만 알고,
// 관리자가 손으로 등록한 주문에는 아임웹 주문번호가 없다.
//
// 문서의 name/phone 은 받는 분이다. 주문자는 ordererName/ordererPhone 에 따로 있다.
// 이 두 필드는 2026-09 부터 적기 시작해서 그 전 문서와 직접 등록한 주문에는 없다.
// 그래서 (주문자 이름, 주문자 번호) 또는 (받는 분 이름, 받는 분 번호) 한 쌍이 맞으면 보여준다.
// 선물 주문을 받은 사람도 자기 이름·번호로 조회할 수 있다. 쌍을 섞어서는 맞추지 않는다.
// 로그인 없이 부르는 경로라 이렇게 지킨다.
//   1. 이름과 전화번호가 둘 다 맞아야 보여준다.
//   2. 주소·전화번호는 돌려주지 않는다. 상품과 회차만 보여준다.
//   3. 틀린 조회가 몰리면 잠시 막는다. 같은 번호로 몰리는 것과 같은 곳(IP)에서
//      여러 번호를 넣어보는 것을 따로 센다.

const crypto = require('crypto');
const { PRODUCT_LABELS } = require('./imwebParser');

const CUSTOMERS = 'customers';
const LIMITS = 'deliveryLookupLimits';
const MAX_FAILS = 5;
const MAX_FAILS_PER_IP = 20;
const LOCK_WINDOW_MS = 30 * 60 * 1000;
const MAX_LINES = 10;
const NOT_FOUND_MESSAGE = '주문자 이름과 전화번호를 다시 확인해주세요.';
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function normalizePhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.startsWith('82')) return `0${digits.slice(2)}`;
  return digits;
}

function isValidPhone(digits) {
  return /^01\d{8,9}$/.test(digits);
}

function normalizeName(value) {
  return String(value || '').replace(/\s+/g, '').toLowerCase();
}

// 문서의 phone 은 '010-1234-5678' 이기도 하고 '01012345678' 이기도 하다.
// 정규화한 값을 따로 들고 있지 않으니, 흔한 적는 법을 모두 만들어 in 으로 찾는다.
function phoneVariants(digits) {
  const splits = digits.length === 11
    ? [[3, 4, 4]]
    : [[3, 3, 4], [3, 4, 3]];
  const variants = new Set([digits]);
  splits.forEach(([a, b]) => {
    const parts = [digits.slice(0, a), digits.slice(a, a + b), digits.slice(a + b)];
    ['-', ' ', '.'].forEach(sep => variants.add(parts.join(sep)));
  });
  return [...variants];
}

// 관리자가 손으로 고친 문서에는 숫자가 문자열이거나 비어 있을 수 있다.
// 손님 화면에 NaN 이 나가면 안 되니 0 이상의 정수로만 내보낸다.
function toCount(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

function dateOrEmpty(value) {
  const text = String(value || '');
  return DATE.test(text) ? text : '';
}

function lineStatus(record, remain) {
  if (remain <= 0 || record.status === 'end') return 'done';
  if (record.status === 'pause' || record.needsReview === true) return 'pause';
  return 'active';
}

function summarizeLine(record) {
  const data = record || {};
  const remain = toCount(data.remain);
  // 남은 횟수가 전체보다 크게 고쳐진 문서가 있어도 '받으신 배송'이 음수가 되지 않게 한다.
  const total = Math.max(toCount(data.total), remain);
  const deliveredDates = (Array.isArray(data.deliveredDates) ? data.deliveredDates : [])
    .map(String)
    .filter(date => DATE.test(date))
    .sort();
  return {
    product: PRODUCT_LABELS[data.set] || String(data.set || ''),
    scheduleName: String(data.scheduleName || ''),
    orderType: data.orderType === 'once' ? 'once' : 'sub',
    orderDate: dateOrEmpty(data.orderDate),
    total,
    remain,
    used: total - remain,
    lastDeliveredDate: deliveredDates[deliveredDates.length - 1] || '',
    startDate: dateOrEmpty(data.startDate),
    status: lineStatus(data, remain)
  };
}

// 진행 중인 주문을 먼저, 그 안에서는 최근 주문을 먼저 보여준다.
// 오래 받은 손님은 끝난 주문이 수십 건이라 최근 것만 자른다.
function sortLines(lines) {
  const rank = { active: 0, pause: 1, done: 2 };
  const recent = line => line.orderDate || line.startDate || line.lastDeliveredDate;
  return [...lines].sort((a, b) =>
    (rank[a.status] - rank[b.status]) || recent(b).localeCompare(recent(a)));
}

function limitDocId(kind, key) {
  return `${kind}_${crypto.createHash('sha256').update(key).digest('hex').slice(0, 40)}`;
}

function isLocked(limit, nowMs, maxFails = MAX_FAILS) {
  if (!limit) return false;
  const fails = Number(limit.fails) || 0;
  const since = Number(limit.windowStartMs) || 0;
  return fails >= maxFails && nowMs - since < LOCK_WINDOW_MS;
}

function nextLimit(limit, nowMs) {
  const since = Number(limit?.windowStartMs) || 0;
  if (!limit || nowMs - since >= LOCK_WINDOW_MS) return { fails: 1, windowStartMs: nowMs };
  return { fails: (Number(limit.fails) || 0) + 1, windowStartMs: since };
}

async function readLimit(ref) {
  const snap = await ref.get();
  return snap.exists ? snap.data() : null;
}

function personMatches(record, name, phone) {
  const orderer = normalizeName(record.ordererName) === name && normalizePhone(record.ordererPhone) === phone;
  const recipient = normalizeName(record.name) === name && normalizePhone(record.phone) === phone;
  return orderer || recipient;
}

async function findByPerson(db, name, phone) {
  const variants = phoneVariants(phone);
  const customers = db.collection(CUSTOMERS);
  const [byOrderer, byRecipient] = await Promise.all([
    customers.where('ordererPhone', 'in', variants).limit(100).get(),
    customers.where('phone', 'in', variants).limit(100).get()
  ]);
  const found = new Map();
  [...byOrderer.docs, ...byRecipient.docs].forEach(doc => {
    const record = doc.data() || {};
    if (personMatches(record, name, phone)) found.set(doc.id, record);
  });
  return [...found.values()];
}

async function lookupDelivery(db, body, options = {}) {
  const now = options.now || new Date();
  const name = normalizeName(body?.name);
  const phone = normalizePhone(body?.phone);
  if (!name) throw httpError(400, '주문자 이름을 입력해주세요.');
  if (!isValidPhone(phone)) throw httpError(400, '전화번호를 010으로 시작하는 숫자로 입력해주세요.');

  const nowMs = now.getTime();
  const limits = db.collection(LIMITS);
  const phoneRef = limits.doc(limitDocId('phone', phone));
  const ip = String(options.ip || '').trim();
  const ipRef = ip ? limits.doc(limitDocId('ip', ip)) : null;
  const phoneLimit = await readLimit(phoneRef);
  const ipLimit = ipRef ? await readLimit(ipRef) : null;
  if (isLocked(phoneLimit, nowMs) || isLocked(ipLimit, nowMs, MAX_FAILS_PER_IP)) {
    throw httpError(429, '조회를 여러 번 틀려 잠시 막아두었습니다. 30분 뒤에 다시 시도해주세요.');
  }

  const matches = await findByPerson(db, name, phone);

  if (!matches.length) {
    // 번호가 없을 때와 이름이 틀렸을 때 같은 답을 준다. 어느 번호가 손님인지 알려주지 않는다.
    await phoneRef.set(nextLimit(phoneLimit, nowMs));
    if (ipRef) await ipRef.set(nextLimit(ipLimit, nowMs));
    throw httpError(404, NOT_FOUND_MESSAGE);
  }

  const lines = sortLines(matches.map(summarizeLine));
  return { lines: lines.slice(0, MAX_LINES), hiddenCount: Math.max(0, lines.length - MAX_LINES) };
}

module.exports = {
  LIMITS,
  LOCK_WINDOW_MS,
  MAX_FAILS,
  MAX_FAILS_PER_IP,
  MAX_LINES,
  NOT_FOUND_MESSAGE,
  isLocked,
  lookupDelivery,
  nextLimit,
  normalizeName,
  normalizePhone,
  personMatches,
  phoneVariants,
  sortLines,
  summarizeLine,
  toCount
};
