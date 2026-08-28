// 아임웹 주문 → customers 문서 변환. 순수 함수만 둔다.
// 네트워크·Firestore 접근은 imwebClient.js / imwebSync.js 가 맡는다.
// 앱스스크립트(appscript/Code.gs) 로직을 그대로 옮긴 것이라, 동작이 달라지면 안 된다.

const CANCEL_STATUS = [
  'order_cancel', 'pay_cancel', 'refund_req', 'refund_done',
  'cancel_req', 'cancel_request', 'cancel_done', 'CANCEL_REQUEST', 'CANCEL',
  '취소접수', '취소요청', '취소완료', '환불요청', '환불완료'
];
const ALLOW_STATUS = [
  'pay_done', 'pay_complete', 'payment_complete',
  'delivery_ready', 'delivery', 'delivering', 'standby',
  'delivery_hold', 'delivery_on_hold', 'delivery_pending', 'hold', 'holding', 'on_hold',
  'PAY_DONE', 'PAY_COMPLETE', 'PAYMENT_COMPLETE',
  'DELIVERY_READY', 'DELIVERY', 'DELIVERING', 'STANDBY',
  'DELIVERY_HOLD', 'DELIVERY_ON_HOLD', 'DELIVERY_PENDING', 'HOLD', 'HOLDING', 'ON_HOLD',
  '배송보류', '배송 보류'
];
const TERMINAL_STATUS = [
  'delivered', 'complete', 'order_complete', 'purchase_complete', 'delivery_complete', 'delivery_done',
  'DELIVERED', 'COMPLETE', 'ORDER_COMPLETE', 'PURCHASE_COMPLETE', 'DELIVERY_COMPLETE', 'DELIVERY_DONE',
  '배송완료', '배송 완료', '거래종료', '구매확정', '구매 확정'
];
const HOLD_QUERY_STATUSES = ['delivery_hold', '배송 보류'];

const SINGLE_PROD_MAP = {
  pork_rib: '수제 돼지양념갈비',
  beef_la: '양념 LA갈비',
  beef_soup: '소고기무국'
};

const PRODUCT_LABELS = {
  A: 'A세트',
  B: 'B세트',
  C: 'C세트',
  pork_rib: '수제 돼지양념갈비',
  beef_la: '양념 LA갈비',
  beef_soup: '소고기무국'
};

function normalizeStatus(status) {
  return String(status || '').replace(/\s+/g, '').toLowerCase();
}

function matchesStatusList(status, list, fallbackPattern) {
  const normalized = normalizeStatus(status);
  if (!normalized) return false;
  if (list.some(candidate => normalizeStatus(candidate) === normalized)) return true;
  return fallbackPattern.test(normalized);
}

function isCancelStatus(status) {
  return matchesStatusList(status, CANCEL_STATUS, /cancel|refund|취소|환불/);
}

function isAllowStatus(status) {
  return matchesStatusList(status, ALLOW_STATUS,
    /paydone|paycomplete|paymentcomplete|deliveryready|delivering|standby|deliveryhold|deliveryonhold|deliverypending|결제완료|배송준비|배송중|배송보류/);
}

function isTerminalStatus(status) {
  return matchesStatusList(status, TERMINAL_STATUS,
    /delivered|deliverycomplete|deliverydone|ordercomplete|purchasecomplete|shippingcomplete|배송완료|거래종료|구매확정/);
}

function orderStatuses(order, prodOrders) {
  const statuses = [
    order?.status, order?.order_status, order?.payment_status,
    order?.status_text, order?.status_name, order?.order_status_text,
    order?.claim_status, order?.claim_type
  ];
  (prodOrders || []).forEach(po => {
    statuses.push(po?.status, po?.status_text, po?.status_name, po?.claim_status, po?.claim_type);
  });
  return statuses.filter(status => status !== null && status !== undefined && status !== '');
}

function addCancelText(out, value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text || text.length > 200) return;
  if (isCancelStatus(text)) return;
  if (/^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}/.test(text)) return;
  if (out.seen.has(text)) return;
  out.seen.add(text);
  out.texts.push(text);
}

