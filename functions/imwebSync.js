// 아임웹 주문 동기화 본체. 앱스스크립트 syncImwebOrders 를 그대로 옮긴 것이다.
// 클라이언트와 db 를 주입받아서 테스트에서 가짜로 갈아끼울 수 있게 한다.

const parser = require('./imwebParser');
const defaultClient = require('./imwebClient');

const CUSTOMERS = 'customers';
const CANCEL_LOGS = 'imwebCancelLogs';
const CONFIG_DOC = ['config', 'imwebSync'];

function isSyncEnabled(env = process.env) {
  return String(env.IMWEB_SYNC_ENABLED || '').trim().toLowerCase() === 'true';
}

// 켜고 끄는 스위치는 Firestore 에 둔다.
// functions/.env 는 git 에 없어서 배포 워크플로로는 환경변수를 바꿀 수 없고,
// 앱스스크립트에서 넘어올 때 재배포 없이 바로 되돌릴 수 있어야 하기 때문이다.
// 문서가 없으면 꺼진 것으로 본다.
async function loadSyncEnabled(db, env = process.env) {
  if (isSyncEnabled(env)) return true;
  try {
    const snapshot = await db.collection(CONFIG_DOC[0]).doc(CONFIG_DOC[1]).get();
    return snapshot.exists && (snapshot.data() || {}).enabled === true;
  } catch {
    return false;
  }
}

// 이미 등록된 주문을 찾을 때 쓰는 색인.
// 예전 문서는 syncKey 가 없고 orderNum 만 있어서 둘 다 열쇠로 받는다.
async function loadExistingBySyncKey(db) {
  const snapshot = await db.collection(CUSTOMERS).get();
  const map = new Map();
  snapshot.forEach(doc => {
    const data = doc.data() || {};
    const key = String(data.syncKey || data.orderNum || '');
    if (!key) return;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push({
      id: doc.id,
      name: String(data.name || ''),
      phone: String(data.phone || ''),
      product: String(data.productId || data.set || ''),
      schedule: String(data.scheduleName || data.onceDate || '')
    });
  });
  return map;
}

function recordsForOrderNo(existing, orderNo) {
  const no = String(orderNo || '').trim();
  const records = [];
  const seen = new Set();
  for (const [key, list] of existing) {
    if (key !== no && !key.startsWith(`${no}-`)) continue;
    for (const record of list) {
      if (!record?.id || seen.has(record.id)) continue;
      seen.add(record.id);
      records.push(record);
    }
  }
  return records;
}

async function recordCancel(db, orderNo, status, records, cancelInfo, now) {
  await db.collection(CANCEL_LOGS).add({
    orderNo: String(orderNo || ''),
    cancelStatus: String(status || ''),
    cancelReason: String(cancelInfo.cancelReason || ''),
    cancelReasonDetail: String(cancelInfo.cancelReasonDetail || ''),
    cancelReasonText: String(cancelInfo.cancelReasonText || ''),
    cancelRequestedAt: String(cancelInfo.cancelRequestedAt || ''),
    source: 'cloud_function',
    deletedCount: records.length,
    deletedDocIds: records.map(record => record.id),
    customerNames: records.map(record => record.name),
    customerPhones: records.map(record => record.phone),
    products: records.map(record => record.product),
    schedules: records.map(record => record.schedule),
    createdAt: now.toISOString(),
    acknowledged: false
  });
}

async function deleteCancelledOrder(db, orderNo, status, order, prodOrders, existing, now, log) {
  const records = recordsForOrderNo(existing, orderNo);
  if (!records.length) return 0;
  const cancelInfo = parser.cancelInfoForOrder(order, prodOrders);
  await recordCancel(db, orderNo, status, records, cancelInfo, now);
  for (const record of records) {
    await db.collection(CUSTOMERS).doc(record.id).delete();
  }
  log(`🗑 취소 삭제: ${orderNo}${cancelInfo.cancelReasonText ? ` / 사유: ${cancelInfo.cancelReasonText}` : ''}`);
  return records.length;
}

