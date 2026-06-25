const admin = require('firebase-admin');
const { onDocumentCreated, onDocumentWritten } = require('firebase-functions/v2/firestore');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onRequest } = require('firebase-functions/v2/https');
const { logger } = require('firebase-functions');
const logenClient = require('./logenClient');
const { mapCustomerToLogenOrder, orderNumber } = require('./logenMapper');

admin.initializeApp();

const db = admin.firestore();
const TIMEZONE = 'Asia/Seoul';
const MAX_PENDING_PER_BATCH = 20;
const KAKAO_SESSION_TTL_MS = 6 * 60 * 60 * 1000;
const KAKAO_MAX_TEXT = 950;
const KAKAO_MAX_DELIVERY_ITEMS = 10;
const KAKAO_MAX_SEARCH_ITEMS = 6;
const KAKAO_MAX_TASK_ITEMS = 5;
const NAVER_DIRECTION_CANDIDATE_LIMIT = Number(process.env.NAVER_DIRECTION_CANDIDATE_LIMIT || 6);
const NAVER_DIRECTION_MAX_STOPS = Number(process.env.NAVER_DIRECTION_MAX_STOPS || 25);
const ADMIN_URL = 'https://djmonnar.github.io/gjsuragan/admin.html#changeRequests';
const ORDER_ADMIN_URL = 'https://djmonnar.github.io/gjsuragan/admin.html';
const EVENT_ORDER_ADMIN_URL = 'https://djmonnar.github.io/gjsuragan/admin.html#eventOrders';

exports.onChangeRequestCreated = onDocumentCreated('changeRequests/{requestId}', async (event) => {
  const snap = event.data;
  if (!snap) return;
  const requestId = event.params.requestId;
  const request = snap.data() || {};
  await sendSingleRequestNotification(requestId, request, { urgent: request.urgent === true });
});

exports.onCustomerOrderWritten = onDocumentWritten('orders/{date}/items/{userId}', async (event) => {
  const after = event.data?.after;
  if (!after?.exists) return;

  const order = after.data() || {};
  const before = event.data?.before?.exists ? (event.data.before.data() || {}) : null;
  if (before && sameOrderForNotification(before, order)) return;

  await sendOrderNotification(event.params.date, event.params.userId, order, Boolean(before));
});

exports.onEventOrderCreated = onDocumentCreated('eventOrders/{orderId}', async (event) => {
  const snap = event.data;
  if (!snap) return;
  const order = snap.data() || {};
  const orderId = event.params.orderId;

  const businessName = order.businessName || '고객';
  const eventDate = order.eventDate || '';
  const menuText = order.menuText ? order.menuText.slice(0, 40) : '';
  const title = '궁중수라간 행사도시락 견적 요청';
  const body = `${businessName}님 ${eventDate} 행사: ${menuText}`;

  await sendPushToAdmins({
    title,
    body,
    data: {
      requestId: orderId,
      type: 'event_order',
      customerName: String(businessName),
      orderDate: String(eventDate),
      url: EVENT_ORDER_ADMIN_URL
    },
    url: EVENT_ORDER_ADMIN_URL,
    tag: `event-order-${orderId}`
  });
  logger.info('Event order push sent', { orderId, businessName, eventDate });
});

