// 아임웹 주문 동기화 본체. 앱스스크립트 syncImwebOrders 를 옮긴 것이다.
// 클라이언트와 db 를 주입받아서 테스트에서 가짜로 갈아끼울 수 있게 한다.
//
// 취소 판정만 앱스스크립트와 다르다. 예전에는 주문에 붙은 취소 흔적 하나만 보고
// 주문 전체를 취소로 처리했다. 그래서 취소를 철회하거나 한 줄만 취소한 주문이
// 영영 등록되지 않았다. 지금은 주문 상태와 상품 줄 상태를 따로 본다.

const parser = require('./imwebParser');
const defaultClient = require('./imwebClient');

const CUSTOMERS = 'customers';
const CANCEL_LOGS = 'imwebCancelLogs';
const MISSED_ORDERS = 'imwebMissedOrders';
const CONFIG_DOC = ['config', 'imwebSync'];
// 한 번에 새로 만드는 알림 수 상한.
// 상태 코드 하나를 목록에 빠뜨리면 지난 주문이 통째로 '알아보지 못함' 이 되어
// 알림이 수백 건 쏟아지고, 그러면 아무도 안 보게 된다. 넘치면 다음 실행에서 이어 담는다.
const MAX_NEW_ALERTS_PER_RUN = 20;

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

// 취소 판정을 고친 함수를 배포한 날. config 에 registerFrom 이 없으면 이 날을 기준일로 쓴다.
// 설정을 깜빡해서 그동안 빠졌던 주문이 한꺼번에 등록되는 일이 없도록 기본값을 박아둔다.
// 기준일을 아예 없애려면 config/imwebSync 의 registerFrom 에 옛날 날짜를 넣으면 된다.
const DEFAULT_REGISTER_FROM = '2026-09-10';

// 등록 기준일. 이 날짜보다 이전에 들어온 주문은 자동으로 등록하지 않는다.
// 취소 판정 버그로 그동안 빠졌던 주문이 한꺼번에 배송목록에 쏟아지면
// 이미 지나간 배송일까지 되살아나서 현장이 더 헷갈린다.
// 대신 imwebMissedOrders 에 적어두고 사람이 보고 판단하게 한다.
// 값이 없으면 기준일 없이 예전처럼 전부 등록한다.
async function loadRegisterFrom(db) {
  try {
    const snapshot = await db.collection(CONFIG_DOC[0]).doc(CONFIG_DOC[1]).get();
    if (!snapshot.exists) return DEFAULT_REGISTER_FROM;
    const value = String((snapshot.data() || {}).registerFrom || '').trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : DEFAULT_REGISTER_FROM;
  } catch {
    return DEFAULT_REGISTER_FROM;
  }
}

