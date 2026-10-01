'use strict';

// 여러 날짜 자체 휴무 창이 이미 저장한 휴무를 보여주지 않았다.
// 14·15·16일을 쉬는 날로 저장한 뒤 다시 열면 달력이 비어 있었고, 거기서 취소할 방법도 없었다.
// 이제 열 때 그 달의 휴무를 불러와 선택된 상태로 두고, 선택을 풀고 저장하면 휴무를 지운다.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const rootDir = path.resolve(__dirname, '../../..');
const customerSource = fs.readFileSync(path.join(rootDir, 'customer.html'), 'utf8');

function extractFunction(name) {
  const start = customerSource.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} 함수를 찾지 못했습니다.`);
  const asyncStart = customerSource.slice(start - 6, start) === 'async ' ? start - 6 : start;
  let depth = 0;
  for (let i = customerSource.indexOf('{', customerSource.indexOf(')', start)); i < customerSource.length; i += 1) {
    if (customerSource[i] === '{') depth += 1;
    else if (customerSource[i] === '}') { depth -= 1; if (!depth) return customerSource.slice(asyncStart, i + 1); }
  }
  throw new Error(`${name} 함수 끝을 찾지 못했습니다.`);
}

const UID = 'cust-1';

// orders/{date}/items/{uid} 와 orderLocks/{date} 만 흉내 낸다.
function fakeDb(orders, locks = []) {
  const store = new Map(Object.entries(orders));
  const writes = [];
  const docRef = (date) => ({
    date,
    async get() {
      const data = store.get(date);
      return { exists: data !== undefined, data: () => data, ref: docRef(date) };
    }
  });
  return {
    store,
    writes,
    collection(name) {
      if (name === 'orderLocks') {
        return { doc: date => ({ async get() { return { exists: locks.includes(date) }; } }) };
      }
      assert.equal(name, 'orders');
      return {
        doc: date => ({
          collection: () => ({
            doc: uid => { assert.equal(uid, UID); return docRef(date); }
          })
        })
      };
    },
    batch() {
      const ops = [];
      return {
        set(ref, data) { ops.push(['set', ref.date, data]); },
        delete(ref) { ops.push(['delete', ref.date]); },
        async commit() {
          ops.forEach(([kind, date, data]) => {
            writes.push([kind, date]);
            if (kind === 'set') store.set(date, data);
            else store.delete(date);
          });
        }
      };
    }
  };
}

function load(db, { confirm = true } = {}) {
  const toasts = [];
  const errors = [];
  const button = { disabled: false, textContent: '' };
  const context = {
    db,
    toasts,
    errors,
    currentUser: { uid: UID },
    firebase: { firestore: { FieldValue: { serverTimestamp: () => 'now' } } },
    window: { confirm: () => confirm },
    document: { getElementById: id => (id === 'multi-holiday-save-btn' ? button : null) },
    showToast: (message, kind) => toasts.push([kind, message]),
    showMultiHolidayError: message => { if (message) errors.push(message); },
    renderMultiHolidayCalendar: () => {},
    closeMultiHolidayModal: () => {},
    renderToday: async () => {},
    renderWeek: async () => {},
    formatDateKR: date => date,
    holidayName: () => '',
    isWeekendDate: date => [0, 6].includes(new Date(`${date}T00:00:00Z`).getUTCDay()),
    // 10월 1일(목)이 오늘. 1년 범위는 이 테스트에 상관없다.
    getMultiHolidayRange: () => ({ minDate: '2026-10-01', maxDate: '2027-10-01' }),
    getMultiHolidayDateState: date => ({ enabled: date >= '2026-10-01', reason: '지난 날짜' })
  };
  vm.createContext(context);
  vm.runInContext([
    'const MULTI_HOLIDAY_MAX_DATES = 31;',
    "let multiHolidaySelectedDates = [];",
    "let multiHolidayCalendarMonth = '2026-10';",
    'let multiHolidaySavedDates = new Set();',
    'let multiHolidayLoadedMonths = new Set();',
    "let multiHolidayLoadingMonth = '';",
    'let multiHolidayOpenToken = 1;',
    extractFunction('loadMultiHolidayMonth'),
    extractFunction('multiHolidayChanges'),
    extractFunction('toggleMultiHolidayDate'),
    extractFunction('saveMultiSelfHolidays')
  ].join('\n'), context);
  context.read = expr => vm.runInContext(expr, context);
  context.selected = () => JSON.parse(vm.runInContext('JSON.stringify(multiHolidaySelectedDates)', context));
  context.changes = () => JSON.parse(vm.runInContext('JSON.stringify(multiHolidayChanges())', context));
  return context;
}

const holiday = date => ({ uid: UID, targetDate: date, lunchCount: 0, saladCount: 0, selfHoliday: true });

test('창을 열면 그 달에 저장된 자체 휴무가 선택된 상태로 뜬다', async () => {
  const db = fakeDb({
    '2026-10-14': holiday('2026-10-14'),
    '2026-10-15': holiday('2026-10-15'),
    '2026-10-16': holiday('2026-10-16'),
    // 주문한 날은 휴무가 아니다
    '2026-10-20': { uid: UID, lunchCount: 3, saladCount: 0 }
  });
  const app = load(db);
  await app.loadMultiHolidayMonth('2026-10');
  assert.deepEqual(app.selected(), ['2026-10-14', '2026-10-15', '2026-10-16']);
  // 아직 아무것도 바꾸지 않았으니 저장할 것이 없다.
  assert.deepEqual(app.changes(), { added: [], removed: [] });
});

test('저장된 휴무를 다시 눌러 풀고 저장하면 그 날 휴무를 지운다', async () => {
  const db = fakeDb({
    '2026-10-14': holiday('2026-10-14'),
    '2026-10-15': holiday('2026-10-15'),
    '2026-10-16': holiday('2026-10-16')
  });
  const app = load(db);
  await app.loadMultiHolidayMonth('2026-10');
  app.toggleMultiHolidayDate('2026-10-15');
  assert.deepEqual(app.changes(), { added: [], removed: ['2026-10-15'] });

  await app.saveMultiSelfHolidays();
  assert.deepEqual(db.writes, [['delete', '2026-10-15']]);
  assert.ok(db.store.has('2026-10-14'));
  assert.ok(db.store.has('2026-10-16'));
  assert.equal(app.toasts.at(-1)[0], 'success');
  assert.match(app.toasts.at(-1)[1], /1일 휴무 취소/);
});

test('추가와 취소를 한 번에 저장한다', async () => {
  const db = fakeDb({ '2026-10-14': holiday('2026-10-14') });
  const app = load(db);
  await app.loadMultiHolidayMonth('2026-10');
  app.toggleMultiHolidayDate('2026-10-14');
  app.toggleMultiHolidayDate('2026-10-21');
  await app.saveMultiSelfHolidays();
  assert.deepEqual(db.writes.sort(), [['delete', '2026-10-14'], ['set', '2026-10-21']]);
  assert.equal(db.store.get('2026-10-21').selfHoliday, true);
  assert.match(app.toasts.at(-1)[1], /1일 자체 휴무 등록, 1일 휴무 취소/);
});

test('창을 연 사이 그날 주문을 따로 넣었다면 취소 저장이 그 주문을 지우지 않는다', async () => {
  const db = fakeDb({ '2026-10-14': holiday('2026-10-14') });
  const app = load(db);
  await app.loadMultiHolidayMonth('2026-10');
  app.toggleMultiHolidayDate('2026-10-14');
  // 다른 화면에서 그날 주문을 넣음
  db.store.set('2026-10-14', { uid: UID, lunchCount: 4, saladCount: 0 });
  await app.saveMultiSelfHolidays();
  assert.deepEqual(db.writes, []);
  assert.equal(db.store.get('2026-10-14').lunchCount, 4);
});

test('마감한 날짜의 휴무는 취소하지 않는다', async () => {
  const db = fakeDb({ '2026-10-14': holiday('2026-10-14') }, ['2026-10-14']);
  const app = load(db);
  await app.loadMultiHolidayMonth('2026-10');
  app.toggleMultiHolidayDate('2026-10-14');
  await app.saveMultiSelfHolidays();
  assert.deepEqual(db.writes, []);
  assert.match(app.errors.at(-1), /마감/);
});

test('31일 제한은 새로 추가하는 날짜에만 센다', async () => {
  // 저장된 휴무가 많아도 그것을 푸는 데는 제한이 걸리지 않는다.
  const app = load(fakeDb({}));
  vm.runInContext(`
    multiHolidaySavedDates = new Set(['2026-10-14']);
    multiHolidaySelectedDates = ['2026-10-14'];
  `, app);
  for (let i = 0; i < 31; i++) {
    const date = new Date(Date.UTC(2026, 10, 2 + i)).toISOString().slice(0, 10);
    vm.runInContext(`multiHolidaySelectedDates.push('${date}')`, app);
  }
  app.toggleMultiHolidayDate('2027-01-04');
  assert.match(app.errors.at(-1), /31일까지 새로 추가/);
  app.toggleMultiHolidayDate('2026-10-14');
  assert.deepEqual(app.changes().removed, ['2026-10-14']);
});

test('창을 닫았다 다시 열었으면 늦게 온 불러오기 결과를 버린다', async () => {
  const db = fakeDb({ '2026-10-14': holiday('2026-10-14') });
  const app = load(db);
  const pending = app.loadMultiHolidayMonth('2026-10');
  vm.runInContext('multiHolidayOpenToken += 1; multiHolidaySelectedDates = [];', app);
  await pending;
  assert.deepEqual(app.selected(), []);
});

test('하루짜리 자체 휴무 등록·해제 뒤에도 버튼이 다시 눌린다', async () => {
  // 성공할 때 버튼을 다시 켜지 않아, 한 번 쓰면 새로 고치기 전까지 '자체 휴무 해제'가 반응하지 않았다.
  const button = { disabled: false, textContent: '자체 휴무 해제' };
  const deleted = [];
  const context = {
    modalDateStr: '2026-10-16',
    currentOrderTargetDate: '2026-10-02',
    currentUser: { uid: UID },
    document: { getElementById: () => button },
    db: {
      collection: () => ({
        doc: date => ({
          collection: () => ({
            doc: () => ({ async delete() { deleted.push(date); }, async set() {} })
          })
        })
      })
    },
    firebase: { firestore: { FieldValue: { serverTimestamp: () => 'now' } } },
    showToast: () => {},
    closeModal: () => {},
    renderWeek: () => {},
    renderToday: () => {}
  };
  vm.createContext(context);
  vm.runInContext(extractFunction('submitSelfHoliday'), context);
  await context.submitSelfHoliday();
  assert.deepEqual(deleted, ['2026-10-16']);
  assert.equal(button.disabled, false);

  // 날짜 창을 열 때도 버튼을 켠다.
  assert.match(extractFunction('openDayModal'), /holidayBtn\.disabled = false/);
});
