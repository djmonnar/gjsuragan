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

exports.api = onRequest(async (req, res) => {
  setCorsHeaders(res);
  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }
  if (req.method !== 'POST') {
    sendJson(res, 405, { ok: false, error: 'Method not allowed' });
    return;
  }

  const pathname = new URL(req.url, 'https://gjsuragan.local').pathname;
  try {
    const user = await verifyAdminRequest(req);
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
