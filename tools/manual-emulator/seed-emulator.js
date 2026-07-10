'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');

const root = path.resolve(__dirname, '..', '..');
const projectId = 'demo-gjsuragan-safety';
const credentialsPath = path.join(root, '.tmp', 'manual-emulator', 'credentials.json');
const requireFromFunctions = createRequire(path.join(root, 'functions', 'package.json'));
const { initializeApp, deleteApp } = requireFromFunctions('firebase-admin/app');
const { getAuth } = requireFromFunctions('firebase-admin/auth');
const { getFirestore, Timestamp } = requireFromFunctions('firebase-admin/firestore');

process.env.GCLOUD_PROJECT = projectId;
process.env.GOOGLE_CLOUD_PROJECT = projectId;
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';

function assertSafeEnvironment() {
  if (process.env.GCLOUD_PROJECT !== projectId || process.env.GOOGLE_CLOUD_PROJECT !== projectId) {
    throw new Error('Refusing to seed: demo project environment is not active.');
  }
  if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080') {
    throw new Error('Refusing to seed: Firestore Emulator host is missing.');
  }
  if (process.env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:9099') {
    throw new Error('Refusing to seed: Auth Emulator host is missing.');
  }
}

function kstDate(offset = 0) {
  const base = new Date(Date.now() + offset * 86400000);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(base).reduce((out, item) => {
    out[item.type] = item.value;
    return out;
  }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function kstDayOfWeek(dateString) {
  const [year, month, day] = dateString.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12)).getUTCDay();
}

function loadCredentials() {
  if (!fs.existsSync(credentialsPath)) throw new Error('Missing generated test credentials. Run start-preview.ps1.');
  const data = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
  if (!data.password || !data.accounts) throw new Error('Invalid generated test credentials.');
  return data;
}

async function clearEmulators() {
  const firestoreUrl = `http://127.0.0.1:8080/emulator/v1/projects/${projectId}/databases/(default)/documents`;
  const authUrl = `http://127.0.0.1:9099/emulator/v1/projects/${projectId}/accounts`;
  for (const [name, url] of [['Firestore', firestoreUrl], ['Auth', authUrl]]) {
    const response = await fetch(url, { method: 'DELETE' });
    if (!response.ok) throw new Error(`${name} Emulator reset failed: ${response.status} ${await response.text()}`);
  }
}

function publicUser({ businessName, email, phone, lunch = 2, salad = 0, createdAt, extra = {} }) {
  const weekdayMeals = Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri'].map(key => [key, { lunch, salad }]));
  return {
    businessName,
    email,
    phone,
    deliveryPlace: '진주시 테스트로 100',
    deliveryPlaceDetail: '테스트동 101호',
    mealTime: '11:40',
    defaultLunch: lunch,
    defaultSalad: salad,
    sameDailyMeal: true,
    sameDailyMealExplicit: true,
    weekdayMeals,
    privacyConsent: true,
    privacyConsentAt: createdAt,
    createdAt,
    updatedAt: createdAt,
    ...extra
  };
}

function deliveryCustomer(overrides = {}) {
  return {
    name: '에뮬레이터 배송 고객',
    phone: '01000000000',
    addr: '진주시 테스트로 101동 "공동현관" 앞',
    request: '문 앞 테스트 배송',
    memo: '수동검증 전용',
    productId: 'A',
    set: 'A',
    orderType: 'sub',
    remain: 2,
    total: 8,
    status: 'active',
    deliveredDates: [],
    startDate: kstDate(-7),
    cookDays: [kstDayOfWeek(kstDate())],
    arriveDays: [],
    isDirect: false,
    qty: 1,
    ...overrides
  };
}