// 이미 적어둔 기록은 다시 쓰지 않는다. '확인함' 표시가 지워지면 안 되기 때문이다.
// 값은 등록용 문서(customerData)를 이미 담고 있는지다.
// 담고 있지 않은데 이번에 파싱이 됐다면 그때는 다시 써서 채운다.
async function loadMissedRecords(db) {
  const records = new Map();
  try {
    const snapshot = await db.collection(MISSED_ORDERS).get();
    snapshot.forEach(doc => {
      records.set(doc.id, Boolean((doc.data() || {}).customerData));
    });
  } catch {
    // 컬렉션이 없으면 빈 목록으로 시작한다.
  }
  return records;
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

function recordsForSyncKey(existing, syncKey) {
  const key = String(syncKey || '');
  if (!key) return [];
  return (existing.get(key) || []).filter(record => record?.id);
}

// 지운 문서를 색인에서도 빼야 같은 실행 안에서 '이미등록' 으로 잘못 걸리지 않는다.
function forgetOrder(existing, orderNo) {
  const no = String(orderNo || '').trim();
  if (!no) return;
  for (const key of [...existing.keys()]) {
    if (key === no || key.startsWith(`${no}-`)) existing.delete(key);
  }
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

async function deleteRecords(db, orderNo, status, records, cancelInfo, now) {
  await recordCancel(db, orderNo, status, records, cancelInfo, now);
  for (const record of records) {
    await db.collection(CUSTOMERS).doc(record.id).delete();
  }
}

async function deleteCancelledOrder(db, orderNo, status, order, prodOrders, existing, now, log, unregistered) {
  const records = recordsForOrderNo(existing, orderNo);
  if (!records.length) {
    // 취소된 주문인데 우리 쪽에 등록된 적이 없다. 지울 것도 등록할 것도 없다.
    // 예전에는 여기서 아무 기록 없이 사라져서, 숫자를 맞춰봐도 어디로 갔는지 알 수 없었다.
    if (unregistered) unregistered.push(`${orderNo}(${status || '취소'})`);
    return 0;
  }
  const cancelInfo = parser.cancelInfoForOrder(order, prodOrders);
  await deleteRecords(db, orderNo, status, records, cancelInfo, now);
  forgetOrder(existing, orderNo);
  log(`🗑 취소 삭제: ${orderNo}${cancelInfo.cancelReasonText ? ` / 사유: ${cancelInfo.cancelReasonText}` : ''}`);
  return records.length;
}

// 부분취소는 취소된 상품 줄만 지운다. 같은 주문의 살아 있는 줄은 건드리지 않는다.
async function deleteCancelledLine(db, orderNo, syncKey, status, order, prodOrders, existing, now, log, unregistered) {
  const records = recordsForSyncKey(existing, syncKey);
  if (!records.length) {
    if (unregistered) unregistered.push(`${syncKey}(${status || '취소'})`);
    return 0;
  }
  const cancelInfo = parser.cancelInfoForOrder(order, prodOrders);
  await deleteRecords(db, orderNo, status, records, cancelInfo, now);
  existing.delete(String(syncKey));
  log(`🗑 부분취소 삭제: ${syncKey}${cancelInfo.cancelReasonText ? ` / 사유: ${cancelInfo.cancelReasonText}` : ''}`);
  return records.length;
}

// 손님은 주문했는데 우리 쪽에 안 뜨는 경우들. 로그만 남기면 아무도 못 본다.
const UNREGISTERED_REASONS = {
  unknown_status: '아임웹 주문 상태를 알아보지 못해서 자동으로 등록하지 못했습니다. 상태 이름을 알려주시면 다음부터 자동으로 잡습니다.',
  unparsed_product: '상품명에서 세트·상품을 알아보지 못해서 자동으로 등록하지 못했습니다. 직접 등록해 주세요.',
  no_items: '아임웹에서 이 주문의 상품 내역을 읽지 못했습니다. 아임웹에서 주문을 확인해 주세요.'
};

// 왜 자동등록에서 빠졌는지를 사람 말로 적어둔다. 화면에서 그대로 보여준다.
function missedReason(claimTrace, orderDate, registerFrom) {
  if (!orderDate) {
    return {
      reasonCode: 'unknown_date',
      reason: '주문일을 읽을 수 없어 자동으로 등록하지 않았습니다. 배송이 남아 있는지 확인해 주세요.'
    };
  }
  if (claimTrace) {
    return {
      reasonCode: 'cancel_trace',
      reason: '아임웹에 취소 흔적(취소 후 철회·부분취소 등)이 남아 있어서, 그동안 자동등록에서 잘못 빠져 있던 주문입니다.'
    };
  }
  return {
    reasonCode: 'before_cutoff',
    reason: `등록 기준일(${registerFrom}) 이전 주문이라 자동으로 등록하지 않았습니다.`
  };
}

// 등록되지 않은 주문을 적어둔다. 문서 id 가 syncKey 라 같은 줄이 여러 번 쌓이지 않는다.
// parsed 가 있으면 customerData 에 통째로 넣어둬서 화면에서 고르면 그대로 등록할 수 있다.
// 파싱 자체가 안 된 주문은 parsed 가 없으니, 손님 정보만 주문에서 직접 뽑아 담는다.
async function recordUnregistered(db, options) {
  const { order, syncKey, status, reason, reasonCode, prodName, parsed, orderDate, now } = options;
  const address = order?.delivery?.address || {};
  const payload = {
    syncKey: String(syncKey || ''),
    orderNo: String(order?.order_no || ''),
    orderDate: String(orderDate || ''),
    imwebStatus: String(status || ''),
    name: String(parsed?.name || address.name || order?.orderer?.name || ''),
    phone: String(parsed?.phone || address.phone || order?.orderer?.call || ''),
    addr: String(parsed?.addr || [address.address, address.address_detail].filter(Boolean).join(' ')),
    prodName: String(prodName || ''),
    product: String(parsed?.productId || ''),
    scheduleName: String(parsed?.scheduleName || ''),
    orderType: String(parsed?.orderType || ''),
    startDate: String(parsed?.startDate || parsed?.onceDate || ''),
    total: Number(parsed?.total || 0),
    reason,
    reasonCode,
    source: 'cloud_function',
    firstSeenAt: now.toISOString()
    // acknowledged 는 일부러 쓰지 않는다. 사람이 '확인함' 을 누른 값을 덮으면 안 된다.
  };
  if (parsed) payload.customerData = parsed;
  if (parsed?.orderAmount !== undefined) payload.orderAmount = parsed.orderAmount;
  await db.collection(MISSED_ORDERS).doc(String(syncKey)).set(payload, { merge: true });
}

async function recordMissedOrder(db, entry, order, line, orderDate, registerFrom, claimTrace, now) {
  const { reason, reasonCode } = missedReason(claimTrace, orderDate, registerFrom);
  await recordUnregistered(db, {
    order, syncKey: line.syncKey, status: line.status,
    reason, reasonCode, parsed: entry?.parsed || null, orderDate, now
  });
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
  // 기준일은 옵션으로도 줄 수 있게 해서 테스트와 재조회에서 갈아끼운다.
  const registerFrom = options.registerFrom !== undefined
    ? String(options.registerFrom || '')
    : await loadRegisterFrom(db);
  // 기준일이 없어도 '알아보지 못한 주문' 은 알려야 하므로 항상 읽는다.
  const missedRecords = await loadMissedRecords(db);
  log(`아임웹 ${orders.length}건 / 기존 ${existing.size}건${registerFrom ? ` / 등록 기준일 ${registerFrom}` : ''}`);

  let saved = 0;
  let deleted = 0;
  let skipped = 0;
  let missed = 0;
  // 취소 상태인데 등록된 적이 없어서 지울 것도 없던 주문·상품 줄
  const cancelledUnregistered = [];

  // 결제는 됐는데 우리가 등록하지 못한 주문. 로그만 남기면 아무도 못 보니 알림으로 올린다.
  // 같은 줄을 매 실행마다 다시 쓰지 않고, 등록용 문서가 뒤늦게 생기면 그때 채운다.
  let newAlerts = 0;
  let alertOverflow = 0;
  const noteUnregistered = async (options) => {
    const key = String(options.syncKey || '');
    const recorded = missedRecords.get(key);
    if (recorded === undefined || (recorded === false && options.parsed)) {
      if (newAlerts >= MAX_NEW_ALERTS_PER_RUN) {
        alertOverflow++;
        missed++;
        return;
      }
      await recordUnregistered(db, { ...options, now });
      missedRecords.set(key, Boolean(options.parsed));
      newAlerts++;
    }
    missed++;
    log(`📋 등록 못함(${options.reasonCode}): ${key} / ${options.status || '상태 없음'} / ${options.prodName || options.parsed?.name || ''}`);
  };

  for (const order of orders) {
    const orderNo = String(order.order_no || '');
    if (!orderNo) continue;
    if (forceRecheck && !onlyOrderNos.includes(orderNo)) continue;

    const headStatuses = parser.orderHeadStatuses(order);
    const claimStatuses = parser.orderClaimStatuses(order);
    const headStatus = headStatuses[0] || claimStatuses[0] || '';

    // 주문 자체가 취소면 상품 줄을 볼 것도 없이 통째로 지운다.
    if (headStatuses.some(parser.isCancelStatus)) {
      deleted += await deleteCancelledOrder(db, orderNo, headStatus, order, [], existing, now, log, cancelledUnregistered);
      continue;
    }

    if (headStatuses.some(parser.isTerminalStatus)) {
      log(`⏭ 종료상태 건너뜀: ${orderNo} (${headStatus})`);
      skipped++;
      continue;
    }

    // 상품 조회는 주문 하나당 API 한 번이라 이미 등록된 주문은 여기서 끊는다.
    // 다만 claim_* 에 취소 흔적이 있으면 부분취소일 수 있어서 줄 단위로 다시 본다.
    const claimTrace = parser.hasClaimTrace(claimStatuses);
    if (!forceRecheck && !claimTrace && existing.has(orderNo)) {
      skipped++;
      continue;
    }

    const prodOrders = await client.getProdOrders(token, orderNo);
    const items = client.itemsFromProdOrders(prodOrders);
    if (!items.length) {
      // 클레임이 걸린 주문인데 줄을 못 읽으면 판정을 미룬다. 함부로 지우지 않는다.
      if (claimTrace) {
        log(`⚠ 상품 줄을 못 읽어 판정 보류: ${orderNo} (${claimStatuses.join(' / ')})`);
        skipped++;
        continue;
      }
      // 살아 있는 주문인데 상품 내역이 안 온다. 손님은 주문했는데 우리 쪽에 안 뜨는 경우다.
      if (existing.has(orderNo)) { skipped++; continue; }
      await noteUnregistered({
        order, syncKey: orderNo, status: headStatus,
        reason: UNREGISTERED_REASONS.no_items, reasonCode: 'no_items',
        parsed: null, orderDate: parser.orderDate(order)
      });
      continue;
    }

    const lines = items.map((item, idx) => {
      const itemIdx = idx + 1;
      const statuses = parser.lineStatuses(order, parser.prodOrderOfItem(prodOrders, item), item);
      return {
        itemIdx,
        syncKey: parser.buildSyncKey(orderNo, itemIdx),
        statuses,
        status: statuses[0] || '',
        // 취소·종료 로그에는 주문 상태가 아니라 실제로 걸린 상태를 남긴다.
        cancelStatus: statuses.find(parser.isCancelStatus) || '',
        terminalStatus: statuses.find(parser.isTerminalStatus) || ''
      };
    });

    // 줄이 전부 취소면 주문 전체 취소로 보고 주문번호에 딸린 문서를 통째로 지운다.
    if (lines.every(line => line.cancelStatus)) {
      deleted += await deleteCancelledOrder(db, orderNo, lines[0].cancelStatus || headStatus, order, prodOrders, existing, now, log, cancelledUnregistered);
      continue;
    }

    // 상품 파싱은 실제로 등록할 줄이 생겼을 때만 한다. 취소된 줄까지 파싱하면 로그만 시끄러워진다.
    let parsedEntries = null;
    const entryFor = line => {
      if (!parsedEntries) parsedEntries = parser.parseOrderItems(order, orderNo, items, { log, now });
      return parsedEntries[line.itemIdx - 1];
    };

    for (const line of lines) {
      if (line.cancelStatus) {
        deleted += await deleteCancelledLine(db, orderNo, line.syncKey, line.cancelStatus, order, prodOrders, existing, now, log, cancelledUnregistered);
        continue;
      }
      if (line.terminalStatus) {
        log(`⏭ 종료상태 건너뜀: ${line.syncKey} (${line.terminalStatus})`);
        skipped++;
        continue;
      }
      if (!line.statuses.some(parser.isAllowStatus)) {
        // 아직 결제 전인 주문은 등록 대상이 아니다. 이건 알릴 일이 아니라 정상이다.
        if (line.statuses.some(parser.isPendingStatus)) {
          log(`⏸ 결제 전 건너뜀: ${line.syncKey} (${line.status})`);
          skipped++;
          continue;
        }
        // 결제도 취소도 종료도 아닌, 우리가 모르는 상태다. 그냥 넘기면 손님 주문이 사라진다.
        if (existing.has(line.syncKey)) { skipped++; continue; }
        await noteUnregistered({
          order, syncKey: line.syncKey, status: line.statuses.join(' / '),
          reason: UNREGISTERED_REASONS.unknown_status, reasonCode: 'unknown_status',
          prodName: items[line.itemIdx - 1]?.prod_name || '',
          parsed: null, orderDate: parser.orderDate(order)
        });
        continue;
      }
      if (existing.has(line.syncKey)) {
        log(`⏭ 이미등록: ${line.syncKey}`);
        skipped++;
        continue;
      }

      const entry = entryFor(line);
      if (!entry?.parsed) {
        // 상품명에서 세트·상품을 못 읽었다. 자동 등록은 못 해도 알려는 줘야 한다.
        await noteUnregistered({
          order, syncKey: line.syncKey, status: line.status,
          reason: UNREGISTERED_REASONS.unparsed_product, reasonCode: 'unparsed_product',
          prodName: items[line.itemIdx - 1]?.prod_name || '',
          parsed: null, orderDate: parser.orderDate(order)
        });
        continue;
      }

      // 기준일 이전 주문은 등록하지 않고 '놓친 주문' 으로만 적어둔다.
      // 주문일을 못 읽는 주문도 나이를 알 수 없으니 사람이 보게 한다.
      const orderDate = parser.orderDate(order);
      if (registerFrom && (!orderDate || orderDate < registerFrom)) {
        const recorded = missedRecords.get(line.syncKey);
        if (recorded === undefined || recorded === false) {
          await recordMissedOrder(db, entry, order, line, orderDate, registerFrom, claimTrace, now);
          missedRecords.set(line.syncKey, true);
        }
        missed++;
        log(`📋 등록 보류: ${line.syncKey} / 주문일 ${orderDate || '알 수 없음'} / ${entry.parsed.name}`);
        continue;
      }

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

  if (alertOverflow) {
    log(`⚠ 알림 상한(${MAX_NEW_ALERTS_PER_RUN}건)을 넘어 ${alertOverflow}건은 다음 실행으로 미뤘다. 상태 목록에 빠진 코드가 없는지 확인이 필요하다.`);
  }
  if (cancelledUnregistered.length) {
    // 주문번호를 같이 남긴다. 정말 취소된 주문인지 아임웹에서 바로 확인할 수 있어야 한다.
    log(`🚫 취소 상태라 등록하지 않음(등록된 적 없는 ${cancelledUnregistered.length}건): ${cancelledUnregistered.slice(0, 30).join(', ')}`);
  }
  log(`=== 완료: 등록 ${saved}건 / 삭제 ${deleted}건 / 건너뜀 ${skipped}건${missed ? ` / 등록 보류 ${missed}건` : ''}${cancelledUnregistered.length ? ` / 취소 ${cancelledUnregistered.length}건` : ''} ===`);
  return {
    saved, deleted, skipped, missed,
    newAlerts, alertOverflow,
    cancelled: cancelledUnregistered.length,
    cancelledOrderNos: cancelledUnregistered.slice(0, 30),
    scanned: orders.length
  };
}

module.exports = {
  DEFAULT_REGISTER_FROM,
  isSyncEnabled,
  loadSyncEnabled,
  loadExistingBySyncKey,
  loadMissedRecords,
  loadRegisterFrom,
  missedReason,
  recordsForOrderNo,
  recordsForSyncKey,
  syncImwebOrders
};
