const admin = require('firebase-admin');
const { onDocumentCreated, onDocumentWritten } = require('firebase-functions/v2/firestore');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { logger } = require('firebase-functions');

admin.initializeApp();

const db = admin.firestore();
const TIMEZONE = 'Asia/Seoul';
const WINDOW_START_HOUR = Number(process.env.NOTIFICATION_WINDOW_START_HOUR || 14);
const WINDOW_END_HOUR = Number(process.env.NOTIFICATION_WINDOW_END_HOUR || 17);
const MAX_PENDING_PER_BATCH = 20;
const ADMIN_URL = 'https://djmonnar.github.io/gjsuragan/admin.html#changeRequests';
const ORDER_ADMIN_URL = 'https://djmonnar.github.io/gjsuragan/admin.html';

exports.onChangeRequestCreated = onDocumentCreated('changeRequests/{requestId}', async (event) => {
  const snap = event.data;
  if (!snap) return;
  const requestId = event.params.requestId;
  const request = snap.data() || {};
  const now = new Date();
  const windowInfo = notificationWindow(now);

  const baseUpdate = {
    urgent: request.urgent === true,
    notificationWindow: {
      timezone: TIMEZONE,
      startHour: WINDOW_START_HOUR,
      endHour: WINDOW_END_HOUR
    }
  };

  if (request.urgent === true || windowInfo.open) {
    await sendSingleRequestNotification(requestId, request, baseUpdate);
    return;
  }

  await snap.ref.set({
    ...baseUpdate,
    notificationStatus: 'pending',
    notifyAfterAt: admin.firestore.Timestamp.fromDate(windowInfo.nextStart),
    notifiedAt: null,
    notificationAttempts: Number(request.notificationAttempts || 0)
  }, { merge: true });
});

exports.onCustomerOrderWritten = onDocumentWritten('orders/{date}/items/{userId}', async (event) => {
  const after = event.data?.after;
  if (!after?.exists) return;

  const order = after.data() || {};
  const before = event.data?.before?.exists ? (event.data.before.data() || {}) : null;
  if (before && sameOrderForNotification(before, order)) return;

  const now = new Date();
  const windowInfo = notificationWindow(now);
  if (!windowInfo.open) {
    logger.info('Order push skipped outside notification window', {
      date: event.params.date,
      userId: event.params.userId
    });
    return;
  }

  await sendOrderNotification(event.params.date, event.params.userId, order, Boolean(before));
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
  const windowInfo = notificationWindow(now);
  if (!windowInfo.open) return;

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
    await sendSingleRequestNotification(item.id, item.data, {
      notificationWindow: {
        timezone: TIMEZONE,
        startHour: WINDOW_START_HOUR,
        endHour: WINDOW_END_HOUR
      }
    });
  }

  if (normal.length) {
    await sendGroupedNotification(normal);
  }
});

function notificationWindow(now) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).formatToParts(now).reduce((acc, part) => {
    acc[part.type] = part.value;
    return acc;
  }, {});

  const hour = Number(parts.hour);
  const open = hour >= WINDOW_START_HOUR && hour < WINDOW_END_HOUR;
  const todayStartUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    WINDOW_START_HOUR - 9,
    0,
    0
  );
  const nextStart = hour < WINDOW_START_HOUR
    ? new Date(todayStartUtc)
    : new Date(todayStartUtc + 24 * 60 * 60 * 1000);

  return { open, nextStart };
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
