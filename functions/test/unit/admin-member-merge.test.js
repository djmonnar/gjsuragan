'use strict';

// 직접 등록한 업체(biz_…)를 나중에 앱으로 가입한 계정과 합치기.
//
// 관리자가 직접 등록한 업체는 로그인 계정이 없다. 그 업체가 앱에 가입하면 계정이 둘이 되어
// 주문표에 두 줄이 잡히고, 지금까지의 배송·정산은 로그인할 수 없는 쪽에 남는다.
// 고객 관리에서 가입 계정을 골라 합치면 배송기록·주문(휴무)·정산·단가가 가입 계정으로 옮겨진다.
//
// 돈이 걸린 자리라 화면 코드(admin.html)의 실제 함수를 뽑아, 메모리 Firestore 위에서
// 읽기(scanMemberMerge) → 옮기기(runMemberMerge)를 끝까지 돌려 결과 문서를 확인한다.

// 관리자 화면은 요일을 브라우저 시간대로 따진다(weekdayKeyForDate 의 getDay). 화면은 한국에서 열린다.
// 검사 서버는 UTC 라, 그대로 두면 월요일이 일요일로 읽혀 요일 기본수량이 하루씩 밀린다.
process.env.TZ = 'Asia/Seoul';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const catering = require('../../../assets/js/catering-catalog.js');

const rootDir = path.resolve(__dirname, '../../..');
const adminSource = fs.readFileSync(path.join(rootDir, 'admin.html'), 'utf8');