async function syncImwebOrders(options = {}) {
  const db = options.db;
  if (!db) throw new Error('db 가 필요합니다.');
  const client = options.client || defaultClient;
  const env = options.env || process.env;
  const log = options.log || (() => {});
  const now = options.now || new Date();
  // 특정 주문만 다시 훑고 싶을 때 쓴다. 이미 등록된 주문도 건너뛰지 않는다.
  const onlyOrderNos = (options.onlyOrderNos || []).map(no => String(no || '').trim()).filter(Boolean);
  const forceRecheck = onlyOrderNos.length > 0;

  const token = await client.getToken(env);
  if (!token) throw new Error('아임웹 토큰 발급 실패');

  const orders = await client.getOrders(token, parser.HOLD_QUERY_STATUSES, log);
  const existing = await loadExistingBySyncKey(db);
  log(`아임웹 ${orders.length}건 / 기존 ${existing.size}건`);

  let saved = 0;
  let deleted = 0;
  let skipped = 0;

  for (const order of orders) {
    const orderNo = String(order.order_no || '');
    if (!orderNo) continue;
    if (forceRecheck && !onlyOrderNos.includes(orderNo)) continue;

    const headStatuses = parser.orderStatuses(order, []);
    const headStatus = headStatuses[0] || '';

    if (headStatuses.some(parser.isCancelStatus)) {
      deleted += await deleteCancelledOrder(db, orderNo, headStatus, order, [], existing, now, log);
      continue;
    }

    if (headStatuses.some(parser.isTerminalStatus)) {
      log(`⏭ 종료상태 건너뜀: ${orderNo} (${headStatus})`);
      skipped++;
      continue;
    }

    // 상품 조회는 주문 하나당 API 한 번이라 이미 등록된 주문은 여기서 끊는다.
    if (!forceRecheck && existing.has(orderNo)) {
      skipped++;
      continue;
    }

    const prodOrders = await client.getProdOrders(token, orderNo);
    const items = client.itemsFromProdOrders(prodOrders);
    if (!items.length) { skipped++; continue; }

    const statuses = parser.orderStatuses(order, prodOrders);
    const status = statuses[0] || '';

    if (statuses.some(parser.isCancelStatus)) {
      deleted += await deleteCancelledOrder(db, orderNo, status, order, prodOrders, existing, now, log);
      continue;
    }

    if (statuses.some(parser.isTerminalStatus)) {
      log(`⏭ 종료상태 건너뜀: ${orderNo} (${status})`);
      skipped++;
      continue;
    }

    if (!statuses.some(parser.isAllowStatus)) {
      log(`⏸ 건너뜀: ${orderNo} (${status})`);
      skipped++;
      continue;
    }

    for (const entry of parser.parseOrderItems(order, orderNo, items, { log, now })) {
      if (existing.has(entry.syncKey)) {
        log(`⏭ 이미등록: ${entry.syncKey}`);
        skipped++;
        continue;
      }
      if (!entry.parsed) { skipped++; continue; }

      const created = await db.collection(CUSTOMERS).add(entry.parsed);
      existing.set(entry.syncKey, [{
        id: created?.id || entry.syncKey,
        name: entry.parsed.name,
        phone: entry.parsed.phone,
        product: entry.parsed.productId,
        schedule: entry.parsed.scheduleName
      }]);
      saved++;
      log(`✅ ${entry.isSub ? '정기' : '선택'} 등록: ${entry.parsed.name} / ${entry.syncKey} / ${entry.parsed.scheduleName}`);
    }
  }

  log(`=== 완료: 등록 ${saved}건 / 삭제 ${deleted}건 / 건너뜀 ${skipped}건 ===`);
  return { saved, deleted, skipped, scanned: orders.length };
}

module.exports = {
  isSyncEnabled,
  loadSyncEnabled,
  loadExistingBySyncKey,
  recordsForOrderNo,
  syncImwebOrders
};