function addCancelTime(out, value) {
  const text = String(value || '').trim();
  if (!text || out.timeSeen.has(text)) return;
  out.timeSeen.add(text);
  out.times.push(text);
}

function collectCancelInfo(node, out, path = '', depth = 0) {
  if (!node || depth > 5) return;
  if (Array.isArray(node)) {
    node.forEach((item, idx) => collectCancelInfo(item, out, `${path}[${idx}]`, depth + 1));
    return;
  }
  if (typeof node !== 'object') return;

  Object.keys(node).forEach(key => {
    const value = node[key];
    const keyLower = String(key || '').toLowerCase();
    const nextPath = path ? `${path}.${key}` : String(key);
    const pathLower = nextPath.toLowerCase();
    const isClaimPath = /claim|cancel|refund|return|exchange|취소|환불|반품|교환|클레임/.test(pathLower);
    const isReasonKey = /reason|cause|사유/.test(keyLower);
    const isDetailKey = /memo|message|msg|comment|content|detail|description|title|name|text|메모|내용|상세/.test(keyLower);
    const isTimeKey = /time|date|at|일시|시간|날짜/.test(keyLower);

    if (value !== null && typeof value === 'object') {
      collectCancelInfo(value, out, nextPath, depth + 1);
      return;
    }
    if (isReasonKey || (isClaimPath && isDetailKey)) addCancelText(out, value);
    if (isClaimPath && isTimeKey) addCancelTime(out, value);
  });
}

function cancelInfoForOrder(order, prodOrders) {
  const out = { texts: [], times: [], seen: new Set(), timeSeen: new Set() };
  collectCancelInfo(order, out, 'order', 0);
  collectCancelInfo(prodOrders || [], out, 'prodOrders', 0);
  return {
    cancelReason: out.texts[0] || '',
    cancelReasonDetail: out.texts.slice(1, 4).join(' / '),
    cancelReasonText: out.texts.slice(0, 4).join(' / '),
    cancelRequestedAt: out.times[0] || ''
  };
}

function addOptionValue(values, seen, value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text || text.length > 200) return;
  if (/^\d+$/.test(text)) return;
  if (/^[\d,]+원$/.test(text)) return;
  if (seen.has(text)) return;
  seen.add(text);
  values.push(text);
}

function collectOptionValues(node, values, seen, keyName = '', depth = 0) {
  if (!node || depth > 6) return;

  if (Array.isArray(node)) {
    node.forEach(item => collectOptionValues(item, values, seen, keyName, depth + 1));
    return;
  }

  if (typeof node !== 'object') {
    if (/value|name|text|option|옵션|선택|요일|횟수|세트/i.test(String(keyName || ''))) {
      addOptionValue(values, seen, node);
    }
    return;
  }

  Object.keys(node).forEach(key => {
    const value = node[key];
    if (Array.isArray(value) && /value_name_list|value_list|values|option_values/i.test(key)) {
      value.forEach(entry => {
        if (entry !== null && typeof entry === 'object') {
          collectOptionValues(entry, values, seen, key, depth + 1);
        } else {
          addOptionValue(values, seen, entry);
        }
      });
      return;
    }
    if (value !== null && typeof value === 'object') {
      collectOptionValues(value, values, seen, key, depth + 1);
      return;
    }
    if (/value_name|value_text|option_value|option_name|name|title|text|content|label|value|옵션|선택|요일|횟수|세트/i.test(key)) {
      addOptionValue(values, seen, value);
    }
  });
}

function optionValues(item) {
  const values = [];
  collectOptionValues(item?.options, values, new Set(), '', 0);
  return values;
}