function extractFunction(name) {
  const start = adminSource.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} 함수를 찾지 못했습니다.`);
  let paramsDepth = 0;
  let bodyStart = -1;
  for (let index = adminSource.indexOf('(', start); index < adminSource.length; index += 1) {
    if (adminSource[index] === '(') paramsDepth += 1;
    if (adminSource[index] === ')') {
      paramsDepth -= 1;
      if (paramsDepth === 0) {
        bodyStart = adminSource.indexOf('{', index);
        break;
      }
    }
  }
  let depth = 0;
  for (let index = bodyStart; index < adminSource.length; index += 1) {
    if (adminSource[index] === '{') depth += 1;
    if (adminSource[index] === '}') {
      depth -= 1;
      if (depth === 0) {
        const isAsync = adminSource.slice(Math.max(0, start - 6), start) === 'async ';
        return `${isAsync ? 'async ' : ''}${adminSource.slice(start, index + 1)}`;
      }
    }
  }
  throw new Error(`${name} 함수 끝을 찾지 못했습니다.`);
}

function extractConst(name) {
  const match = adminSource.match(new RegExp(`^const ${name} = [^\\n]*`, 'm'));
  assert.ok(match, `${name} 상수를 찾지 못했습니다.`);
  return match[0];
}

// ── 메모리 Firestore ──
// set({merge:true}) 는 중첩 맵까지 합치고, update() 는 맨 위 필드만 바꾼다. 배치는 한 번에 다 되거나 안 된다.
// failAt 번째 쓰기에서 일부러 실패시켜, 도중에 끊긴 뒤 다시 눌렀을 때를 본다.
function createFakeFirestore() {
  const store = new Map();
  const state = { writes: 0, failAt: 0 };
  const isOp = value => Boolean(value) && typeof value === 'object' && typeof value.__op === 'string';
  const isMap = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value) && !isOp(value);
  const clone = value => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));
  function settle(value, existing, allowDelete) {
    if (isOp(value)) {
      if (value.__op === 'timestamp') return 'SERVER_TIME';
      if (value.__op === 'union') return [...new Set([...(Array.isArray(existing) ? existing : []), ...value.items])];
      if (!allowDelete) throw new Error('FieldValue.delete() cannot be used with set() unless you pass {merge:true}');
      return undefined;
    }
    if (Array.isArray(value)) return value.map(item => settle(item, undefined, allowDelete));
    if (isMap(value)) {
      const out = {};
      Object.entries(value).forEach(([key, inner]) => {
        const settled = settle(inner, existing?.[key], allowDelete);
        if (settled !== undefined) out[key] = settled;
      });
      return out;
    }
    return value;
  }
  function deepMerge(base, patch) {
    const out = isMap(base) ? clone(base) : {};
    Object.entries(patch).forEach(([key, value]) => {
      if (isMap(value)) {
        out[key] = deepMerge(out[key], value);
        return;
      }
      const settled = settle(value, out[key], true);
      if (settled === undefined) delete out[key];
      else out[key] = settled;
    });
    return out;
  }
  const apply = {
    set(target, data, options = {}) {
      store.set(target, options.merge ? deepMerge(store.get(target), data) : settle(data, {}, false));
    },
    update(target, data) {
      if (!store.has(target)) throw new Error(`No document to update: ${target}`);
      const out = clone(store.get(target));
      Object.entries(data).forEach(([key, value]) => {
        const settled = settle(value, out[key], true);
        if (settled === undefined) delete out[key];
        else out[key] = settled;
      });
      store.set(target, out);
    },
    delete(target) {
      store.delete(target);
    }
  };
  // 실제 Firestore 는 undefined 가 들어간 문서를 받지 않는다.
  function assertNoUndefined(value, where) {
    if (value === undefined) throw new Error(`Unsupported field value: undefined (${where})`);
    if (Array.isArray(value)) value.forEach((item, index) => assertNoUndefined(item, `${where}[${index}]`));
    else if (isMap(value)) Object.entries(value).forEach(([key, inner]) => assertNoUndefined(inner, `${where}.${key}`));
  }
  function countWrite() {
    state.writes += 1;
    if (state.failAt && state.writes === state.failAt) throw new Error('연결이 끊겼습니다(테스트)');
  }
  function doc(target) {
    return {
      path: target,
      id: target.split('/').pop(),
      async get() {
        const data = store.get(target);
        return { exists: data !== undefined, id: target.split('/').pop(), data: () => clone(data) };
      },
      async set(data, options) { assertNoUndefined(data, target); countWrite(); apply.set(target, data, options); },
      async update(data) { assertNoUndefined(data, target); countWrite(); apply.update(target, data); },
      async delete() { countWrite(); apply.delete(target); },
      collection: name => collection(`${target}/${name}`)
    };
  }
  function collection(target) {
    return { doc: id => doc(`${target}/${id}`) };
  }
  return {
    state,
    store,
    collection,
    batch() {
      const ops = [];
      return {
        set(ref, data, options) { assertNoUndefined(data, ref.path); ops.push(() => apply.set(ref.path, data, options)); },
        update(ref, data) { assertNoUndefined(data, ref.path); ops.push(() => apply.update(ref.path, data)); },
        delete(ref) { ops.push(() => apply.delete(ref.path)); },
        async commit() { countWrite(); ops.forEach(op => op()); }
      };
    },
    seed(target, data) { store.set(target, clone(data)); },
    read(target) { return store.has(target) ? clone(store.get(target)) : null; }
  };
}

const FUNCTIONS = [
  // 합치기
  'memberPhoneDigits', 'memberMergeCandidates', 'memberMergeProfilePatch', 'memberMergeRecordIsLive',
  'memberMergeRecordAction', 'memberMergeRecordIsTargetOwn', 'memberMergeMovedRecord', 'memberMergeOverlapRecord', 'memberMergeOrderAction',
  'memberMergeAdminOrder', 'memberMergeHistoryOrder', 'memberMergePendingDefault', 'memberMergeKeepsPending', 'memberMergePayments', 'memberMergeSettlementAction', 'memberMergeSettlementMoveData',
  'memberMergeSettlementCombinePatch', 'memberMergeMonthHasSourceData', 'memberMergeSummary', 'memberMergeGetAll',
  'memberMergeOrderRef', 'memberMergeSnapshotRef', 'scanMemberMergeMonth', 'scanMemberMerge', 'runMemberMerge',
  // 고객
  'normalizedBusinessKey', 'isAdminRegisteredBusiness', 'memberMatchesSearch', 'normalizeMemberSearchText',
  'memberCreatedMillis', 'timestampToDate', 'kstDateStrFromTimestamp', 'dateStr', 'userCreatedDateStr',
  'userServiceStartDateStr', 'userJoinedAfterDeadline', 'isMealPausedOnDate', 'isUserActiveOnDate',
  'publicUserPricePayload', 'userLunchPrice', 'userSaladPrice', 'adminMemoValue', 'isDisposableLunchUser',
  'parseCount', 'parseDeliveryCount', 'normalizeWeekdayMeals', 'hasDifferentWeekdayMeals', 'userPrivateRef',
  'weekdayKeyForDate', 'defaultMealsForDate', 'addDays',
  'disposableLunchFlagFromRecord', 'disposableLunchUserForRecord', 'splitDisposableLunchForUser', 'normalizeQtyValuesForUser',
  // 주문·배송기록
  'orderLunchQty', 'orderSaladQty', 'orderEventLunchQty', 'orderLunchPrice', 'orderSaladPrice', 'orderEventLunchPrice',
  'orderCateringDate', 'orderCateringSummary', 'orderCateringQty', 'orderTotalQty', 'buildOrderItems',
  'mergedDeliveryRecordFor', 'mergeDeliveryRecord', 'mergeRecordMaps', 'deliveryRecordsFromData',
  'cacheDeliveryRows', 'cachedDeliveryRows', 'deliveryDateRef', 'deliveryArchiveRef', 'invalidateDeliveryDateCache',
  'readDeliveryDateDoc', 'loadDeliveryRecordsForDates', 'saveDeliveryRecords', 'commitBatchOps',
  // 정산
  'settlementItemRef', 'settlementSalesTotal', 'settlementCarryover', 'settlementCarriedOverAmount',
  'settlementBilledTotal', 'settlementPaidTotal', 'settlementBalance', 'settlementOutstandingBalance',
  'mergeCarryoverDates', 'normalizeCarryoverDetail', 'settlementCarryoverFields', 'settlementCarryoverMerge',
  'monthDates', 'shiftMonthStr', 'monthLabelKR'
];

// today 는 관리자가 합치기를 누르는 날이다(KST).
function loadMerge({ today = '2026-10-07' } = {}) {
  const nowMonth = today.slice(0, 7);
  const db = createFakeFirestore();
  const firebase = {
    firestore: {
      FieldValue: {
        delete: () => ({ __op: 'delete' }),
        serverTimestamp: () => ({ __op: 'timestamp' }),
        arrayUnion: (...items) => ({ __op: 'union', items })
      }
    }
  };
  const api = vm.runInNewContext(`(() => {
    let allUsers = {};
    let deletedUsers = {};
    let adminUid = 'admin-uid';
    let adminDeadline = { hour: 9, minute: 20 };
    const DEFAULT_MEAL_PRICE = 8000;
    const WEEKDAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri'];
    const DELIVERY_COLLECTION = 'deliveryRecords';
    const DELIVERY_ARCHIVE_COLLECTION = 'deliveryRecordArchive';
    const DELIVERY_CACHE_TTL_MS = 15 * 1000;
    const deliveryDateCache = new Map();
    const deliveryArchiveCache = new Map();
    ${extractConst('MEMBER_MERGE_FUTURE_MONTHS')}
    ${extractConst('MEMBER_MERGE_PAST_MONTH_LIMIT')}
    ${extractConst('MEMBER_MERGE_PENDING_DAYS')}
    function getKST() { return new Date(TODAY + 'T12:00:00Z'); }
    const rebuildCalls = [];
    // 주말만 배송 없는 날로 본다. 공휴일 목록은 이 테스트의 관심사가 아니다.
    function isNoDeliveryDate(ds) {
      const day = new Date(ds + 'T00:00:00Z').getUTCDay();
      return day === 0 || day === 6;
    }
    function currentMonthStr() { return NOW_MONTH; }
    // 재계산 자체는 따로 테스트가 있다(admin-settlement-order-delete).
    // 여기서는 부르는 때를 본다. 부른 시점의 배송기록에서 수량을 세어 적어 두므로,
    // 배송기록을 다 옮기기 전에 불렀거나 옮긴 뒤 안 불렀으면 수량이 안 맞아 드러난다.
    async function rebuildSettlementsForUids(month, uids) {
      rebuildCalls.push([month, ...uids].join(' '));
      invalidateDeliveryDateCache();
      const records = await loadDeliveryRecordsForDates(monthDates(month), {});
      for (const uid of uids) {
        let lunch = 0;
        monthDates(month).forEach(ds => {
          const record = (records[ds] || {})[uid];
          if (record && record.delivered && !record.orderDeleted) lunch += orderLunchQty(record);
        });
        await settlementItemRef(month, uid).set({ lunch, lunchTotal: lunch, recountedLunch: lunch }, { merge: true });
      }
    }
    ${FUNCTIONS.map(extractFunction).join('\n')}
    return {
      setUsers(next) { allUsers = next; },
      users() { return allUsers; },
      rebuildCalls,
      memberMergeCandidates, memberMergeProfilePatch, memberMergeRecordAction, memberMergeRecordIsLive,
      memberMergeOrderAction, memberMergePayments, memberMergeSettlementAction, memberMergeSettlementCombinePatch,
      memberMergePendingDefault, memberMergeSummary, scanMemberMerge, runMemberMerge
    };
  })()`, { db, firebase, window: { GJS_CATERING: catering }, auth: { currentUser: { email: 'admin@test' } }, console, NOW_MONTH: nowMonth, TODAY: today });
  return { db, api };
}

const plain = value => JSON.parse(JSON.stringify(value ?? null));
const kst = text => ({ seconds: Math.floor(new Date(`${text}+09:00`).getTime() / 1000) });

const SOURCE = 'biz_1790035140440';
const TARGET = 'auth-senko';

// 센코필라테스: 9/22 직접 등록(월·목 2개씩, 단가 7,500원), 10/7 앱으로 가입.
function senkoUsers() {
  return {
    [SOURCE]: {
      businessName: '센코필라테스', phone: '010-4424-0000', adminRegistered: true,
      createdAt: kst('2026-09-22T08:59:00'), serviceStartDate: '2026-09-24',
      mealTime: '12:00', defaultLunch: 2, defaultSalad: 0, sameDailyMeal: false,
      weekdayMeals: { mon: { lunch: 2, salad: 0 }, tue: { lunch: 0, salad: 0 }, wed: { lunch: 0, salad: 0 }, thu: { lunch: 2, salad: 0 }, fri: { lunch: 0, salad: 0 } },
      lunchPrice: 7500, saladPrice: 7000, priceLunch: 7500, priceSalad: 7000,
      deliveryPlace: '진주시 직접등록로 1', deliveryPlaceDetail: '2층', adminMemo: '비닐X'
    },
    [TARGET]: {
      businessName: '센코 필라테스', email: 'senko@naver.com', phone: '01044240000',
      createdAt: kst('2026-10-07T10:00:00'),
      mealTime: '12:30', defaultLunch: 2, defaultSalad: 0, sameDailyMeal: true,
      deliveryPlace: '진주시 손님이적은로 9'
    },
    'auth-other': { businessName: '가나다식당', email: 'ganada@naver.com', phone: '010-1111-2222', createdAt: kst('2026-10-08T10:00:00') },
    biz_other: { businessName: '센코필라테스', phone: '010-4424-0000', adminRegistered: true, createdAt: kst('2026-10-01T10:00:00') }
  };
}

function deliveredRecord(uid, qty, price = 7500) {
  return {
    uid, businessName: '센코필라테스', lunchCount: qty, lunchQty: qty, lunchPrice: price,
    saladCount: 0, saladQty: 0, saladPrice: 7000, eventLunchQty: 0, cateringItems: [],
    totalQty: qty, totalAmount: qty * price, delivered: true, deliveredAt: 'T-delivered',
    orderDeleted: false, deleted: false, source: 'adminDefault'
  };
}

function seedSenko(db) {
  ['2026-09-15', '2026-09-17', '2026-09-22', '2026-09-28', '2026-10-01'].forEach(date => {
    db.seed(`deliveryRecords/${date}`, { date, records: { [SOURCE]: deliveredRecord(SOURCE, 2), 'auth-other': deliveredRecord('auth-other', 5, 8000) } });
  });
  db.seed(`settlements/2026-09/items/${SOURCE}`, {
    uid: SOURCE, type: 'customerMonthly', businessName: '센코필라테스', lunch: 8, lunchTotal: 8, lunchPrice: 7500,
    amount: 60000, adjust: 0, status: '입금완료', invoiceNo: 'GJS-202609-066', dueDate: '2026-10-10',
    payments: [{ amount: 60000, date: '2026-10-08', note: '' }], paidAmount: 60000,
    daily: { '2026-09-15': { lunch: 2 }, '2026-09-17': { lunch: 2 }, '2026-09-22': { lunch: 2 }, '2026-09-28': { lunch: 2 } }
  });
  db.seed(`settlements/2026-10/items/${SOURCE}`, {
    uid: SOURCE, type: 'customerMonthly', businessName: '센코필라테스', lunch: 2, lunchTotal: 2, lunchPrice: 7500,
    amount: 15000, adjust: 0, status: '청구완료', invoiceNo: 'GJS-202610-018', dueDate: '2026-11-10', payments: [],
    daily: { '2026-10-01': { lunch: 2 } }
  });
  // 관리자가 수량을 고쳐 저장한 날, 앞으로 잡아둔 휴무, 잠근 날의 기본수량
  db.seed(`orders/2026-09-15/items/${SOURCE}`, { uid: SOURCE, targetDate: '2026-09-15', lunchCount: 2, saladCount: 0, adminInput: true });
  db.seed(`orders/2026-10-15/items/${SOURCE}`, { uid: SOURCE, targetDate: '2026-10-15', lunchCount: 0, saladCount: 0, selfHoliday: true });
  db.seed(`orders/2026-12-24/items/${SOURCE}`, { uid: SOURCE, targetDate: '2026-12-24', lunchCount: 0, saladCount: 0, selfHoliday: true });
  db.seed(`orderDefaultSnapshots/2026-10-01/items/${SOURCE}`, { uid: SOURCE, businessName: '센코필라테스', lunchCount: 2, saladCount: 0 });
  db.seed(`users/${SOURCE}`, { businessName: '센코필라테스', adminRegistered: true });
  db.seed(`users/${TARGET}`, { businessName: '센코 필라테스', email: 'senko@naver.com' });
}

async function senkoMerged(options = {}) {
  const { db, api } = loadMerge();
  api.setUsers(senkoUsers());
  seedSenko(db);
  const scan = await api.scanMemberMerge(SOURCE, TARGET);
  await api.runMemberMerge(scan, options);
  return { db, api, scan };
}

test('합칠 대상은 앱으로 가입한 계정뿐이고, 업체명·번호가 같은 계정이 맨 위다', () => {
  const { api } = loadMerge();
  api.setUsers(senkoUsers());
  const list = plain(api.memberMergeCandidates(SOURCE));
  assert.deepEqual(list.map(item => item.uid), [TARGET, 'auth-other'], '자기 자신과 다른 직접 등록 업체는 대상이 아니다');
  // 업체명은 띄어쓰기를, 번호는 하이픈을 무시하고 맞춰 본다.
  assert.equal(list[0].sameName, true);
  assert.equal(list[0].samePhone, true);
  assert.equal(list[1].sameName, false);
  assert.deepEqual(plain(api.memberMergeCandidates(SOURCE, 'ganada')).map(item => item.uid), ['auth-other'], '이메일(아이디)로 찾는다');
  assert.deepEqual(plain(api.memberMergeCandidates(SOURCE, '없는업체')), []);
});

test('단가는 항상 직접 등록한 값을 쓴다', () => {
  const { api } = loadMerge();
  const users = senkoUsers();
  const kept = plain(api.memberMergeProfilePatch(users[SOURCE], users[TARGET], { keepSourceSettings: true }));
  const own = plain(api.memberMergeProfilePatch(users[SOURCE], users[TARGET], { keepSourceSettings: false }));
  [kept, own].forEach(patch => {
    assert.equal(patch.user.lunchPrice, 7500);
    assert.equal(patch.user.saladPrice, 7000);
    assert.equal(patch.user.priceLunch, 7500);
    assert.equal(patch.user.priceSalad, 7000);
    assert.equal(patch.private.adminMemo, '비닐X', '관리자 메모는 손님이 적을 수 없는 값이라 늘 넘긴다');
  });
  assert.equal(kept.user.businessName, '센코필라테스');
  assert.equal(kept.user.mealTime, '12:00');
  assert.equal(kept.user.sameDailyMeal, false);
  assert.deepEqual(kept.user.weekdayMeals.mon, { lunch: 2, salad: 0 });
  assert.deepEqual(kept.user.weekdayMeals.tue, { lunch: 0, salad: 0 });
  assert.equal(kept.user.serviceStartDate, '2026-09-24');
  assert.equal(kept.private.deliveryPlace, '진주시 직접등록로 1');
  assert.equal(kept.private.deliveryPlaceDetail, '2층');
  // 끄면 손님이 가입할 때 적은 업체명·수량·시간·배송지는 건드리지 않는다.
  ['businessName', 'mealTime', 'weekdayMeals', 'defaultLunch', 'sameDailyMeal', 'serviceStartDate', 'mealPaused'].forEach(key => {
    assert.equal(key in own.user, false, `${key} 를 덮으면 안 된다`);
  });
  assert.equal('deliveryPlace' in own.private, false);
  assert.equal('phone' in kept.user, false, '가입 계정에 번호가 있으면 그 번호를 둔다');
});

test('단가가 저장돼 있지 않은 직접 등록 업체는 기본 단가로 넘어간다', () => {
  const { api } = loadMerge();
  const patch = plain(api.memberMergeProfilePatch({ businessName: '단가없음' }, { email: 'a@b.c' }));
  assert.equal(patch.user.lunchPrice, 8000);
  assert.equal(patch.user.saladPrice, 8000);
  const zero = plain(api.memberMergeProfilePatch({ businessName: '무료', lunchPrice: 0, saladPrice: 0 }, { email: 'a@b.c' }));
  assert.equal(zero.user.lunchPrice, 0, '일부러 넣은 0원은 0원으로 넘어간다');
});

test('가입 계정에 번호가 없으면 직접 등록한 번호를 채우고, 일시정지 상태도 따라간다', () => {
  const { api } = loadMerge();
  const paused = plain(api.memberMergeProfilePatch(
    { businessName: '쉬는업체', phone: '010-1', mealPaused: true, mealPauseStartDate: '2026-10-12', mealResumeDate: '2026-10-19' },
    { email: 'a@b.c', phone: '' }
  ));
  assert.equal(paused.user.phone, '010-1');
  assert.equal(paused.user.mealPaused, true);
  assert.equal(paused.user.mealPauseStartDate, '2026-10-12');
  assert.equal(paused.user.mealResumeDate, '2026-10-19');
  const active = plain(api.memberMergeProfilePatch({ businessName: '도는업체' }, { email: 'a@b.c', mealPaused: true, mealPauseStartDate: '2026-10-01' }));
  assert.equal(active.user.mealPaused, false);
  assert.equal(active.user.mealPauseStartDate, '', '빈 값은 저장할 때 필드를 지우라는 뜻이다');
});

test('배송기록: 한쪽에만 있으면 옮기고, 양쪽에 다 있으면 관리자가 고른다', () => {
  const { api } = loadMerge();
  const live = deliveredRecord(SOURCE, 2);
  const pending = { lunchQty: 3, delivered: false };
  const orderDeleted = { orderDeleted: true, delivered: false, lunchQty: 0 };
  assert.equal(api.memberMergeRecordAction(null, live), 'none');
  assert.equal(api.memberMergeRecordAction({ ...live, deleted: true }, null), 'none', '이미 옮겨서 삭제 표시된 기록은 다시 옮기지 않는다');
  assert.equal(api.memberMergeRecordAction(live, null), 'move');
  assert.equal(api.memberMergeRecordAction(pending, null), 'move', '아직 배송 전이어도 수량이 있으면 옮긴다');
  assert.equal(api.memberMergeRecordAction(live, orderDeleted), 'move', '가입 계정 쪽이 주문 삭제 표시뿐이면 그 위에 옮긴다');
  assert.equal(api.memberMergeRecordAction(live, deliveredRecord(TARGET, 2)), 'overlap');
  assert.equal(api.memberMergeRecordAction(orderDeleted, null), 'move', '그날 주문을 빼 둔 표시도 따라간다');
  assert.equal(api.memberMergeRecordAction(orderDeleted, live), 'drop');
  assert.equal(api.memberMergeRecordAction({ lunchQty: 0, delivered: false }, null), 'drop');
});

test('주문·휴무: 같은 날 가입 계정 주문이 있으면 그쪽을 둔다', () => {
  const { api } = loadMerge();
  assert.equal(api.memberMergeOrderAction(null, { lunchCount: 2 }), 'none');
  assert.equal(api.memberMergeOrderAction({ selfHoliday: true }, null), 'move');
  assert.equal(api.memberMergeOrderAction({ selfHoliday: true }, { lunchCount: 2 }), 'drop');
});

test('정산: 가입 계정에 그 달 정산이 없으면 그대로 옮기고, 있으면 합친다', () => {
  const { api } = loadMerge();
  assert.equal(api.memberMergeSettlementAction(null, { amount: 1 }), 'none');
  assert.equal(api.memberMergeSettlementAction({ amount: 1 }, null), 'move');
  assert.equal(api.memberMergeSettlementAction({ amount: 1 }, { amount: 2 }), 'combine');
  // 한쪽이 다음 달로 이월돼 있으면 이월액과 "이월" 상태를 어느 몫으로 볼지 정할 수 없다.
  assert.equal(api.memberMergeSettlementAction({ amount: 1, carriedOverTo: '2026-11' }, { amount: 2 }), 'blocked');
  assert.equal(api.memberMergeSettlementAction({ amount: 1 }, { amount: 2, carriedOverTo: '2026-11' }), 'blocked');
  assert.equal(api.memberMergeSettlementAction({ amount: 1, carriedOverTo: '2026-11' }, null), 'move', '통째로 옮기는 달은 이월돼 있어도 된다');
  // 합치다 끊긴 달은 가입 계정 문서에 이미 이 업체 것이 얹혀 있다. 막지 않고 이어서 끝낸다.
  assert.equal(api.memberMergeSettlementAction({ amount: 1, carriedOverTo: '2026-11' }, { amount: 1, carriedOverTo: '2026-11', mergedFrom: SOURCE }, SOURCE), 'combine');
  assert.equal(api.memberMergeSettlementAction({ amount: 1, carriedOverTo: '2026-11' }, { amount: 1, mergedFrom: 'biz_other' }, SOURCE), 'blocked');
});

test('입금 기록 없이 "입금완료"만 찍힌 정산은 받은 돈을 기록 한 줄로 바꿔 합친다', () => {
  const { api } = loadMerge();
  assert.deepEqual(plain(api.memberMergePayments({ payments: [{ amount: 30000, date: '2026-10-01' }] })), [{ amount: 30000, date: '2026-10-01' }]);
  assert.deepEqual(plain(api.memberMergePayments({ amount: 60000, adjust: -1000, carryover: 5000, status: '입금완료', paidDate: '2026-10-08' })),
    [{ amount: 64000, date: '2026-10-08', note: '(합치기 전 입금)', recordedAt: '' }]);
  assert.deepEqual(plain(api.memberMergePayments({ amount: 60000, paidAmount: 20000, status: '부분입금' })),
    [{ amount: 20000, date: '', note: '(합치기 전 입금)', recordedAt: '' }]);
  assert.deepEqual(plain(api.memberMergePayments({ amount: 60000, status: '청구완료' })), []);
});

test('같은 달 정산을 합치면 양쪽 입금·조정·메모·이월이 다 남는다', () => {
  const { api } = loadMerge();
  const patch = plain(api.memberMergeSettlementCombinePatch(
    { amount: 30000, adjust: -1000, note: '첫 주 할인', status: '보류', payments: [{ amount: 10000, date: '2026-10-05' }], carryover: 60000, carryoverFrom: '2026-09', carryoverDates: ['2026-09-28'] },
    { amount: 16000, adjust: 500, note: '', status: '입금완료' },
    SOURCE
  ));
  assert.deepEqual(patch.payments, [
    { amount: 16500, date: '', note: '(합치기 전 입금)', recordedAt: '' },
    { amount: 10000, date: '2026-10-05' }
  ]);
  assert.equal(patch.paidAmount, 26500);
  assert.equal(patch.adjust, -500);
  assert.equal(patch.note, '첫 주 할인');
  assert.equal(patch.status, '보류', '보류는 사람이 일부러 잡아둔 상태라 남긴다');
  assert.equal(patch.carryover, 60000);
  assert.equal(patch.carryoverFrom, '2026-09');
  assert.deepEqual(patch.carryoverDates, ['2026-09-28']);
  assert.deepEqual(patch.carryoverFromUids, [SOURCE]);
  assert.equal(patch.mergedFrom, SOURCE);
  const noCarry = plain(api.memberMergeSettlementCombinePatch({ amount: 1000 }, { amount: 2000, carryover: 7000, carryoverFrom: '2026-09' }, SOURCE));
  assert.equal('carryover' in noCarry, false, '넘길 이월이 없으면 가입 계정의 이월을 건드리지 않는다');
  assert.equal('status' in noCarry, false);
});

test('미리보기: 등록일보다 앞선 배송과 1년 안의 휴무까지 찾는다', async () => {
  const { db, api } = loadMerge();
  api.setUsers(senkoUsers());
  seedSenko(db);
  const scan = await api.scanMemberMerge(SOURCE, TARGET);
  assert.deepEqual(plain(scan.months.map(entry => entry.month)), ['2026-09', '2026-10', '2026-12']);
  const summary = plain(api.memberMergeSummary(scan, senkoUsers()[TARGET]));
  assert.equal(summary.recordDays, 5);
  assert.equal(summary.recordQty, 10);
  assert.equal(summary.firstDate, '2026-09-15', '9/22 에 등록했지만 9/15 배송도 옮긴다');
  assert.equal(summary.lastDate, '2026-10-01');
  assert.equal(summary.orderMoves, 3);
  assert.equal(summary.holidayMoves, 2);
  assert.deepEqual(summary.overlaps, []);
  assert.deepEqual(summary.blockedMonths, []);
  // 10/5(월)은 아직 배송완료를 누르지 않았다. 가입 계정은 10/7 에 가입해 그날 기본 주문 줄이 없다.
  assert.deepEqual(summary.pendingDates, ['2026-10-05']);
  assert.deepEqual(summary.settlements, [
    { month: '2026-09', action: 'move', recalc: false, billed: 60000, paid: 60000, balance: 0 },
    { month: '2026-10', action: 'move', recalc: false, billed: 15000, paid: 0, balance: 15000 }
  ]);
  assert.equal(db.state.writes, 0, '확인만 할 때는 아무것도 쓰지 않는다');
});

test('합치면 배송기록·주문·휴무·정산이 가입 계정으로 옮겨지고 직접 등록은 닫힌다', async () => {
  const { db, api } = await senkoMerged();

  // 배송기록: 가입 계정으로 옮기고 옛 uid 에는 삭제 표시. 다른 업체 기록은 그대로다.
  const day = db.read('deliveryRecords/2026-09-28').records;
  assert.equal(day[TARGET].uid, TARGET);
  assert.equal(day[TARGET].lunchQty, 2);
  assert.equal(day[TARGET].lunchPrice, 7500);
  assert.equal(day[TARGET].delivered, true);
  assert.equal(day[TARGET].deliveredAt, 'T-delivered');
  assert.equal(day[TARGET].mergedFrom, SOURCE);
  assert.equal(day[TARGET].businessName, '센코필라테스');
  assert.equal(day[SOURCE].deleted, true);
  assert.equal(day[SOURCE].mergedInto, TARGET);
  assert.equal(day['auth-other'].lunchQty, 5);
  assert.equal(day['auth-other'].deleted, false);

  // 정산: 금액·입금·청구서 번호 그대로. 다시 계산하지 않는다.
  const september = db.read(`settlements/2026-09/items/${TARGET}`);
  assert.equal(september.uid, TARGET);
  assert.equal(september.amount, 60000);
  assert.equal(september.lunch, 8);
  assert.equal(september.lunchPrice, 7500);
  assert.equal(september.status, '입금완료');
  assert.equal(september.invoiceNo, 'GJS-202609-066');
  assert.deepEqual(september.payments, [{ amount: 60000, date: '2026-10-08', note: '' }]);
  assert.deepEqual(Object.keys(september.daily).sort(), ['2026-09-15', '2026-09-17', '2026-09-22', '2026-09-28']);
  const october = db.read(`settlements/2026-10/items/${TARGET}`);
  assert.equal(october.amount, 15000);
  assert.equal(october.status, '청구완료');
  assert.equal(db.read(`settlements/2026-09/items/${SOURCE}`), null);
  assert.equal(db.read(`settlements/2026-10/items/${SOURCE}`), null);
  assert.deepEqual(plain(api.rebuildCalls), [], '그대로 옮긴 달은 다시 계산하지 않는다');

  // 주문·휴무·잠금 기본수량
  assert.equal(db.read(`orders/2026-10-15/items/${TARGET}`).selfHoliday, true);
  assert.equal(db.read(`orders/2026-10-15/items/${TARGET}`).uid, TARGET);
  assert.equal(db.read(`orders/2026-12-24/items/${TARGET}`).selfHoliday, true);
  assert.equal(db.read(`orders/2026-09-15/items/${TARGET}`).adminInput, true);
  ['2026-09-15', '2026-10-15', '2026-12-24'].forEach(date => assert.equal(db.read(`orders/${date}/items/${SOURCE}`), null));
  assert.equal(db.read(`orderDefaultSnapshots/2026-10-01/items/${TARGET}`).lunchCount, 2);
  assert.equal(db.read(`orderDefaultSnapshots/2026-10-01/items/${SOURCE}`), null);

  // 가입 전 날짜는 가입 계정의 기본 주문 줄이 없다. 주문 문서를 남겨 그날 주문표에 줄이 보이게 한다.
  const history = db.read(`orders/2026-09-28/items/${TARGET}`);
  assert.equal(history.uid, TARGET);
  assert.equal(history.targetDate, '2026-09-28');
  assert.equal(history.lunchCount, 2);
  assert.equal(history.selfHoliday, false);
  assert.equal(history.adminInput, true);
  assert.equal(history.mergedFrom, SOURCE);

  // 아직 배송완료 전인 10/5 줄은 가입 계정 주문으로 남는다. 안 남기면 그날 주문표에서 센코가 사라진다.
  const pending = db.read(`orders/2026-10-05/items/${TARGET}`);
  assert.equal(pending.lunchCount, 2);
  assert.equal(pending.targetDate, '2026-10-05');
  assert.equal(pending.selfHoliday, false);
  assert.equal(pending.adminInput, true);
  assert.equal(pending.mergedFrom, SOURCE);
  assert.equal(db.read('deliveryRecords/2026-10-05'), null, '배송완료는 관리자가 누른다. 기록을 대신 만들지 않는다');

  // 고객 문서
  const target = db.read(`users/${TARGET}`);
  assert.equal(target.lunchPrice, 7500);
  assert.equal(target.priceLunch, 7500);
  assert.equal(target.saladPrice, 7000);
  assert.equal(target.businessName, '센코필라테스');
  assert.equal(target.email, 'senko@naver.com', '로그인 이메일은 그대로다');
  assert.deepEqual(target.weekdayMeals.thu, { lunch: 2, salad: 0 });
  assert.deepEqual(target.mergedFrom, [SOURCE]);
  assert.equal('mealPauseStartDate' in target, false);
  assert.equal(db.read(`userPrivate/${TARGET}`).deliveryPlace, '진주시 직접등록로 1');
  assert.equal(db.read(`userPrivate/${TARGET}`).adminMemo, '비닐X');
  const source = db.read(`users/${SOURCE}`);
  assert.equal(source.deleted, true);
  assert.equal(source.disabled, true);
  assert.equal(source.mergedInto, TARGET);
});

test('"가입할 때 적은 내용을 둔다"로 합쳐도 단가와 기록은 옮겨진다', async () => {
  const { db } = await senkoMerged({ keepSourceSettings: false });
  const target = db.read(`users/${TARGET}`);
  assert.equal(target.lunchPrice, 7500);
  assert.equal(target.businessName, '센코 필라테스');
  assert.equal('weekdayMeals' in target, false);
  assert.equal('deliveryPlace' in (db.read(`userPrivate/${TARGET}`) || {}), false);
  assert.equal(db.read(`settlements/2026-09/items/${TARGET}`).amount, 60000);
  // 배송기록의 업체명은 가입 계정에 남는 이름을 따른다.
  assert.equal(db.read('deliveryRecords/2026-09-28').records[TARGET].businessName, '센코 필라테스');
});

test('다 합친 뒤 다시 읽으면 옮길 것이 남아 있지 않다', async () => {
  const { api } = await senkoMerged();
  // 실제로는 합친 뒤 직접 등록이 삭제회원으로 내려가 다시 누를 수 없다. 남은 데이터가 없는지만 본다.
  api.setUsers(senkoUsers());
  const scan = await api.scanMemberMerge(SOURCE, TARGET);
  const summary = plain(api.memberMergeSummary(scan, senkoUsers()[TARGET]));
  assert.equal(summary.recordDays, 0);
  assert.equal(summary.orderMoves, 0);
  assert.deepEqual(summary.pendingDates, [], '남겨둔 주문을 또 만들지 않는다');
  assert.deepEqual(summary.settlements, []);
});

test('도중에 끊겨도 직접 등록은 살아 있고, 다시 누르면 남은 것만 옮겨 같은 결과가 된다', async () => {
  const expected = (await senkoMerged()).db;
  const writesNeeded = expected.state.writes;
  assert.ok(writesNeeded > 10);
  // 쓰기 한 번 한 번마다 그 자리에서 끊어 본다.
  for (let failAt = 1; failAt <= writesNeeded; failAt += 1) {
    const { db, api } = loadMerge();
    api.setUsers(senkoUsers());
    seedSenko(db);
    db.state.failAt = failAt;
    const first = await api.scanMemberMerge(SOURCE, TARGET);
    await assert.rejects(api.runMemberMerge(first), /연결이 끊겼습니다/);
    assert.notEqual(db.read(`users/${SOURCE}`).deleted, true, `${failAt}번째 쓰기에서 끊겼는데 직접 등록이 먼저 닫혔다`);
    // 화면은 실패하면 고객 목록을 다시 읽는다. 직접 등록 쪽 설정은 그대로다.
    db.state.failAt = 0;
    api.setUsers(senkoUsers());
    const second = await api.scanMemberMerge(SOURCE, TARGET);
    await api.runMemberMerge(second);
    [
      `settlements/2026-09/items/${TARGET}`, `settlements/2026-10/items/${TARGET}`,
      `settlements/2026-09/items/${SOURCE}`, `settlements/2026-10/items/${SOURCE}`,
      `orders/2026-10-15/items/${TARGET}`, `orders/2026-12-24/items/${TARGET}`, `orders/2026-09-15/items/${TARGET}`,
      `orders/2026-10-05/items/${TARGET}`, `orders/2026-09-28/items/${TARGET}`,
      `orders/2026-10-15/items/${SOURCE}`, `orderDefaultSnapshots/2026-10-01/items/${TARGET}`,
      `users/${SOURCE}`, `userPrivate/${TARGET}`
    ].forEach(target => {
      const strip = doc => {
        if (doc) delete doc.updatedAt;
        return doc;
      };
      assert.deepEqual(strip(db.read(target)), strip(expected.read(target)), `${failAt}번째 쓰기에서 끊긴 뒤 ${target}`);
    });
    ['2026-09-15', '2026-09-17', '2026-09-22', '2026-09-28', '2026-10-01'].forEach(date => {
      const records = db.read(`deliveryRecords/${date}`).records;
      assert.equal(records[TARGET].lunchQty, 2, `${failAt}번째 쓰기에서 끊긴 뒤 ${date} 수량`);
      assert.equal(records[TARGET].delivered, true);
      assert.equal(records[SOURCE].deleted, true);
    });
    assert.equal(db.read(`users/${TARGET}`).lunchPrice, 7500);
    assert.deepEqual(db.read(`users/${TARGET}`).mergedFrom, [SOURCE]);
  }
});

// 가입한 뒤에도 직접 등록 줄이 주문표에 남아 있어, 같은 날 양쪽이 다 배송완료된 경우.
function seedOverlap(db) {
  db.seed('deliveryRecords/2026-10-01', { date: '2026-10-01', records: { [SOURCE]: deliveredRecord(SOURCE, 2) } });
  db.seed('deliveryRecords/2026-10-08', { date: '2026-10-08', records: { [SOURCE]: deliveredRecord(SOURCE, 2), [TARGET]: deliveredRecord(TARGET, 3, 8000) } });
  db.seed(`settlements/2026-10/items/${SOURCE}`, {
    uid: SOURCE, lunch: 4, lunchPrice: 7500, amount: 30000, adjust: -1000, note: '첫 주 할인', status: '청구완료',
    payments: [{ amount: 10000, date: '2026-10-05' }], invoiceNo: 'GJS-202610-018'
  });
  db.seed(`settlements/2026-10/items/${TARGET}`, {
    uid: TARGET, lunch: 3, lunchPrice: 8000, amount: 24000, adjust: 0, note: '', status: '청구완료', payments: [], invoiceNo: 'GJS-202610-040'
  });
  db.seed(`orders/2026-10-08/items/${SOURCE}`, { uid: SOURCE, targetDate: '2026-10-08', lunchCount: 2, adminInput: true });
  db.seed(`orders/2026-10-08/items/${TARGET}`, { uid: TARGET, targetDate: '2026-10-08', lunchCount: 3 });
  db.seed(`users/${SOURCE}`, { businessName: '센코필라테스', adminRegistered: true });
  db.seed(`users/${TARGET}`, { businessName: '센코 필라테스', email: 'senko@naver.com' });
}

async function overlapMerged(overlapMode) {
  const { db, api } = loadMerge({ today: '2026-10-09' });
  const users = senkoUsers();
  users[TARGET].createdAt = kst('2026-10-02T10:00:00');
  api.setUsers(users);
  seedOverlap(db);
  const scan = await api.scanMemberMerge(SOURCE, TARGET);
  return { db, api, scan, run: () => api.runMemberMerge(scan, { overlapMode }) };
}

test('같은 날 양쪽에 배송기록이 있으면 고르기 전에는 합치지 않는다', async () => {
  const { db, api, scan, run } = await overlapMerged('');
  const summary = plain(api.memberMergeSummary(scan, api.users()[TARGET]));
  assert.deepEqual(summary.overlaps, [{ date: '2026-10-08', sourceQty: 2, targetQty: 3 }]);
  assert.deepEqual(summary.settlements.map(item => item.action), ['combine']);
  assert.equal(summary.orderDrops, 1);
  // 가입 계정이 10/2 에 가입해 그 뒤 날짜는 스스로 기본 주문 줄이 있다. 따로 남길 줄이 없다.
  assert.deepEqual(summary.pendingDates, []);
  await assert.rejects(run(), /골라주세요/);
  assert.equal(db.state.writes, 0, '고르기 전에는 단가도 옮기지 않는다');
  assert.notEqual(db.read(`users/${SOURCE}`).deleted, true);
  assert.equal(db.read('deliveryRecords/2026-10-08').records[TARGET].lunchQty, 3, '고르기 전에는 가입 계정 기록을 건드리지 않는다');
});

test('겹친 날: 직접 등록 쪽만 · 가입 계정 쪽만 · 더하기', async () => {
  const cases = { source: 2, target: 3, sum: 5 };
  for (const [mode, expectedQty] of Object.entries(cases)) {
    const { db, api, run } = await overlapMerged(mode);
    await run();
    const records = db.read('deliveryRecords/2026-10-08').records;
    assert.equal(records[TARGET].lunchQty, expectedQty, mode);
    // 10/1 에 옮긴 2개 + 10/8. 배송기록을 다 옮긴 뒤에 다시 계산해야 이 수가 나온다.
    assert.equal(db.read(`settlements/2026-10/items/${TARGET}`).recountedLunch, 2 + expectedQty, mode);
    assert.equal(records[TARGET].delivered, true, mode);
    assert.equal(records[TARGET].uid, TARGET, mode);
    assert.equal(records[SOURCE].deleted, true, mode);
    // 겹치지 않은 날은 그대로 옮긴다.
    assert.equal(db.read('deliveryRecords/2026-10-01').records[TARGET].lunchQty, 2, mode);
    // 가입 계정 주문은 그대로, 직접 등록 쪽 주문은 지운다.
    assert.equal(db.read(`orders/2026-10-08/items/${TARGET}`).lunchCount, 3, mode);
    assert.equal(db.read(`orders/2026-10-08/items/${SOURCE}`), null, mode);
    // 정산은 입금·조정·메모를 합치고, 수량과 금액은 배송기록에서 다시 계산한다.
    const settlement = db.read(`settlements/2026-10/items/${TARGET}`);
    assert.deepEqual(settlement.payments, [{ amount: 10000, date: '2026-10-05' }], mode);
    assert.equal(settlement.adjust, -1000, mode);
    assert.equal(settlement.note, '첫 주 할인', mode);
    assert.equal(settlement.invoiceNo, 'GJS-202610-040', '청구서 번호는 가입 계정 것을 둔다');
    assert.equal(db.read(`settlements/2026-10/items/${SOURCE}`), null, mode);
    assert.deepEqual(plain(api.rebuildCalls), [`2026-10 ${TARGET}`], mode);
    assert.equal(db.read(`users/${SOURCE}`).deleted, true, mode);
  }
});

test('겹친 달을 합치다 끊겨도 입금이 두 번 얹히지 않고, 다시 누르면 같은 결과가 된다', async () => {
  for (const mode of ['source', 'target', 'sum']) {
    const expected = await overlapMerged(mode);
    await expected.run();
    const writesNeeded = expected.db.state.writes;
    for (let failAt = 1; failAt <= writesNeeded; failAt += 1) {
      const where = `${mode} · ${failAt}번째 쓰기에서 끊김`;
      const { db, api, run } = await overlapMerged(mode);
      db.state.failAt = failAt;
      await assert.rejects(run(), /연결이 끊겼습니다/);
      assert.notEqual(db.read(`users/${SOURCE}`).deleted, true, where);
      db.state.failAt = 0;
      const users = senkoUsers();
      users[TARGET].createdAt = kst('2026-10-02T10:00:00');
      api.setUsers(users);
      // 겹친 날을 이미 넘겼으면 다시 고를 것이 없다. 아직이면 같은 선택으로 이어간다.
      await api.runMemberMerge(await api.scanMemberMerge(SOURCE, TARGET), { overlapMode: mode });
      const settlement = db.read(`settlements/2026-10/items/${TARGET}`);
      const want = expected.db.read(`settlements/2026-10/items/${TARGET}`);
      assert.deepEqual(settlement.payments, [{ amount: 10000, date: '2026-10-05' }], `${where}: 입금 기록`);
      assert.equal(settlement.adjust, -1000, `${where}: 조정금액`);
      assert.equal(settlement.recountedLunch, want.recountedLunch, `${where}: 다시 계산한 수량`);
      assert.equal(db.read(`settlements/2026-10/items/${SOURCE}`), null, where);
      assert.equal(db.read('deliveryRecords/2026-10-08').records[TARGET].lunchQty,
        expected.db.read('deliveryRecords/2026-10-08').records[TARGET].lunchQty, `${where}: 겹친 날 수량`);
      assert.equal(db.read('deliveryRecords/2026-10-01').records[TARGET].lunchQty, 2, where);
      assert.equal(db.read(`users/${SOURCE}`).deleted, true, where);
    }
  }
});

test('가입 계정에 그 달 배송은 있는데 정산 문서가 없으면, 옮긴 뒤 배송기록에서 다시 계산한다', async () => {
  // 보류로 자동 청구가 건너뛰어진 경우 등. 직접 등록 쪽 문서(입금 포함)를 옮기고 수량은 다시 센다.
  const users = senkoUsers();
  users[TARGET].createdAt = kst('2026-10-02T10:00:00');
  const { db, api } = loadMerge({ today: '2026-10-09' });
  api.setUsers(users);
  db.seed(`users/${SOURCE}`, { businessName: '센코필라테스', adminRegistered: true });
  db.seed(`users/${TARGET}`, { businessName: '센코 필라테스', email: 'senko@naver.com' });
  db.seed('deliveryRecords/2026-10-01', { date: '2026-10-01', records: { [SOURCE]: deliveredRecord(SOURCE, 2) } });
  db.seed('deliveryRecords/2026-10-06', { date: '2026-10-06', records: { [TARGET]: deliveredRecord(TARGET, 4, 8000) } });
  db.seed(`settlements/2026-10/items/${SOURCE}`, {
    uid: SOURCE, lunch: 2, lunchPrice: 7500, amount: 15000, status: '청구완료', payments: [{ amount: 5000, date: '2026-10-03' }], invoiceNo: 'GJS-202610-018'
  });
  const scan = await api.scanMemberMerge(SOURCE, TARGET);
  assert.deepEqual(plain(api.memberMergeSummary(scan, users[TARGET])).settlements,
    [{ month: '2026-10', action: 'move', recalc: true, billed: 15000, paid: 5000, balance: 10000 }]);
  await api.runMemberMerge(scan);
  const settlement = db.read(`settlements/2026-10/items/${TARGET}`);
  assert.deepEqual(settlement.payments, [{ amount: 5000, date: '2026-10-03' }]);
  assert.equal(settlement.invoiceNo, 'GJS-202610-018');
  assert.equal(settlement.recountedLunch, 6, '직접 등록 2개 + 가입 계정 4개');
  assert.equal(db.read(`settlements/2026-10/items/${SOURCE}`), null);
  assert.deepEqual(plain(api.rebuildCalls), [`2026-10 ${TARGET}`]);
});

test('한쪽이 다음 달로 이월된 달을 합쳐야 하면 아무것도 옮기지 않고 막는다', async () => {
  const { db, api } = loadMerge();
  api.setUsers(senkoUsers());
  seedOverlap(db);
  db.seed(`settlements/2026-10/items/${SOURCE}`, { uid: SOURCE, amount: 30000, status: '이월', carriedOverTo: '2026-11', carriedOverAmount: 30000 });
  const scan = await api.scanMemberMerge(SOURCE, TARGET);
  assert.deepEqual(plain(api.memberMergeSummary(scan)).blockedMonths, ['2026-10']);
  await assert.rejects(api.runMemberMerge(scan, { overlapMode: 'source' }), /2026년 10월 정산은 자동으로 합칠 수 없습니다/);
  assert.equal(db.state.writes, 0, '막히면 단가도 옮기지 않는다');
  assert.equal(db.read('deliveryRecords/2026-10-01').records[SOURCE].deleted, false, '막힌 달의 배송기록은 건드리지 않는다');
  assert.notEqual(db.read(`users/${SOURCE}`).deleted, true);
});

test('정산 문서 없이 배송기록만 넘어온 달은 가입 계정 정산을 다시 계산한다', async () => {
  const { db, api } = loadMerge();
  api.setUsers(senkoUsers());
  db.seed('deliveryRecords/2026-10-01', { date: '2026-10-01', records: { [SOURCE]: deliveredRecord(SOURCE, 2) } });
  db.seed(`users/${SOURCE}`, { businessName: '센코필라테스', adminRegistered: true });
  db.seed(`users/${TARGET}`, { businessName: '센코 필라테스', email: 'senko@naver.com' });
  await api.runMemberMerge(await api.scanMemberMerge(SOURCE, TARGET));
  assert.deepEqual(plain(api.rebuildCalls), [`2026-10 ${TARGET}`]);
});

test('가입 당일처럼 아직 배송 전인 줄은 가입 계정 주문으로 남는다', async () => {
  // 10/8(목) 아침 10시에 가입(주문 마감 09:20 뒤)하고, 관리자가 그날 바로 합친다.
  // 직접 등록 쪽에는 오늘 '요일 기본값 2개' 줄만 떠 있고 주문 문서도 배송기록도 없다.
  const users = senkoUsers();
  users[TARGET].createdAt = kst('2026-10-08T10:00:00');
  const { db, api } = loadMerge({ today: '2026-10-08' });
  api.setUsers(users);
  db.seed(`users/${SOURCE}`, { businessName: '센코필라테스', adminRegistered: true });
  db.seed(`users/${TARGET}`, { businessName: '센코 필라테스', email: 'senko@naver.com' });
  db.seed('deliveryRecords/2026-10-01', { date: '2026-10-01', records: { [SOURCE]: deliveredRecord(SOURCE, 2) } });
  // 오늘은 주문을 잠가 뒀고, 잠글 때 수량은 3개였다.
  db.seed(`orderDefaultSnapshots/2026-10-08/items/${SOURCE}`, { uid: SOURCE, businessName: '센코필라테스', lunchCount: 3, saladCount: 0 });
  const scan = await api.scanMemberMerge(SOURCE, TARGET);
  assert.deepEqual(plain(api.memberMergeSummary(scan, users[TARGET])).pendingDates, ['2026-10-05', '2026-10-08']);
  await api.runMemberMerge(scan);
  assert.equal(db.read(`orders/2026-10-05/items/${TARGET}`).lunchCount, 2, '월요일 기본수량');
  const todayOrder = db.read(`orders/2026-10-08/items/${TARGET}`);
  assert.equal(todayOrder.lunchCount, 3, '잠근 날은 잠금 시점 수량을 따른다');
  assert.equal(todayOrder.uid, TARGET);
  assert.equal(todayOrder.submittedBy, 'admin-uid');
  // 화·수·금은 기본수량이 0이라 줄이 없던 날이다. 만들지 않는다.
  ['2026-10-06', '2026-10-07', '2026-10-02'].forEach(date => assert.equal(db.read(`orders/${date}/items/${TARGET}`), null, date));
  // 다음 주부터는 가입 계정의 기본 주문 줄이 스스로 뜬다. 미리 만들어 두지 않는다.
  assert.equal(db.read(`orders/2026-10-12/items/${TARGET}`), null);
});

test('남길 줄이 없는 경우: 가입 계정이 이미 그날 줄을 갖고 있거나, 직접 등록 쪽에 줄이 없던 날', async () => {
  const { api } = loadMerge({ today: '2026-10-08' });
  const source = senkoUsers()[SOURCE];
  assert.deepEqual(plain(api.memberMergePendingDefault(source, '2026-10-08')), { lunch: 2, salad: 0, event: 0, disposableLunch: false });
  assert.equal(api.memberMergePendingDefault(source, '2026-10-07'), null, '수요일은 기본수량 0');
  assert.equal(api.memberMergePendingDefault(source, '2026-09-21'), null, '서비스 시작일(9/24) 전');
  assert.equal(api.memberMergePendingDefault({ ...source, mealPaused: true, mealPauseStartDate: '2026-10-01' }, '2026-10-08'), null, '일시정지 중');
  // 일회용도시락 업체는 도시락 수량이 일회용으로 잡힌다.
  assert.deepEqual(plain(api.memberMergePendingDefault({ ...source, disposableLunch: true }, '2026-10-08')),
    { lunch: 0, salad: 0, event: 2, disposableLunch: true });

  // 가입 계정이 10/1 에 가입해 이미 자기 줄이 있으면 따로 만들지 않는다.
  const users = senkoUsers();
  users[TARGET].createdAt = kst('2026-10-01T08:00:00');
  const { db, api: merged } = loadMerge({ today: '2026-10-08' });
  merged.setUsers(users);
  db.seed(`users/${SOURCE}`, { businessName: '센코필라테스', adminRegistered: true });
  db.seed(`users/${TARGET}`, { businessName: '센코 필라테스', email: 'senko@naver.com' });
  db.seed('deliveryRecords/2026-10-01', { date: '2026-10-01', records: { [SOURCE]: deliveredRecord(SOURCE, 2) } });
  const scan = await merged.scanMemberMerge(SOURCE, TARGET);
  assert.deepEqual(plain(merged.memberMergeSummary(scan, users[TARGET])).pendingDates, []);
  await merged.runMemberMerge(scan);
  assert.equal(db.read(`orders/2026-10-08/items/${TARGET}`), null);
  assert.equal(db.read(`orders/2026-10-05/items/${TARGET}`), null);
});

test('직접 등록 업체끼리, 또는 가입 계정을 직접 등록 쪽으로는 합치지 않는다', async () => {
  const { db, api } = loadMerge();
  api.setUsers(senkoUsers());
  seedSenko(db);
  await assert.rejects(api.runMemberMerge({ sourceUid: SOURCE, targetUid: 'biz_other', months: [] }), /가입 계정으로만/);
  await assert.rejects(api.runMemberMerge({ sourceUid: TARGET, targetUid: 'auth-other', months: [] }), /가입 계정으로만/);
  await assert.rejects(api.runMemberMerge({ sourceUid: SOURCE, targetUid: 'gone', months: [] }), /업체 목록이 바뀌었습니다/);
  assert.equal(db.state.writes, 0);
});

test('직접 등록 쪽은 맨 마지막에 닫는다', () => {
  const run = extractFunction('runMemberMerge');
  const closeAt = run.indexOf("db.collection('users').doc(sourceUid).update(");
  assert.notEqual(closeAt, -1);
  ['saveDeliveryRecords(', 'commitBatchOps(', 'rebuildSettlementsForUids(', "db.collection('users').doc(targetUid).update("].forEach(step => {
    const at = run.lastIndexOf(step);
    assert.notEqual(at, -1, step);
    assert.ok(at < closeAt, `${step} 가 직접 등록을 닫은 뒤에 있으면, 도중에 끊겼을 때 다시 이어갈 수 없다`);
  });
});

test('합치기 버튼은 직접 등록한 업체의 고객정보 창에만 보인다', () => {
  assert.match(adminSource, /id="member-merge-row" style="display:none"/);
  assert.match(extractFunction('openMemberEdit'),
    /getElementById\('member-merge-row'\)\.style\.display = isAdminRegisteredBusiness\(\{ \.\.\.u, uid \}\) \? '' : 'none'/);
  assert.match(extractFunction('openBusinessCreate'), /getElementById\('member-merge-row'\)\.style\.display = 'none'/);
  assert.match(extractFunction('openMemberMergeModal'), /isAdminRegisteredBusiness\(\{ \.\.\.source, uid: sourceUid \}\)/);
});

test('합쳐진 직접 등록 업체는 삭제회원 목록에서 복구할 수 없다', () => {
  const restore = extractFunction('restoreMember');
  assert.match(restore, /deletedUsers\[uid\]\?\.mergedInto/);
  assert.ok(restore.indexOf('mergedInto') < restore.indexOf('confirm('), '확인 창보다 먼저 막아야 한다');
  assert.match(extractFunction('memberDeletedRowHtml'), /합쳐짐/);
});