async function main() {
  assertSafeEnvironment();
  const credentials = loadCredentials();
  await clearEmulators();

  const app = initializeApp({ projectId }, `manual-seed-${Date.now()}`);
  const auth = getAuth(app);
  const db = getFirestore(app);
  const now = Timestamp.now();
  const today = kstDate();
  const tomorrow = kstDate(1);
  const month = today.slice(0, 7);

  const accounts = [
    ['manual-admin', credentials.accounts.admin],
    ['manual-staff', credentials.accounts.staff],
    ['manual-customer', credentials.accounts.customer]
  ];
  for (const [uid, email] of accounts) {
    await auth.createUser({ uid, email, password: credentials.password, emailVerified: true, displayName: `Manual ${uid}` });
  }

  const users = {
    'manual-admin': {
      email: credentials.accounts.admin,
      role: 'admin',
      adminEvents: {},
      deliveryRecords: {},
      createdAt: now,
      updatedAt: now
    },
    'manual-customer': publicUser({
      businessName: '가격없음 월식 테스트',
      email: credentials.accounts.customer,
      phone: '01000001001',
      lunch: 2,
      salad: 1,
      createdAt: now
    }),
    'manual-price-9000': publicUser({
      businessName: '관리자가격 9000 테스트',
      email: 'price9000@example.invalid',
      phone: '01000001002',
      createdAt: now
    }),
    'manual-price-zero': publicUser({
      businessName: '명시적 0원 테스트',
      email: 'pricezero@example.invalid',
      phone: '01000001003',
      createdAt: now
    }),
    'manual-price-legacy': publicUser({
      businessName: '호환가격 필드 테스트',
      email: 'pricelegacy@example.invalid',
      phone: '01000001004',
      createdAt: now
    }),
    'manual-special-string': publicUser({
      businessName: '궁중회사 <테스트>',
      email: 'special@example.invalid',
      phone: '01000001005',
      lunch: 1,
      createdAt: now,
      extra: {
        deliveryPlace: '진주시 테스트로 101동 "공동현관" 앞',
        deliveryPlaceDetail: '김&이 고객 <img src=x onerror=alert(1)>'
      }
    })
  };

  const batch = db.batch();
  Object.entries(users).forEach(([uid, data]) => batch.set(db.collection('users').doc(uid), data));
  batch.set(db.collection('userPrivate').doc('manual-price-9000'), {
    lunchPrice: 9000, saladPrice: 9000, updatedAt: now
  });
  batch.set(db.collection('userPrivate').doc('manual-price-zero'), {
    lunchPrice: 0, saladPrice: 0, updatedAt: now
  });
  batch.set(db.collection('userPrivate').doc('manual-price-legacy'), {
    priceLunch: 7500, priceSalad: 7000, updatedAt: now
  });

  const orderUsers = ['manual-customer', 'manual-price-9000', 'manual-price-zero', 'manual-price-legacy', 'manual-special-string'];
  orderUsers.forEach((uid, index) => {
    batch.set(db.collection('orders').doc(today).collection('items').doc(uid), {
      uid,
      targetDate: today,
      lunchCount: index === 4 ? 1 : 2,
      saladCount: uid === 'manual-customer' ? 1 : 0,
      note: uid === 'manual-special-string' ? '김&이 고객 <img src=x onerror=alert(1)>' : 'Emulator 수동검증',
      selfHoliday: false,
      submittedAt: now,
      updatedAt: now
    });
  });
  batch.set(db.collection('orders').doc(tomorrow).collection('items').doc('manual-customer'), {
    uid: 'manual-customer', targetDate: tomorrow, lunchCount: 2, saladCount: 1,
    note: '다음날 Emulator 주문', selfHoliday: false, submittedAt: now, updatedAt: now
  });

  batch.set(db.collection('settlements').doc(month).collection('items').doc('manual-customer'), {
    uid: 'manual-customer', businessName: '가격없음 월식 테스트', month,
    lunch: 2, salad: 1, totalLunch: 2, totalSalad: 1,
    daily: { [today]: { lunch: 2, salad: 1, eventLunch: 0 } },
    status: '미정산', adjustment: 0, paidAmount: 0, updatedAt: now
  });

  batch.set(db.collection('config').doc('settings'), { closeHour: 9, closeMinute: 10, updatedAt: now });
  batch.set(db.collection('config').doc('holidays'), { custom: {}, updatedAt: now });
  batch.set(db.collection('mealMenus').doc(today), {
    date: today,
    lunchItems: ['테스트밥', '테스트국', '테스트반찬'],
    saladItems: ['테스트샐러드', '테스트드레싱'],
    createdAt: now,
    updatedAt: now
  });

  const deliveryDocs = {
    'delivery-regular': deliveryCustomer({ name: 'E 정기배송 테스트', isDirect: false }),
    'delivery-staff-once': deliveryCustomer({
      name: 'F 직원 선택주문 테스트', orderType: 'once', onceDate: today, isDirect: false
    }),
    'delivery-map-once': deliveryCustomer({
      name: 'G 지도 선택주문 테스트', orderType: 'once', onceDate: today, isDirect: true,
      addr: '진주시 지도테스트로 202'
    }),
    'delivery-cancel': deliveryCustomer({
      name: 'H 완료취소 테스트', remain: 1, isDirect: true, deliveredDates: [today],
      addr: '진주시 지도테스트로 203'
    }),
    'delivery-special': deliveryCustomer({
      name: '궁중회사 <테스트>', phone: '01000002005',
      addr: '진주시 테스트로 101동 "공동현관" 앞',
      request: '김&이 고객 <img src=x onerror=alert(1)>', isDirect: true
    })
  };
  Object.entries(deliveryDocs).forEach(([id, data]) => batch.set(db.collection('customers').doc(id), data));

  batch.set(db.collection('eventOrders').doc('manual-event-order'), {
    businessName: '행사도시락 테스트 업체',
    contactPhone: '01000003001',
    place: '진주시 테스트 행사장',
    placeDetail: '테스트홀',
    eventDate: today,
    eventTime: '11:30',
    eventTimeType: 'preset',
    menuText: '테스트 한상 도시락 10개',
    items: [{ category: '테스트', name: '테스트 한상 도시락', quantity: 10, price: 12300 }],
    requestNote: '알림 없는 Emulator 전용 주문',
    quoteRequested: false,
    quoteBudgetText: '',
    quoteMemo: '',
    quoteStatus: 'none',
    paymentCash: false,
    paymentTransfer: true,
    paymentCard: false,
    status: 'new',
    source: 'manual_emulator_seed',
    createdAt: now,
    privacyConsent: true,
    companyWebsite: ''
  });

  await batch.commit();
  await deleteApp(app);
  console.log(JSON.stringify({ projectId, today, tomorrow, month, users: Object.keys(users), deliveries: Object.keys(deliveryDocs) }, null, 2));
}

main().catch(error => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