function parseDoor(text) {
  const source = String(text || '');
  const labeled =
    source.match(/(?:공동\s*)?현관\s*(?:비밀\s*번호|비밀번호|비번)?[^#\d*]{0,40}([#\d*]{2,30})/i)
    || source.match(/(?:비밀\s*번호|비밀번호|비번)[^#\d*]{0,40}([#\d*]{2,30})/i);
  if (labeled) return labeled[1].trim();
  const standalone = source.match(/(?:^|\s)(#[\d#*]{2,30})(?=\s|$)/);
  return standalone ? standalone[1].trim() : '';
}

// 첫 줄은 주문번호 그대로다. 예전에 한 건만 등록된 주문과 중복되지 않게 하려는 규칙이다.
function buildSyncKey(orderNo, itemIdx) {
  return itemIdx <= 1 ? String(orderNo || '') : `${String(orderNo || '')}-${itemIdx}`;
}

function normalizeAmount(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
  const cleaned = String(value).replace(/[₩원,\s]/g, '').trim();
  if (!/^\d+(?:\.\d+)?$/.test(cleaned)) return null;
  const amount = Number(cleaned);
  return Number.isFinite(amount) && amount >= 0 ? Math.round(amount) : null;
}

function nestedValue(obj, path) {
  let value = obj;
  for (const key of path) {
    if (value === null || value === undefined) return undefined;
    value = value[key];
  }
  return value;
}

function orderAmount(order) {
  const paths = [
    ['payment', 'payment_amount'], ['payment', 'pay_price'], ['payment', 'total_price'],
    ['payment', 'total_amount'], ['payment', 'amount'], ['payment', 'price'],
    ['order_info', 'payment', 'payment_amount'], ['order_info', 'payment', 'pay_price'],
    ['order_info', 'payment', 'total_price'], ['payment_amount'], ['pay_price'],
    ['total_price'], ['total_amount'], ['order_price']
  ];
  for (const path of paths) {
    const amount = normalizeAmount(nestedValue(order, path));
    if (amount !== null) return amount;
  }
  return null;
}

function orderDate(order) {
  const raw = String(order?.order_date || '').trim();
  let match = raw.match(/^(\d{4})(\d{2})(\d{2})/);
  if (match) return `${match[1]}-${match[2]}-${match[3]}`;
  match = raw.match(/^(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
  if (match) return `${match[1]}-${String(match[2]).padStart(2, '0')}-${String(match[3]).padStart(2, '0')}`;
  const timestamp = Number(order?.order_time);
  if (timestamp) {
    const millis = timestamp > 1000000000000 ? timestamp : timestamp * 1000;
    const dt = new Date(millis + 9 * 3600000);
    return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
  }
  return '';
}

function buildBase(order, isDirect, prod, memo, door, actualOrderNum, syncKey, now = new Date()) {
  const address = order?.delivery?.address || {};
  const base = {
    name: address.name || order?.orderer?.name || '',
    phone: address.phone || order?.orderer?.call || '',
    addr: [address.address, address.address_detail].filter(Boolean).join(' '),
    door,
    request: memo,
    memo: `아임웹 자동등록 / 주문번호: ${actualOrderNum}`,
    set: prod,
    productId: prod,
    orderNum: String(actualOrderNum || ''),
    orderDate: orderDate(order),
    orderSource: 'imweb_auto',
    syncKey: String(syncKey || actualOrderNum || ''),
    status: 'active',
    deliveredDates: [],
    createdAt: now.toISOString(),
    isDirect,
    autoRegistered: true
  };
  const amount = orderAmount(order);
  if (amount !== null) base.orderAmount = amount;
  return base;
}

function parseProd(text) {
  if (/수제.*돼지.*갈비|돼지.*양념.*갈비|수제양념돼지갈비/.test(text)) return 'pork_rib';
  if (/양념.*LA.*갈비|LA.*갈비|라갈비/.test(text)) return 'beef_la';
  if (/소고기.*무국|무국/.test(text)) return 'beef_soup';
  const match = text.match(/([ABC])세트/i);
  return match ? match[1].toUpperCase() : '';
}

function formatUtcDate(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

// 단품은 12시 이전 주문이면 당일, 이후면 다음날 출고한다.
function singleProdDate(orderTimestamp, now = new Date()) {
  if (!orderTimestamp) {
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }
  const dt = new Date((orderTimestamp + 9 * 3600) * 1000);
  if (dt.getUTCHours() < 12) return formatUtcDate(dt);
  return formatUtcDate(new Date(dt.getTime() + 86400000));
}

function buildValidDateString(year, month, day) {
  if (!year || !month || !day) return '';
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (dt.getUTCFullYear() !== year || (dt.getUTCMonth() + 1) !== month || dt.getUTCDate() !== day) return '';
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function parseDateFromProdName(prodName, orderTime) {
  const match = String(prodName || '').match(/(\d{1,2})월[\s.\-]*(\d{1,2})일/);
  if (!match) return { date: '', reason: '상품명에서 날짜를 찾지 못했습니다' };
  const base = orderTime ? new Date((orderTime + 9 * 3600) * 1000) : new Date();
  let year = base.getUTCFullYear();
  const month = parseInt(match[1], 10);
  const day = parseInt(match[2], 10);
  const baseMonth = base.getUTCMonth() + 1;
  if (baseMonth === 12 && month === 1) year++;
  if (baseMonth === 1 && month === 12) year--;
  const date = buildValidDateString(year, month, day);
  if (!date) return { date: '', reason: '상품명 날짜가 실제 달력에 없는 날짜입니다' };
  return { date, reason: '' };
}

function parseDirectHopeDateInfo(values, orderTime) {
  const joined = (values || []).join(' ');
  const base = orderTime ? new Date((orderTime + 9 * 3600) * 1000) : new Date();
  const baseMonth = base.getUTCMonth() + 1;
  let month = null;
  let day = null;
  let hasDateLikeToken = false;
  let dayOnly = false;

  let match = joined.match(/배송희망날짜[^\d]*(\d{1,2})\s*[/.\-]\s*(\d{1,2})/)
    || joined.match(/배송\s*희망\s*날짜[^\d]*(\d{1,2})\s*[/.\-]\s*(\d{1,2})/)
    || joined.match(/배송희망일[^\d]*(\d{1,2})\s*[/.\-]\s*(\d{1,2})/);
  if (match) { month = parseInt(match[1], 10); day = parseInt(match[2], 10); hasDateLikeToken = true; }

  if (month === null) {
    match = joined.match(/(\d{1,2})월\s*(\d{1,2})일/);
    if (match) { month = parseInt(match[1], 10); day = parseInt(match[2], 10); hasDateLikeToken = true; }
  }

  if (month === null) {
    for (const value of values || []) {
      const text = String(value || '').trim();
      const mm = text.match(/^(\d{1,2})\s*[/.\-]\s*(\d{1,2})(?:\D.*)?$/)
        || text.match(/(?:^|\s)(\d{1,2})\s*[/.\-]\s*(\d{1,2})(?=\s|$|[가-힣])/);
      if (mm) { month = parseInt(mm[1], 10); day = parseInt(mm[2], 10); hasDateLikeToken = true; break; }
    }
  }

  if (month === null) {
    match = joined.match(/배송\s*희망\s*(?:날짜|일)[^\d]*(\d{1,2})\s*일/)
      || joined.match(/배송희망(?:날짜|일)[^\d]*(\d{1,2})\s*일/);
    if (match) { month = baseMonth; day = parseInt(match[1], 10); dayOnly = true; hasDateLikeToken = true; }
  }

  if (month === null) {
    for (const value of values || []) {
      const dm = String(value || '').trim().match(/^(\d{1,2})\s*일(?:\D.*)?$/);
      if (dm) { month = baseMonth; day = parseInt(dm[1], 10); dayOnly = true; hasDateLikeToken = true; break; }
    }
  }

  if (month === null || day === null) {
    return { date: '', reason: '직배송 희망날짜를 찾지 못했습니다', invalid: false };
  }

  let year = base.getUTCFullYear();
  if (dayOnly) {
    const candidate = new Date(Date.UTC(year, month - 1, day));
    const baseDate = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate()));
    if (candidate < baseDate) {
      month++;
      if (month > 12) { month = 1; year++; }
    }
  } else {
    if (baseMonth === 12 && month === 1) year++;
    if (baseMonth === 1 && month === 12) year--;
  }

  const date = buildValidDateString(year, month, day);
  if (!date) {
    return { date: '', reason: '직배송 희망날짜가 실제 달력에 없는 날짜입니다', invalid: hasDateLikeToken };
  }
  return { date, reason: '', invalid: false };
}

function matchSchedule(optionText) {
  const normalized = String(optionText || '').replace(/요일/g, '');
  const match = normalized.match(/([가-힣\w/·]+)\s*조리/);
  if (!match) return null;

  const DAY_MAP = { 월: 1, 화: 2, 수: 3, 목: 4, 금: 5, 토: 6, 일: 0 };
  const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];
  const SCH_IDX = {
    1: { 1: 0, 2: 1, 3: 2, 4: 3, 5: 4 },
    2: { '1,3': 0, '1,4': 1, '2,4': 2, '3,5': 3, '1,5': 4 },
    3: { '1,3,5': 0, '2,4,5': 1 }
  };

  const daysKr = match[1].match(/[월화수목금토일]/g);
  if (!daysKr || !daysKr.length) return null;

  const cookDays = daysKr.map(day => DAY_MAP[day]);
  const arriveDays = cookDays.map(day => (day === 6 ? 0 : day + 1));
  const freq = String(Math.min(daysKr.length, 3));
  const cookKey = cookDays.slice().sort((a, b) => a - b).join(',');
  const schIdx = freq === '1'
    ? (SCH_IDX[1][cookDays[0]] !== undefined ? SCH_IDX[1][cookDays[0]] : 0)
    : (SCH_IDX[freq]?.[cookKey] !== undefined ? SCH_IDX[freq][cookKey] : 0);

  return {
    freq,
    schIdx,
    scheduleName: `${daysKr.join('·')} 조리 → ${arriveDays.map(day => DAY_NAMES[day]).join('·')} 도착`,
    cookDays,
    arriveDays
  };
}

// 조리 전날 12시가 마감이다. 그 마감을 넘기지 않는 첫 조리일을 찾는다.
function firstShipDate(cookDays, orderTimestamp) {
  const orderDateTime = new Date((orderTimestamp + 9 * 3600) * 1000);
  const orderHour = orderDateTime.getUTCHours();
  const orderDateStr = formatUtcDate(orderDateTime);
  const addDay = (date, days) => new Date(date.getTime() + days * 86400000);

  for (let i = 0; i < 14; i++) {
    const candidate = addDay(orderDateTime, i);
    if (!cookDays.includes(candidate.getUTCDay())) continue;
    const prevDayStr = formatUtcDate(addDay(candidate, -1));
    if (orderDateStr < prevDayStr) return formatUtcDate(candidate);
    if (orderDateStr === prevDayStr && orderHour < 12) return formatUtcDate(candidate);
  }
  return '';
}

function parseOnceItem(order, item, itemIdx, actualOrderNum, syncKey, options = {}) {
  const log = options.log || (() => {});
  const now = options.now || new Date();
  const memo = order?.delivery?.memo || '';
  const isDirect = item?.delivery?.deliv_type === 'direct';
  const prodName = item?.prod_name || '';
  const qty = Math.max(1, parseInt(item?.payment?.count || 1, 10));
  const values = optionValues(item);
  const optText = values.join(' ');

  const prod = parseProd(`${prodName} ${optText}`);
  if (!prod) {
    log(`⚠ 상품 미인식: "${prodName}"`);
    return null;
  }

  const label = PRODUCT_LABELS[prod] || prod;
  const door = parseDoor([memo, optText].filter(Boolean).join(' '));
  const orderTs = order?.order_time || 0;

  let onceDate = '';
  let reviewReason = '';
  if (isDirect) {
    const info = parseDirectHopeDateInfo(values, orderTs);
    onceDate = info.date;
    if (!onceDate) reviewReason = info.reason || '직배송 희망날짜를 확인할 수 없습니다';
  } else if (prod in SINGLE_PROD_MAP) {
    onceDate = singleProdDate(orderTs, now);
  } else {
    const info = parseDateFromProdName(prodName, orderTs);
    onceDate = info.date;
    if (!onceDate) reviewReason = info.reason || '세트 배송일을 상품명에서 확인할 수 없습니다';
  }

  const base = buildBase(order, isDirect, prod, memo, door, actualOrderNum, syncKey, now);

  if (!onceDate) {
    return {
      ...base,
      orderType: 'once',
      total: qty,
      remain: qty,
      qty,
      onceDate: '',
      startDate: '',
      scheduleName: `${label} / 배송일 확인 필요`,
      arriveDays: [],
      cookDays: [],
      status: 'pause',
      needsReview: true,
      reviewReason
    };
  }

  return {
    ...base,
    orderType: 'once',
    total: qty,
    remain: qty,
    qty,
    onceDate,
    startDate: onceDate,
    scheduleName: label + (qty > 1 ? ` x${qty}개` : ''),
    arriveDays: [],
    cookDays: [],
    needsReview: false,
    reviewReason: ''
  };
}

function parseSubItem(order, item, actualOrderNum, syncKey, options = {}) {
  const log = options.log || (() => {});
  const now = options.now || new Date();
  const memo = order?.delivery?.memo || '';
  const isDirect = item?.delivery?.deliv_type === 'direct';
  const prodName = item?.prod_name || '';
  const optText = optionValues(item).join(' ');

  const prod = parseProd(`${prodName} ${optText}`);
  if (!prod) {
    log(`⚠ 정기 상품 미인식: "${prodName}" | 옵션: "${optText.slice(0, 100)}"`);
    return null;
  }

  const door = parseDoor([memo, optText].filter(Boolean).join(' '));
  const totalMatch = optText.match(/총\s*(\d+)회/);
  const total = totalMatch ? parseInt(totalMatch[1], 10) : 12;
  const schedule = matchSchedule(optText);
  const base = buildBase(order, isDirect, prod, memo, door, actualOrderNum, syncKey, now);

  if (schedule) {
    const startDate = firstShipDate(schedule.cookDays, order?.order_time || 0);
    if (startDate) {
      return {
        ...base,
        orderType: 'sub',
        type: parseInt(schedule.freq, 10),
        total,
        remain: total,
        startDate,
        scheduleName: schedule.scheduleName,
        cookDays: schedule.cookDays,
        arriveDays: schedule.arriveDays,
        needsReview: false,
        reviewReason: ''
      };
    }
  }

  return {
    ...base,
    orderType: 'sub',
    total,
    remain: total,
    startDate: '',
    scheduleName: '정기배송 일정 확인 필요',
    cookDays: [],
    arriveDays: [],
    status: 'pause',
    needsReview: true,
    reviewReason: '정기배송 일정/첫 배송일을 확인할 수 없습니다'
  };
}

function isSubItem(item) {
  return /정기구독|정기배송/.test(`${item?.prod_name || ''} ${optionValues(item).join(' ')}`);
}

// 한 주문에 상품 줄이 여러 개면 줄마다 따로 문서를 만든다.
// 예전 앱스스크립트는 첫 줄이 정기구독이면 나머지 줄을 전부 합쳐 한 건만 등록했다.
// 그래서 '반찬 정기구독' 두 줄(월·수·금 + 화·목)이 오면 뒤쪽 일정이 통째로 사라졌다.
function parseOrderItems(order, orderNo, items, options = {}) {
  return (items || []).map((item, idx) => {
    const itemIdx = idx + 1;
    const syncKey = buildSyncKey(orderNo, itemIdx);
    const sub = isSubItem(item);
    const parsed = sub
      ? parseSubItem(order, item, orderNo, syncKey, options)
      : parseOnceItem(order, item, itemIdx, orderNo, syncKey, options);
    return { syncKey, itemIdx, isSub: sub, parsed };
  });
}

module.exports = {
  HOLD_QUERY_STATUSES,
  PRODUCT_LABELS,
  SINGLE_PROD_MAP,
  buildSyncKey,
  cancelInfoForOrder,
  firstShipDate,
  isAllowStatus,
  isCancelStatus,
  isSubItem,
  isTerminalStatus,
  matchSchedule,
  normalizeAmount,
  optionValues,
  orderAmount,
  orderDate,
  orderStatuses,
  parseDateFromProdName,
  parseDirectHopeDateInfo,
  parseDoor,
  parseOnceItem,
  parseOrderItems,
  parseProd,
  parseSubItem,
  singleProdDate
};