exports.onAdminPushTestCreated = onDocumentCreated('adminPushTests/{testId}', async (event) => {
  const snap = event.data;
  if (!snap) return;
  const test = snap.data() || {};
  const token = String(test.token || '');
  if (!token) {
    await snap.ref.set({
      status: 'failed',
      errorCode: 'missing-token',
      errorMessage: 'No FCM token provided',
      handledAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    return;
  }
  try {
    const messageId = await admin.messaging().send({
      token,
      notification: {
        title: '궁중수라간 서버 푸시 테스트',
        body: '이 알림이 보이면 서버 FCM 경로도 정상입니다.'
      },
      data: {
        type: 'server_push_test',
        url: ADMIN_URL
      },
      webpush: {
        fcmOptions: {
          link: ADMIN_URL
        },
        notification: {
          title: '궁중수라간 서버 푸시 테스트',
          body: '이 알림이 보이면 서버 FCM 경로도 정상입니다.',
          icon: '/gjsuragan/icons/icon.svg',
          badge: '/gjsuragan/icons/icon.svg',
          tag: `admin-push-test-${event.params.testId}`,
          renotify: true
        }
      }
    });
    await snap.ref.set({
      status: 'sent',
      messageId,
      handledAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    logger.info('Admin push test sent', { testId: event.params.testId });
  } catch (error) {
    await snap.ref.set({
      status: 'failed',
      errorCode: error.code || '',
      errorMessage: error.message || '',
      handledAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    logger.warn('Admin push test failed', event.params.testId, error.code, error.message);
  }
});

exports.flushPendingChangeRequestNotifications = onSchedule({
  schedule: 'every 15 minutes',
  timeZone: TIMEZONE
}, async () => {
  const now = new Date();
  const snap = await db.collection('changeRequests')
    .where('notificationStatus', '==', 'pending')
    .where('notifyAfterAt', '<=', admin.firestore.Timestamp.fromDate(now))
    .orderBy('notifyAfterAt')
    .limit(MAX_PENDING_PER_BATCH)
    .get();

  if (snap.empty) return;
  const requests = snap.docs.map(doc => ({ id: doc.id, ref: doc.ref, data: doc.data() || {} }));
  const urgent = requests.filter(item => item.data.urgent === true);
  const normal = requests.filter(item => item.data.urgent !== true);

  for (const item of urgent) {
    await sendSingleRequestNotification(item.id, item.data, {});
  }

  if (normal.length) {
    await sendGroupedNotification(normal);
  }
});

exports.api = onRequest({
  region: 'asia-northeast3',
  invoker: 'public',
  vpcConnector: 'projects/gjsuragan-60505/locations/asia-northeast3/connectors/gjsuragan-seoul-connector',
  vpcConnectorEgressSettings: 'ALL_TRAFFIC'
}, async (req, res) => {
  setCorsHeaders(res);
  const pathname = new URL(req.url, 'https://gjsuragan.local').pathname;

  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }
  if (isKakaoWebhookPath(pathname)) {
    await handleKakaoWebhookRequest(req, res);
    return;
  }
  if (req.method !== 'POST') {
    sendJson(res, 405, { ok: false, error: 'Method not allowed' });
    return;
  }

  try {
    const user = pathname === '/api/route/optimize' || pathname === '/route/optimize'
      ? await verifyRouteRequest(req)
      : await verifyAdminRequest(req);
    if (pathname === '/api/logen/register-orders' || pathname === '/logen/register-orders') {
      const result = await handleLogenRegister(req.body || {}, user);
      sendJson(res, 200, { ok: true, ...result });
      return;
    }
    if (pathname === '/api/logen/inquiry-slip-nos' || pathname === '/logen/inquiry-slip-nos') {
      const result = await handleLogenSlipInquiry(req.body || {}, user);
      sendJson(res, 200, { ok: true, ...result });
      return;
    }
    if (pathname === '/api/route/optimize' || pathname === '/route/optimize') {
      const result = await handleRouteOptimize(req.body || {}, user);
      sendJson(res, 200, { ok: true, ...result });
      return;
    }
    sendJson(res, 404, { ok: false, error: 'Not found' });
  } catch (error) {
    logger.warn('API request failed', { path: pathname, error: error.message });
    sendJson(res, error.status || 500, { ok: false, error: error.message || 'Internal error' });
  }
});


function setCorsHeaders(res) {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
}

function sendJson(res, status, body) {
  res.status(status).json(body);
}

function isKakaoWebhookPath(pathname) {
  return pathname === '/api/kakao/webhook' || pathname === '/kakao/webhook';
}

async function handleKakaoWebhookRequest(req, res) {
  if (req.method === 'GET') {
    res.status(200).type('text/plain').send('GJSURAGAN Kakao webhook OK');
    return;
  }
  if (req.method !== 'POST') {
    sendKakaoResponse(res, '지원하지 않는 요청 방식입니다.');
    return;
  }

  try {
    const payload = req.body && typeof req.body === 'object' ? req.body : {};
    const utterance = kakaoUtterance(payload);

    const cmd = kakaoResolveCommand(payload, utterance);
    const customers = await kakaoFetchCustomers();
    if (cmd.type === 'tasks') {
      sendKakaoResponse(res, await kakaoBuildTodayTasksText(customers));
      return;
    }
    if (cmd.type === 'summary') {
      sendKakaoResponse(res, kakaoBuildSummaryText(customers));
      return;
    }
    if (cmd.type === 'customer') {
      sendKakaoResponse(res, kakaoBuildCustomerSearchText(customers, cmd.keyword));
      return;
    }
    sendKakaoResponse(res, kakaoBuildDeliveryText(customers, cmd.date, cmd.label));
  } catch (error) {
    logger.warn('Kakao webhook failed', { error: error.message });
    sendKakaoResponse(res, [
      '조회 중 오류가 발생했습니다.',
      'Functions 로그와 환경변수를 확인해주세요.',
      '',
      '오류: ' + (error.message || String(error))
    ].join('\n'));
  }
}

function sendKakaoResponse(res, text) {
  res.status(200).json(kakaoTextResponse(text));
}

function kakaoTextResponse(text) {
  return {
    version: '2.0',
    template: {
      outputs: [
        {
          simpleText: {
            text: kakaoTrimText(text)
          }
        }
      ],
      quickReplies: [
        { label: '오늘할일', action: 'message', messageText: '오늘할일' },
        { label: '오늘배송', action: 'message', messageText: '오늘배송' },
        { label: '내일배송', action: 'message', messageText: '내일배송' },
        { label: '모레배송', action: 'message', messageText: '모레배송' },
        { label: '요약', action: 'message', messageText: '요약' },
        { label: '고객검색', action: 'message', messageText: '고객검색 ' }
      ]
    }
  };
}

function kakaoTrimText(text) {
  const s = String(text || '');
  if (s.length <= KAKAO_MAX_TEXT) return s;
  return s.slice(0, KAKAO_MAX_TEXT - 24) + '\n...\n일부만 표시했습니다.';
}

function kakaoUtterance(payload) {
  return String(payload?.userRequest?.utterance || '').trim();
}

function kakaoActionParams(payload) {
  return payload?.action?.params || {};
}

function kakaoUserKey(payload) {
  const user = payload?.userRequest?.user || {};
  const props = user.properties || {};
  return String(user.id || props.appUserId || props.plusfriendUserKey || props.botUserKey || 'anonymous');
}

function kakaoAllowedUsers() {
  return String(process.env.KAKAO_ALLOWED_USERS || '')
    .split(',')
    .map(v => v.trim())
    .filter(Boolean);
}

async function kakaoCheckAuth(payload, utterance) {
  const userKey = kakaoUserKey(payload);
  const allowed = kakaoAllowedUsers();
  if (allowed.length && !allowed.includes(userKey)) {
    return { ok: false, reason: 'not_allowed', userKey };
  }

  const expected = String(process.env.KAKAO_ADMIN_PIN || '').trim();
  if (!expected) return { ok: false, reason: 'pin_missing' };

  const sessionId = Buffer.from(userKey).toString('base64url').slice(0, 120) || 'anonymous';
  const sessionRef = db.collection('kakaoBotSessions').doc(sessionId);
  const session = await sessionRef.get().catch(() => null);
  const expiresAt = session?.exists ? session.data()?.expiresAt?.toMillis?.() : 0;
  if (expiresAt && expiresAt > Date.now()) return { ok: true, justAuthed: false };

  const params = kakaoActionParams(payload);
  let given = String(params.pin || params.adminPin || '').trim();
  if (!given) {
    const match = String(utterance || '').match(/(?:인증|핀|pin)\s*[:：]?\s*([^\s]+)/i);
    given = match ? String(match[1]).trim() : '';
  }

  if (given && given === expected) {
    await sessionRef.set({
      userKey,
      authedAt: admin.firestore.FieldValue.serverTimestamp(),
      expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + KAKAO_SESSION_TTL_MS)
    }, { merge: true });
    return { ok: true, justAuthed: true };
  }

  return { ok: false, reason: 'need_auth' };
}

function kakaoAuthMessage(auth) {
  if (auth.reason === 'not_allowed') {
    return '허용된 관리자 카카오 계정이 아닙니다.\n\n' +
      'Functions 환경변수 KAKAO_ALLOWED_USERS에 현재 user id를 등록해야 합니다.\n' +
      '현재 user id: ' + (auth.userKey || '-');
  }

  if (auth.reason === 'pin_missing') {
    return '카카오 챗봇 보안 설정이 아직 없습니다.\n\n' +
      'Functions 환경변수 KAKAO_ADMIN_PIN을 먼저 등록해주세요.\n' +
      '고객명, 전화번호, 주소가 포함되므로 인증 없이 조회할 수 없습니다.';
  }

  return '관리자 인증이 필요합니다.\n\n' +
    '챗봇에 "인증 관리자PIN" 형식으로 입력한 뒤 다시 조회해주세요.\n' +
    '예: 인증 1234';
}

function kakaoResolveCommand(payload, utterance) {
  const params = kakaoActionParams(payload);
  const mode = String(params.mode || '').trim();
  const keyword = String(params.keyword || params.name || params.phone || '').trim();
  const dateParam = String(params.date || '').trim();
  const commandText = `${mode} ${utterance}`;

  if (/오늘\s*할\s*일|할일|업무|체크|todo|tasks?/i.test(commandText)) {
    return { type: 'tasks' };
  }
  if (/요약|현황|summary/i.test(commandText)) {
    return { type: 'summary' };
  }
  if (/고객|검색|정보/.test(commandText) || keyword) {
    return { type: 'customer', keyword: keyword || kakaoExtractKeyword(utterance) };
  }

  const today = kakaoToday();
  const parsedDate = kakaoParseDateText(dateParam || utterance, today);
  if (parsedDate) return { type: 'delivery', date: parsedDate, label: kakaoDateLabel(parsedDate) };
  if (/모레/.test(commandText)) {
    const date = kakaoAddDays(today, 2);
    return { type: 'delivery', date, label: '모레 배송' };
  }
  if (/내일|tomorrow/i.test(commandText)) {
    const date = kakaoAddDays(today, 1);
    return { type: 'delivery', date, label: '내일 배송' };
  }
  return { type: 'delivery', date: today, label: '오늘 배송' };
}

function kakaoExtractKeyword(utterance) {
  return String(utterance || '')
    .replace(/고객검색|고객정보|고객|검색|정보/g, '')
    .replace(/^[:：\-\s]+/, '')
    .trim();
}

function kakaoToday() {
  return kstDateString(new Date());
}

function kstDateString(date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date).reduce((out, part) => {
    out[part.type] = part.value;
    return out;
  }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function kakaoAddDays(dateStr, offset) {
  const [year, month, day] = String(dateStr).split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + offset, 12, 0, 0));
  return kstDateString(date);
}

function kakaoDow(dateStr) {
  const [year, month, day] = String(dateStr).split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0)).getUTCDay();
}

function kakaoDateLabel(dateStr) {
  const days = ['일', '월', '화', '수', '목', '금', '토'];
  const [, month, day] = String(dateStr).split('-').map(Number);
  return `${month}/${day}(${days[kakaoDow(dateStr)]}) 배송`;
}

function kakaoParseDateText(text, today) {
  const s = String(text || '').trim();
  if (!s) return '';
  let match = s.match(/(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (match) return kakaoBuildDate(Number(match[1]), Number(match[2]), Number(match[3]));
  match = s.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/) || s.match(/(?:^|\s)(\d{1,2})[/.](\d{1,2})(?:\s|$)/);
  if (match) return kakaoBuildDate(Number(today.slice(0, 4)), Number(match[1]), Number(match[2]));
  return '';
}

function kakaoBuildDate(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return '';
  return kstDateString(date);
}

async function kakaoFetchCustomers() {
  const snap = await db.collection('customers').limit(1000).get();
  return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

async function kakaoFetchCollectionSafe(collectionId, limit = 100) {
  try {
    const snap = await db.collection(collectionId).limit(limit).get();
    return { ok: true, items: snap.docs.map(doc => ({ id: doc.id, ...doc.data() })) };
  } catch (error) {
    return { ok: false, items: [], error: error.message };
  }
}

async function kakaoFetchDocSafe(documentPath) {
  try {
    const snap = await db.doc(documentPath).get();
    return { ok: true, item: snap.exists ? { id: snap.id, ...snap.data() } : null };
  } catch (error) {
    return { ok: false, item: null, error: error.message };
  }
}

function kakaoWasDeliveredOn(c, dateStr) {
  return Array.isArray(c.deliveredDates) && c.deliveredDates.includes(dateStr);
}

function kakaoIsDeliverySub(c, dateStr) {
  if (c.orderType !== 'sub') return false;
  if (kakaoWasDeliveredOn(c, dateStr)) return true;
  if (c.status !== 'active' || Number(c.remain || 0) <= 0) return false;
  if (c.startDate && dateStr < c.startDate) return false;
  const dow = kakaoDow(dateStr);
  if (Array.isArray(c.cookDays) && c.cookDays.length > 0) return c.cookDays.includes(dow);
  const arriveDays = Array.isArray(c.arriveDays) ? c.arriveDays : [];
  return arriveDays.map(day => day === 0 ? 6 : day - 1).includes(dow);
}

function kakaoIsDeliveryOnce(c, dateStr) {
  if (c.orderType !== 'once') return false;
  if (kakaoWasDeliveredOn(c, dateStr)) return true;
  if (c.status !== 'active' || Number(c.remain || 0) <= 0) return false;
  if (c.startDate && dateStr < c.startDate) return false;
  return c.onceDate === dateStr;
}

function kakaoIsDelivery(c, dateStr) {
  return kakaoIsDeliverySub(c, dateStr) || kakaoIsDeliveryOnce(c, dateStr);
}

function kakaoListFor(customers, dateStr) {
  return (customers || []).filter(customer => kakaoIsDelivery(customer, dateStr));
}

function kakaoProductLabel(id) {
  return {
    A: 'A세트',
    B: 'B세트',
    C: 'C세트',
    pork_rib: '수제 양념돼지갈비',
    beef_la: '양념 LA갈비',
    beef_soup: '소고기무국'
  }[id] || id || '-';
}

function kakaoQtyText(c) {
  if (c.orderType === 'once') {
    return '수량 ' + Math.max(1, Number(c.qty || c.total || 1)) + '개';
  }
  return '잔여 ' + Number(c.remain || 0) + '회';
}

function kakaoShort(text, max) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function kakaoBuildDeliveryText(customers, dateStr, label) {
  const list = kakaoListFor(customers, dateStr);
  const direct = list.filter(c => !!c.isDirect);
  const courier = list.filter(c => !c.isDirect);
  const lines = [
    '궁중수라간 ' + (label || kakaoDateLabel(dateStr)),
    '조회 날짜: ' + dateStr,
    `총 배송 ${list.length}건 / 직배송 ${direct.length}건 / 택배 ${courier.length}건`
  ];

  if (!list.length) {
    lines.push('', '조회된 배송 예정이 없습니다.');
    return lines.join('\n');
  }

  lines.push('', '[직배송]');
  kakaoAppendDeliveryLines(lines, direct, dateStr);
  lines.push('', '[택배]');
  kakaoAppendDeliveryLines(lines, courier, dateStr);

  if (list.length > KAKAO_MAX_DELIVERY_ITEMS) {
    lines.push('', `외 ${list.length - KAKAO_MAX_DELIVERY_ITEMS}건은 관리자 페이지에서 확인하세요.`, ORDER_ADMIN_URL);
  }
  return lines.join('\n');
}

function kakaoAppendDeliveryLines(lines, list, dateStr) {
  if (!list.length) {
    lines.push('- 없음');
    return;
  }
  const remainSlots = Math.max(0, KAKAO_MAX_DELIVERY_ITEMS - kakaoCountItemLines(lines));
  list.slice(0, remainSlots).forEach(c => {
    const product = kakaoProductLabel(c.productId || c.set);
    const done = kakaoWasDeliveredOn(c, dateStr) ? '완료' : '대기';
    lines.push(
      `- ${c.name || '이름없음'} / ${product} / ${kakaoQtyText(c)} / ${done}\n` +
      `  전화: ${kakaoShort(c.phone || '-', 24)}\n` +
      `  주소: ${kakaoShort(c.addr || '-', 34)}\n` +
      `  요청: ${kakaoShort(c.request || '', 28) || '-'}`
    );
  });
  if (list.length > remainSlots) lines.push(`- 외 ${list.length - remainSlots}건`);
}

function kakaoCountItemLines(lines) {
  return lines.filter(line => /^- /.test(line)).length;
}

function kakaoBuildCustomerSearchText(customers, keyword) {
  const kw = String(keyword || '').trim();
  if (!kw) {
    return '고객검색은 이름 또는 전화번호 일부를 같이 입력해주세요.\n\n예: 고객검색 홍길동\n예: 고객검색 0101234';
  }
  const needle = kakaoNorm(kw);
  const needleDigits = kakaoDigits(kw);
  const matches = (customers || []).filter(c => {
    const values = [c.name, c.phone, c.addr, c.orderNum, c.memo, c.request, c.scheduleName];
    const hay = values.map(kakaoNorm).join(' ');
    const hayDigits = values.map(kakaoDigits).join('');
    return hay.includes(needle) || (!!needleDigits && hayDigits.includes(needleDigits));
  });
  const lines = [`고객검색: ${kw}`, `총 ${matches.length}건`];
  if (!matches.length) {
    lines.push('', '검색 결과가 없습니다. 이름, 전화번호, 주문번호 일부로 다시 조회해주세요.');
    return lines.join('\n');
  }
  lines.push('');
  matches.slice(0, KAKAO_MAX_SEARCH_ITEMS).forEach((c, idx) => {
    const product = kakaoProductLabel(c.productId || c.set);
    const schedule = c.orderType === 'once' ? (c.onceDate || '-') : (c.scheduleName || '-');
    const memo = kakaoShort(c.memo || '', 28);
    const request = kakaoShort(c.request || '', 28);
    lines.push(
      `${idx + 1}. ${c.name || '이름없음'} / ${product} / ${c.status || '-'}\n` +
      `  전화: ${c.phone || '-'}\n` +
      `  주소: ${kakaoShort(c.addr || '-', 34)}\n` +
      `  주문번호: ${c.orderNum || '-'}\n` +
      `  일정: ${kakaoShort(schedule, 34)}` +
      (memo ? `\n  메모: ${memo}` : '') +
      (request ? `\n  요청: ${request}` : '')
    );
  });
  if (matches.length > KAKAO_MAX_SEARCH_ITEMS) {
    lines.push('', `외 ${matches.length - KAKAO_MAX_SEARCH_ITEMS}건은 관리자 페이지에서 확인하세요.`, ORDER_ADMIN_URL);
  }
  return lines.join('\n');
}

function kakaoBuildSummaryText(customers) {
  const today = kakaoToday();
  const tomorrow = kakaoAddDays(today, 1);
  const afterTomorrow = kakaoAddDays(today, 2);
  const todayList = kakaoListFor(customers, today);
  const tomorrowList = kakaoListFor(customers, tomorrow);
  const afterTomorrowList = kakaoListFor(customers, afterTomorrow);
  const activeSubs = customers.filter(c => c.orderType === 'sub' && c.status === 'active').length;
  const activeOnce = customers.filter(c => c.orderType === 'once' && c.status === 'active').length;
  const needsReview = customers.filter(c => !!c.needsReview).length;
  return [
    '궁중수라간 배송 요약',
    new Intl.DateTimeFormat('ko-KR', { timeZone: TIMEZONE, dateStyle: 'medium', timeStyle: 'short' }).format(new Date()) + ' 기준',
    '',
    `오늘 배송: ${todayList.length}건`,
    `내일 배송: ${tomorrowList.length}건`,
    `모레 배송: ${afterTomorrowList.length}건`,
    `활성 정기배송: ${activeSubs}건`,
    `활성 선택주문: ${activeOnce}건`,
    `확인 필요: ${needsReview}건`,
    '',
    '명령어: 오늘할일 / 오늘배송 / 내일배송 / 모레배송 / 고객검색 이름'
  ].join('\n');
}

function kakaoLogenShipment(c, dateStr) {
  return c?.logenShipments?.[dateStr] || {};
}

function kakaoLogenStatus(c, dateStr) {
  return kakaoLogenShipment(c, dateStr).status || 'logen_ready';
}

function kakaoLogenNeedsChange(c, dateStr) {
  const shipment = kakaoLogenShipment(c, dateStr);
  const status = kakaoLogenStatus(c, dateStr);
  return ['logen_registered', 'slip_pending', 'slip_ready', 'printed'].includes(status) && shipment.changeNeeded === true;
}

function kakaoEventDate(item) {
  return String(item.eventDate || item.date || '').slice(0, 10);
}

function kakaoIsOpenEventOrder(item) {
  const status = String(item.status || '').toLowerCase();
  return !['registered', 'deleted', 'done', 'cancelled', 'canceled'].includes(status);
}

async function kakaoBuildTodayTasksText(customers) {
  const today = kakaoToday();
  const tomorrow = kakaoAddDays(today, 1);
  const todayList = kakaoListFor(customers, today);
  const direct = todayList.filter(c => !!c.isDirect);
  const courier = todayList.filter(c => !c.isDirect);
  const notDone = todayList.filter(c => !kakaoWasDeliveredOn(c, today));
  const needsReview = (customers || []).filter(c => !!c.needsReview);
  const courierFailed = courier.filter(c => kakaoLogenStatus(c, today) === 'logen_failed');
  const courierSlipWait = courier.filter(c => {
    const status = kakaoLogenStatus(c, today);
    const shipment = kakaoLogenShipment(c, today);
    return ['logen_registered', 'slip_pending'].includes(status) && !(shipment.slipNo || shipment.invoiceNo);
  });
  const courierChange = courier.filter(c => kakaoLogenNeedsChange(c, today));
  const changeReq = await kakaoFetchCollectionSafe('changeRequests', 100);
  const eventOrders = await kakaoFetchCollectionSafe('eventOrders', 100);
  const todayMenu = await kakaoFetchDocSafe(`mealMenus/${today}`);
  const tomorrowMenu = await kakaoFetchDocSafe(`mealMenus/${tomorrow}`);
  const newReq = changeReq.items.filter(item => String(item.status || 'new') === 'new');
  const checkingReq = changeReq.items.filter(item => String(item.status || '') === 'checking');
  const openEvents = eventOrders.items.filter(kakaoIsOpenEventOrder);
  const todayEvents = openEvents.filter(item => {
    const date = kakaoEventDate(item);
    return !date || date <= today;
  });
  const warnings = [];
  if (!changeReq.ok) warnings.push('변경요청 조회 실패');
  if (!eventOrders.ok) warnings.push('행사도시락 조회 실패');
  if (!todayMenu.ok || !tomorrowMenu.ok) warnings.push('식단 조회 일부 실패');

  const lines = [
    '[궁중수라간 오늘 할 일]',
    new Intl.DateTimeFormat('ko-KR', { timeZone: TIMEZONE, dateStyle: 'medium', timeStyle: 'short' }).format(new Date()) + ' 기준',
    '',
    `오늘 배송: ${todayList.length}건`,
    `- 직배송 ${direct.length}건 / 택배 ${courier.length}건`,
    `- 미완료 ${notDone.length}건`,
    '',
    `확인 필요 주문: ${needsReview.length}건`,
    `로젠: 전송실패 ${courierFailed.length}건 / 송장대기 ${courierSlipWait.length}건 / 변경필요 ${courierChange.length}건`,
    `고객 문의/변경요청: 신규 ${newReq.length}건 / 확인중 ${checkingReq.length}건`,
    `행사도시락 미처리: ${todayEvents.length}건`,
    `식단: 오늘 ${todayMenu.item ? '등록' : '미등록'} / 내일 ${tomorrowMenu.item ? '등록' : '미등록'}`
  ];

  if (needsReview.length || courierFailed.length || courierSlipWait.length || courierChange.length || newReq.length || todayEvents.length || !todayMenu.item || !tomorrowMenu.item) {
    lines.push('', '[먼저 볼 것]');
    kakaoAppendTaskNames(lines, '확인필요', needsReview);
    kakaoAppendTaskNames(lines, '로젠실패', courierFailed);
    kakaoAppendTaskNames(lines, '송장대기', courierSlipWait);
    kakaoAppendTaskNames(lines, '로젠변경', courierChange);
    kakaoAppendTaskNames(lines, '신규문의', newReq, 'customerName');
    kakaoAppendTaskNames(lines, '행사', todayEvents, 'businessName');
  } else {
    lines.push('', '크게 걸리는 항목은 없습니다.');
  }
  if (warnings.length) lines.push('', '주의: ' + warnings.join(', '));
  lines.push('', '명령어: 오늘배송 / 고객검색 이름 / 요약');
  return lines.join('\n');
}

function kakaoAppendTaskNames(lines, label, items, nameField) {
  if (!items?.length) return;
  const names = items.slice(0, KAKAO_MAX_TASK_ITEMS).map(item => {
    return kakaoShort(item[nameField || 'name'] || item.customerName || item.businessName || item.phone || item.id || '-', 12);
  });
  lines.push(`- ${label}: ${names.join(', ')}${items.length > KAKAO_MAX_TASK_ITEMS ? ` 외 ${items.length - KAKAO_MAX_TASK_ITEMS}건` : ''}`);
}

function kakaoNorm(value) {
  return String(value || '').replace(/[\s\-().]/g, '').toLowerCase();
}

function kakaoDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

async function verifyAdminRequest(req) {
  const auth = String(req.headers.authorization || '');
  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    const error = new Error('Missing Firebase ID token');
    error.status = 401;
    throw error;
  }
  const decoded = await admin.auth().verifyIdToken(match[1]);
  const allowed = String(process.env.LOGEN_ADMIN_EMAILS || 'sun1562@naver.com')
    .split(',')
    .map(v => v.trim().toLowerCase())
    .filter(Boolean);
  const email = String(decoded.email || '').toLowerCase();
  if (!email || !allowed.includes(email)) {
    const error = new Error('Admin permission required');
    error.status = 403;
    throw error;
  }
  return decoded;
}

async function verifyRouteRequest(req) {
  const auth = String(req.headers.authorization || '');
  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    const error = new Error('Missing Firebase ID token');
    error.status = 401;
    throw error;
  }
  const decoded = await admin.auth().verifyIdToken(match[1]);
  const email = String(decoded.email || '').toLowerCase();
  const provider = decoded.firebase?.sign_in_provider || '';
  const allowedAdmins = String(process.env.LOGEN_ADMIN_EMAILS || 'sun1562@naver.com')
    .split(',')
    .map(v => v.trim().toLowerCase())
    .filter(Boolean);
  if (provider === 'anonymous' || (email && allowedAdmins.includes(email))) {
    return decoded;
  }
  const error = new Error('Route permission required');
  error.status = 403;
  throw error;
}

function readNaverDirectionKeys() {
  const keyId = process.env.NAVER_DIRECTIONS_KEY_ID
    || process.env.NAVER_MAPS_API_KEY_ID
    || process.env.NCP_MAPS_API_KEY_ID
    || '';
  const key = process.env.NAVER_DIRECTIONS_KEY
    || process.env.NAVER_MAPS_API_KEY
    || process.env.NCP_MAPS_API_KEY
    || '';
  if (!keyId || !key) {
    const error = new Error('Naver Directions API keys are not configured');
    error.status = 503;
    throw error;
  }
  return { keyId, key };
}

function validRoutePoint(point) {
  const lat = Number(point?.lat);
  const lng = Number(point?.lng);
  return Number.isFinite(lat)
    && Number.isFinite(lng)
    && lat >= 32 && lat <= 39
    && lng >= 124 && lng <= 132;
}

function normalizeRoutePoint(point) {
  return {
    id: String(point.id || '').slice(0, 120),
    name: String(point.name || '').slice(0, 120),
    lat: Number(point.lat),
    lng: Number(point.lng)
  };
}

function validateRouteOptimizePayload(body) {
  const origin = normalizeRoutePoint(body.origin || {});
  const stops = Array.isArray(body.stops) ? body.stops.map(normalizeRoutePoint) : [];
  if (!validRoutePoint(origin)) {
    const error = new Error('origin must include valid lat/lng');
    error.status = 400;
    throw error;
  }
  const validStops = stops.filter(stop => stop.id && validRoutePoint(stop));
  if (validStops.length < 2) {
    const error = new Error('At least two stops are required');
    error.status = 400;
    throw error;
  }
  if (validStops.length > NAVER_DIRECTION_MAX_STOPS) {
    const error = new Error(`Too many stops. Max ${NAVER_DIRECTION_MAX_STOPS}`);
    error.status = 400;
    throw error;
  }
  return { origin, stops: validStops };
}

function distanceKm(a, b) {
  const rad = Math.PI / 180;
  const lat1 = Number(a.lat) * rad;
  const lat2 = Number(b.lat) * rad;
  const dLat = (Number(b.lat) - Number(a.lat)) * rad;
  const dLng = (Number(b.lng) - Number(a.lng)) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function naverPoint(point) {
  return `${Number(point.lng).toFixed(7)},${Number(point.lat).toFixed(7)}`;
}

async function fetchNaverDrivingLeg(start, goal, keys, cache) {
  const cacheKey = `${naverPoint(start)}>${naverPoint(goal)}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey);
  const url = new URL('https://maps.apigw.ntruss.com/map-direction/v1/driving');
  url.searchParams.set('start', naverPoint(start));
  url.searchParams.set('goal', naverPoint(goal));
  url.searchParams.set('option', 'trafast');
  const response = await fetch(url, {
    headers: {
      'X-NCP-APIGW-API-KEY-ID': keys.keyId,
      'X-NCP-APIGW-API-KEY': keys.key
    }
  });
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch(e) {
    data = {};
  }
  if (!response.ok || data.code !== 0) {
    const message = data.message || text || `Naver Directions HTTP ${response.status}`;
    const error = new Error(message);
    error.status = response.status || 502;
    throw error;
  }
  const summary = data.route?.trafast?.[0]?.summary || {};
  const leg = {
    distance: Number(summary.distance || 0),
    duration: Number(summary.duration || 0),
    tollFare: Number(summary.tollFare || 0),
    fuelPrice: Number(summary.fuelPrice || 0)
  };
  cache.set(cacheKey, leg);
  return leg;
}

async function handleRouteOptimize(body) {
  const { origin, stops } = validateRouteOptimizePayload(body);
  const keys = readNaverDirectionKeys();
  const cache = new Map();
  const remaining = [...stops];
  const ordered = [];
  const legs = [];
  let current = origin;

  while (remaining.length) {
    const candidates = [...remaining]
      .sort((a, b) => distanceKm(current, a) - distanceKm(current, b))
      .slice(0, Math.max(1, NAVER_DIRECTION_CANDIDATE_LIMIT));
    const scored = [];
    for (const candidate of candidates) {
      const leg = await fetchNaverDrivingLeg(current, candidate, keys, cache);
      scored.push({ candidate, leg });
    }
    scored.sort((a, b) => {
      if (a.leg.duration !== b.leg.duration) return a.leg.duration - b.leg.duration;
      return a.leg.distance - b.leg.distance;
    });
    const best = scored[0];
    ordered.push(best.candidate);
    legs.push({
      fromId: current.id || 'origin',
      toId: best.candidate.id,
      distance: best.leg.distance,
      duration: best.leg.duration
    });
    const idx = remaining.findIndex(stop => stop.id === best.candidate.id);
    if (idx >= 0) remaining.splice(idx, 1);
    current = best.candidate;
  }

  const totalDistance = legs.reduce((sum, leg) => sum + Number(leg.distance || 0), 0);
  const totalDuration = legs.reduce((sum, leg) => sum + Number(leg.duration || 0), 0);
  return {
    provider: 'naver-directions5',
    algorithm: 'nearest-driving-duration',
    candidateLimit: NAVER_DIRECTION_CANDIDATE_LIMIT,
    order: ordered.map(stop => stop.id),
    stops: ordered,
    legs,
    totalDistance,
    totalDuration
  };
}

function validateLogenPayload(body) {
  const shipDate = String(body.shipDate || '').trim();
  const customerIds = Array.isArray(body.customerIds)
    ? body.customerIds.map(id => String(id || '').trim()).filter(Boolean)
    : [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(shipDate)) {
    const error = new Error('shipDate must be YYYY-MM-DD');
    error.status = 400;
    throw error;
  }
  if (!customerIds.length) {
    const error = new Error('customerIds is required');
    error.status = 400;
    throw error;
  }
  return { shipDate, customerIds: [...new Set(customerIds)].slice(0, 100), mode: String(body.mode || '') };
}

async function loadCustomerDocs(customerIds) {
  const docs = await Promise.all(customerIds.map(id => db.collection('customers').doc(id).get()));
  return docs
    .filter(doc => doc.exists)
    .map(doc => ({ id: doc.id, ref: doc.ref, data: { id: doc.id, ...doc.data() } }));
}

function shipmentFor(customer, shipDate) {
  return (customer.logenShipments && customer.logenShipments[shipDate]) || {};
}

function logenOrderSnapshot(order) {
  return {
    orderNum: String(order.orderNum || ''),
    receiverName: String(order.receiverName || ''),
    receiverPhone: String(order.receiverPhone || ''),
    receiverAddress: String(order.receiverAddress || ''),
    itemName: String(order.itemName || ''),
    itemOption: String(order.itemOption || ''),
    quantity: Number(order.quantity || 1) || 1,
    deliveryMessage: String(order.deliveryMessage || '')
  };
}

function isAlreadyLogenRegistered(customer, shipDate) {
  return ['logen_registered', 'slip_pending', 'slip_ready', 'printed'].includes(shipmentFor(customer, shipDate).status);
}

async function hasExistingRegisteredOrder(orderNumValue, shipDate, exceptId) {
  const ord = String(orderNumValue || '').trim();
  if (!ord) return false;
  const snap = await db.collection('customers').where('orderNum', '==', ord).limit(10).get();
  return snap.docs.some(doc => {
    if (doc.id === exceptId) return false;
    return isAlreadyLogenRegistered(doc.data() || {}, shipDate);
  });
}

function logenShipmentUpdate(shipDate, data) {
  return {
    logenShipments: {
      [shipDate]: {
        ...data,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }
    }
  };
}

async function setShipment(ref, shipDate, data) {
  await ref.set(logenShipmentUpdate(shipDate, data), { merge: true });
}

async function prepareLogenOrders(body, action) {
  const { shipDate, customerIds, mode } = validateLogenPayload(body);
  const docs = await loadCustomerDocs(customerIds);
  const skippedItems = [];
  const candidates = [];

  for (const item of docs) {
    const customer = item.data;
    const ord = orderNumber(customer);
    if (customer.isDirect === true) {
      skippedItems.push({ customerId: item.id, orderNum: ord, reason: 'direct_delivery' });
      continue;
    }
    if (action === 'register' && isAlreadyLogenRegistered(customer, shipDate)) {
      skippedItems.push({ customerId: item.id, orderNum: ord, reason: 'already_registered' });
      continue;
    }
    if (action === 'register' && await hasExistingRegisteredOrder(ord, shipDate, item.id)) {
      skippedItems.push({ customerId: item.id, orderNum: ord, reason: 'same_order_already_registered' });
      continue;
    }
    candidates.push({
      id: item.id,
      ref: item.ref,
      customer,
      order: mapCustomerToLogenOrder(customer, shipDate)
    });
  }

  return { shipDate, mode, candidates, skippedItems, missing: customerIds.length - docs.length };
}

function countSummary(results, skippedItems, missing) {
  const sent = results.filter(row => row.ok).length;
  const failed = results.filter(row => !row.ok).length;
  return {
    sent,
    registered: sent,
    failed,
    skipped: skippedItems.length + Math.max(0, missing || 0),
    results,
    skippedItems
  };
}

async function handleLogenRegister(body, user) {
  const prepared = await prepareLogenOrders(body, 'register');
  const { shipDate, candidates, skippedItems, missing, mode } = prepared;
  if (!candidates.length) return countSummary([], skippedItems, missing);

  await Promise.all(candidates.map(item => setShipment(item.ref, shipDate, {
    status: 'logen_registering',
    orderNum: item.order.orderNum,
    requestedBy: user.email || user.uid || '',
    requestedAt: admin.firestore.FieldValue.serverTimestamp()
  })));

  let clientResults;
  try {
    clientResults = await logenClient.registerOrders(candidates.map(item => item.order), { shipDate, mode });
  } catch (error) {
    clientResults = candidates.map(item => ({
      customerId: item.id,
      orderNum: item.order.orderNum,
      ok: false,
      message: error.message || 'Logen register failed'
    }));
  }

  const byId = new Map(clientResults.map(row => [String(row.customerId), row]));
  await Promise.all(candidates.map(item => {
    const result = byId.get(item.id) || {};
    const ok = result.ok !== false;
    const status = ok
      ? (result.slipNo ? 'slip_ready' : 'logen_registered')
      : 'logen_failed';
    return setShipment(item.ref, shipDate, {
      status,
      orderNum: item.order.orderNum,
      slipNo: result.slipNo || '',
      receiptNo: result.receiptNo || '',
      snapshot: logenOrderSnapshot(item.order),
      changeNeeded: false,
      changeResolvedAt: admin.firestore.FieldValue.serverTimestamp(),
      errorMessage: ok ? '' : (result.message || '로젠 전송 실패'),
      registeredAt: ok ? admin.firestore.FieldValue.serverTimestamp() : null,
      registeredBy: user.email || user.uid || ''
    });
  }));

  return countSummary(clientResults, skippedItems, missing);
}

async function handleLogenSlipInquiry(body, user) {
  const prepared = await prepareLogenOrders(body, 'inquiry');
  const { shipDate, candidates, skippedItems, missing, mode } = prepared;
  if (!candidates.length) return countSummary([], skippedItems, missing);

  let clientResults;
  try {
    clientResults = await logenClient.inquirySlipNos(candidates.map(item => item.order), { shipDate, mode });
  } catch (error) {
    clientResults = candidates.map(item => ({
      customerId: item.id,
      orderNum: item.order.orderNum,
      ok: false,
      message: error.message || 'Logen slip inquiry failed'
    }));
  }

  const byId = new Map(clientResults.map(row => [String(row.customerId), row]));
  await Promise.all(candidates.map(item => {
    const result = byId.get(item.id) || {};
    const ok = result.ok !== false;
    const status = ok && result.slipNo ? 'slip_ready' : ok ? 'slip_pending' : 'logen_failed';
    return setShipment(item.ref, shipDate, {
      status,
      orderNum: item.order.orderNum,
      slipNo: result.slipNo || shipmentFor(item.customer, shipDate).slipNo || '',
      errorMessage: ok ? '' : (result.message || '송장번호 조회 실패'),
      slipInquiredAt: admin.firestore.FieldValue.serverTimestamp(),
      slipInquiredBy: user.email || user.uid || ''
    });
  }));

  return countSummary(clientResults, skippedItems, missing);
}

async function enabledPushTokens() {
  const snap = await db.collection('adminPushTokens')
    .where('enabled', '==', true)
    .get();
  return snap.docs
    .map(doc => ({ id: doc.id, ref: doc.ref, token: doc.data().token }))
    .filter(item => !!item.token);
}

async function sendSingleRequestNotification(requestId, request, extraUpdate = {}) {
  const typeLabel = changeRequestTypeLabel(request.type);
  const customerName = request.customerName || '고객';
  const body = `${customerName}님이 ${typeLabel}을 요청했습니다.`;
  const result = await sendPushToAdmins({
    title: '궁중수라간 변경요청',
    body,
    data: {
      requestId,
      type: String(request.type || ''),
      customerName: String(customerName),
      url: ADMIN_URL
    }
  });

  const update = {
    ...extraUpdate,
    notificationAttempts: admin.firestore.FieldValue.increment(1),
    notifiedAt: admin.firestore.FieldValue.serverTimestamp()
  };

  if (result.sent > 0) {
    update.notificationStatus = 'sent';
  } else if (result.total === 0) {
    update.notificationStatus = 'skipped';
  } else {
    update.notificationStatus = 'failed';
  }

  await db.collection('changeRequests').doc(requestId).set(update, { merge: true });
}

async function sendGroupedNotification(items) {
  const count = items.length;
  const names = items.slice(0, 3).map(item => item.data.customerName || '고객').join(', ');
  const result = await sendPushToAdmins({
    title: `궁중수라간 변경요청 ${count}건`,
    body: count === 1
      ? `${names}님의 변경요청이 있습니다.`
      : `${names}${count > 3 ? ' 외' : ''} 변경요청 ${count}건이 있습니다.`,
    data: {
      requestId: count === 1 ? items[0].id : '',
      requestIds: items.map(item => item.id).join(',').slice(0, 900),
      type: 'grouped',
      customerName: count === 1 ? String(items[0].data.customerName || '') : '',
      url: ADMIN_URL
    }
  });

  const status = result.sent > 0 ? 'sent' : result.total === 0 ? 'skipped' : 'failed';
  const batch = db.batch();
  items.forEach(item => {
    batch.set(item.ref, {
      notificationStatus: status,
      notificationAttempts: admin.firestore.FieldValue.increment(1),
      notifiedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  });
  await batch.commit();
}

function sameOrderForNotification(before, after) {
  return Number(before.lunchCount || 0) === Number(after.lunchCount || 0)
    && Number(before.saladCount || 0) === Number(after.saladCount || 0)
    && Boolean(before.selfHoliday) === Boolean(after.selfHoliday)
    && String(before.note || '') === String(after.note || '');
}

async function sendOrderNotification(date, userId, order, isUpdate) {
  const userSnap = await db.collection('users').doc(userId).get().catch(() => null);
  const user = userSnap?.exists ? (userSnap.data() || {}) : {};
  const customerName = user.businessName || order.businessName || order.customerName || '고객';
  const lunch = Number(order.lunchCount || order.lunchQty || 0) || 0;
  const salad = Number(order.saladCount || order.saladQty || 0) || 0;
  const title = isUpdate ? '궁중수라간 주문 변경' : '궁중수라간 주문 접수';
  const body = order.selfHoliday
    ? `${customerName}님이 ${date} 자체 휴무를 등록했습니다.`
    : `${customerName}님 ${date} 주문: 도시락 ${lunch}개 / 샐러드 ${salad}개`;
  const result = await sendPushToAdmins({
    title,
    body,
    data: {
      requestId: `order-${date}-${userId}`,
      type: isUpdate ? 'order_update' : 'order_create',
      customerName: String(customerName),
      orderDate: String(date),
      userId: String(userId),
      url: ORDER_ADMIN_URL
    },
    url: ORDER_ADMIN_URL,
    tag: `order-${date}-${userId}`
  });
  logger.info('Order push result', {
    date,
    userId,
    total: result.total,
    sent: result.sent,
    failed: result.failed
  });
}

async function sendPushToAdmins(message) {
  const tokenItems = await enabledPushTokens();
  if (!tokenItems.length) return { total: 0, sent: 0, failed: 0 };

  const response = await admin.messaging().sendEachForMulticast({
    tokens: tokenItems.map(item => item.token),
    notification: {
      title: message.title,
      body: message.body
    },
    data: message.data,
    webpush: {
      fcmOptions: {
        link: message.url || ADMIN_URL
      },
      notification: {
        title: message.title,
        body: message.body,
        icon: '/gjsuragan/icons/icon.svg',
        badge: '/gjsuragan/icons/icon.svg',
        tag: message.tag || (message.data.requestId ? `change-request-${message.data.requestId}` : 'gjsuragan-change-request'),
        renotify: true
      }
    }
  });

  const invalidCodes = new Set([
    'messaging/invalid-registration-token',
    'messaging/registration-token-not-registered',
    'messaging/invalid-argument'
  ]);

  const cleanup = [];
  response.responses.forEach((item, index) => {
    if (!item.success && item.error) {
      const tokenItem = tokenItems[index];
      logger.warn('FCM token send failed', tokenItem.id, item.error.code, item.error.message);
      if (invalidCodes.has(item.error.code)) {
        cleanup.push(disableInvalidToken(tokenItem, item.error));
      } else {
        cleanup.push(recordInvalidToken(tokenItem, item.error));
      }
    }
  });
  await Promise.all(cleanup);
  logger.info('FCM push result', {
    total: tokenItems.length,
    sent: response.successCount,
    failed: response.failureCount
  });

  return {
    total: tokenItems.length,
    sent: response.successCount,
    failed: response.failureCount
  };
}

async function disableInvalidToken(tokenItem, error) {
  await tokenItem.ref.set({
    enabled: false,
    disabledAt: admin.firestore.FieldValue.serverTimestamp(),
    disabledReason: error.code || 'send_failed',
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
  await recordInvalidToken(tokenItem, error);
}

async function recordInvalidToken(tokenItem, error) {
  await db.collection('invalidPushTokens').add({
    tokenId: tokenItem.id,
    token: tokenItem.token,
    errorCode: error.code || '',
    errorMessage: error.message || '',
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  });
}

function changeRequestTypeLabel(type) {
  return {
    schedule_change: '배송일 변경',
    address_change: '주소 변경',
    pause: '일시중지',
    memo: '요청사항',
    etc: '기타'
  }[type] || '기타';
}
