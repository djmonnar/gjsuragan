// ════════════════════════════════════════
// 궁중수라간 · 아임웹 → Firebase 자동 연동 v4
// - 한 주문에 여러 상품 → 각각 분리 등록
// - 단품(돼지갈비/LA갈비/소고기무국): 12시 이전→당일, 이후→다음날
// - 세트: 상품명에서 날짜 파싱
// - 현관비밀번호: 배송메모 + 옵션값에서 함께 파싱
// ════════════════════════════════════════

const CONFIG = getAppConfig_();

function getScriptProperty_(name) {
  return String(PropertiesService.getScriptProperties().getProperty(name) || '').trim();
}

function getAppConfig_() {
  return {
    IMWEB_API_KEY: getScriptProperty_('IMWEB_API_KEY'),
    IMWEB_SECRET_KEY: getScriptProperty_('IMWEB_SECRET_KEY'),
    PROJECT_ID: getScriptProperty_('FIREBASE_PROJECT_ID'),
    CLIENT_EMAIL: getScriptProperty_('FIREBASE_CLIENT_EMAIL'),
    PRIVATE_KEY: getScriptProperty_('FIREBASE_PRIVATE_KEY')
  };
}

function requireConfig_(name) {
  const value = CONFIG[name];
  if (!value) throw new Error('Script Properties에 ' + name + ' 값이 없습니다.');
  return value;
}

// 아임웹 주문 상태 코드
const CANCEL_STATUS = [
  'order_cancel', 'pay_cancel', 'refund_req', 'refund_done',
  'cancel_req', 'cancel_request', 'cancel_done', 'CANCEL_REQUEST', 'CANCEL',
  '취소접수', '취소요청', '취소완료', '환불요청', '환불완료'
];
const ALLOW_STATUS  = [
  'pay_done', 'pay_complete', 'payment_complete',
  'delivery_ready', 'delivery', 'delivering', 'delivered', 'complete', 'standby',
  'PAY_DONE', 'PAY_COMPLETE', 'PAYMENT_COMPLETE',
  'DELIVERY_READY', 'DELIVERY', 'DELIVERING', 'DELIVERED', 'COMPLETE', 'STANDBY'
];

const SINGLE_PROD_MAP = {
  'pork_rib' : '수제 돼지양념갈비',
  'beef_la'  : '양념 LA갈비',
  'beef_soup': '소고기무국',
};

function normalizeOrderStatus(status) {
  return String(status || '').replace(/\s+/g, '').toLowerCase();
}

function isCancelStatus(status) {
  const normalized = normalizeOrderStatus(status);
  if (!normalized) return false;

  for (var i = 0; i < CANCEL_STATUS.length; i++) {
    if (normalizeOrderStatus(CANCEL_STATUS[i]) === normalized) return true;
  }

  return /cancel|refund|취소|환불/.test(normalized);
}

function isAllowStatus(status) {
  const normalized = normalizeOrderStatus(status);
  if (!normalized) return false;

  for (var i = 0; i < ALLOW_STATUS.length; i++) {
    if (normalizeOrderStatus(ALLOW_STATUS[i]) === normalized) return true;
  }

  return /complete|paydone|paycomplete|delivery|delivering|delivered|standby|결제완료|배송준비|배송중|배송완료/.test(normalized);
}

function getImwebOrderStatuses(order, prodOrders) {
  const statuses = [
    order && order.status,
    order && order.order_status,
    order && order.payment_status,
    order && order.status_text,
    order && order.status_name,
    order && order.order_status_text,
    order && order.claim_status,
    order && order.claim_type
  ];

  (prodOrders || []).forEach(function(po) {
    statuses.push(po && po.status);
    statuses.push(po && po.status_text);
    statuses.push(po && po.status_name);
    statuses.push(po && po.claim_status);
    statuses.push(po && po.claim_type);
  });

  return statuses.filter(function(status) { return status !== null && status !== undefined && status !== ''; });
}

function addImwebCancelInfoText(out, value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text || text.length > 200) return;
  if (isCancelStatus(text)) return;
  if (/^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}/.test(text)) return;
  if (out.seen[text]) return;
  out.seen[text] = true;
  out.texts.push(text);
}

function addImwebCancelInfoTime(out, value) {
  const text = String(value || '').trim();
  if (!text || out.timeSeen[text]) return;
  out.timeSeen[text] = true;
  out.times.push(text);
}

function collectImwebCancelInfo(node, out, path, depth) {
  if (!node || depth > 5) return;
  if (Array.isArray(node)) {
    node.forEach(function(item, idx) {
      collectImwebCancelInfo(item, out, path + '[' + idx + ']', depth + 1);
    });
    return;
  }
  if (typeof node !== 'object') return;

  Object.keys(node).forEach(function(key) {
    const value = node[key];
    const keyText = String(key || '');
    const keyLower = keyText.toLowerCase();
    const nextPath = path ? path + '.' + keyText : keyText;
    const pathLower = nextPath.toLowerCase();
    const isClaimPath = /claim|cancel|refund|return|exchange|취소|환불|반품|교환|클레임/.test(pathLower);
    const isReasonKey = /reason|cause|사유/.test(keyLower);
    const isDetailKey = /memo|message|msg|comment|content|detail|description|title|name|text|메모|내용|상세/.test(keyLower);
    const isTimeKey = /time|date|at|일시|시간|날짜/.test(keyLower);

    if (value !== null && typeof value === 'object') {
      collectImwebCancelInfo(value, out, nextPath, depth + 1);
      return;
    }

    if (isReasonKey || (isClaimPath && isDetailKey)) {
      addImwebCancelInfoText(out, value);
    }
    if (isClaimPath && isTimeKey) {
      addImwebCancelInfoTime(out, value);
    }
  });
}

function getImwebCancelInfo(order, prodOrders) {
  const out = {texts:[], times:[], seen:{}, timeSeen:{}};
  collectImwebCancelInfo(order, out, 'order', 0);
  collectImwebCancelInfo(prodOrders || [], out, 'prodOrders', 0);
  return {
    cancelReason:out.texts[0] || '',
    cancelReasonDetail:out.texts.slice(1, 4).join(' / '),
    cancelReasonText:out.texts.slice(0, 4).join(' / '),
    cancelRequestedAt:out.times[0] || '',
  };
}

function syncImwebOrders() {
  try {
    Logger.log('=== 아임웹 주문 동기화 시작 ===');
    const token = getImwebToken();
    if (!token) { Logger.log('토큰 발급 실패'); return; }

    const orders = getImwebOrders(token);
    const existingMap = getExistingOrders();
    Logger.log('아임웹: ' + orders.length + '건 / Firebase 기존: ' + Object.keys(existingMap).length + '건');

    let saved = 0, deleted = 0, skipped = 0;

    for (const order of orders) {
      const orderNo = String(order.order_no || '');
      const prodOrders = getOrderProdOrders(token, orderNo);
      if (!prodOrders || !prodOrders.length) { skipped++; continue; }

      const statuses = getImwebOrderStatuses(order, prodOrders);
      const status = statuses[0] || '';

      if (statuses.some(isCancelStatus)) {
        const cancelInfo = getImwebCancelInfo(order, prodOrders);
        const recordsToDelete = [];
        Object.keys(existingMap).forEach(function(key) {
          if (key === orderNo || key.indexOf(orderNo + '-') === 0) {
            const records = Array.isArray(existingMap[key]) ? existingMap[key] : [existingMap[key]];
            records.forEach(function(record) {
              recordsToDelete.push(record);
            });
          }
        });
        if (recordsToDelete.length) {
          recordImwebCancel(orderNo, status, recordsToDelete, cancelInfo);
          recordsToDelete.forEach(function(record) {
            deleteFromFirestore(record.id || record);
            deleted++;
          });
          Logger.log('🗑 취소 삭제: ' + orderNo + (cancelInfo.cancelReasonText ? ' / 사유: ' + cancelInfo.cancelReasonText : ''));
        }
        continue;
      }

      if (!statuses.some(isAllowStatus)) {
        Logger.log('⏸ 건너뜀: ' + orderNo + ' (' + status + ')');
        skipped++;
        continue;
      }

      const allItems = [];
      prodOrders.forEach(function(po) {
        (po.items || []).forEach(function(item) { allItems.push(item); });
      });
      if (!allItems.length) { skipped++; continue; }

      const firstProdName = allItems[0].prod_name || '';
      const firstOptVals  = getOptionValues(allItems[0]);
      const firstOptText  = firstOptVals.join(' ');
      const isSub = /정기구독|정기배송/.test(firstProdName + ' ' + firstOptText);

      if (isSub) {
        const syncKey = orderNo;
        if (existingMap[syncKey]) {
          Logger.log('⏭ 이미등록(정기): ' + syncKey);
          skipped++; continue;
        }
        const parsed = parseSubOrder(order, allItems, orderNo, syncKey);
        if (!parsed) { skipped++; continue; }
        saveToFirestore(parsed);
        saved++;
        Logger.log('✅ 정기 등록: ' + parsed.name + ' / ' + syncKey + ' / ' + parsed.scheduleName);
      } else {
        let itemIdx = 0;
        for (var ii = 0; ii < allItems.length; ii++) {
          const item = allItems[ii];
          itemIdx++;
          const syncKey = buildSyncKey(orderNo, itemIdx);
          if (existingMap[syncKey]) {
            Logger.log('⏭ 이미등록(선택): ' + syncKey);
            skipped++; continue;
          }

          const parsed = parseOnceItem(order, item, itemIdx, orderNo, syncKey);
          if (!parsed) { skipped++; continue; }

          saveToFirestore(parsed);
          saved++;
          Logger.log('✅ 선택 등록: ' + parsed.name + ' / ' + syncKey + ' / ' + parsed.scheduleName);
        }
      }
    }

    Logger.log('=== 완료: 등록 ' + saved + '건 / 삭제 ' + deleted + '건 / 건너뜀 ' + skipped + '건 ===');
  } catch(e) {
    Logger.log('❌ 오류: ' + e.message);
  }
}

function getOptionValues(item) {
  const vals = [];
  (item.options || []).forEach(function(og) {
    // Imweb API는 배열-of-배열 또는 배열-of-객체 두 가지 구조로 올 수 있음
    const optList = Array.isArray(og) ? og : [og];
    optList.forEach(function(opt) {
      if (!opt) return;
      if (Array.isArray(opt.value_name_list) && opt.value_name_list.length) {
        opt.value_name_list.forEach(function(v) { vals.push(String(v)); });
      } else if (opt.value_name) {
        vals.push(String(opt.value_name));
      }
    });
  });
  return vals;
}

function parseDoor(text) {
  const s = String(text || '');
  const labeled =
    s.match(/(?:공동\s*)?현관\s*(?:비밀\s*번호|비밀번호|비번)?[^#\d*]{0,40}([#\d*]{2,30})/i) ||
    s.match(/(?:비밀\s*번호|비밀번호|비번)[^#\d*]{0,40}([#\d*]{2,30})/i);
  if (labeled) return labeled[1].trim();

  const standalone = s.match(/(?:^|\s)(#[\d#*]{2,30})(?=\s|$)/);
  return standalone ? standalone[1].trim() : '';
}

function buildSyncKey(orderNo, itemIdx) {
  return itemIdx <= 1 ? String(orderNo || '') : String(orderNo || '') + '-' + itemIdx;
}

function buildBase(order, isDirect, prod, memo, door, actualOrderNum, syncKey) {
  const addr = (order.delivery && order.delivery.address) || {};
  const name  = addr.name  || (order.orderer && order.orderer.name) || '';
  const phone = addr.phone || (order.orderer && order.orderer.call) || '';
  const address = [addr.address, addr.address_detail].filter(Boolean).join(' ');
  return {
    name:name, phone:phone, addr:address, door:door, request:memo,
    memo:'아임웹 자동등록 / 주문번호: ' + actualOrderNum,
    set:prod, productId:prod,
    orderNum:String(actualOrderNum || ''),
    syncKey:String(syncKey || actualOrderNum || ''),
    status:'active', deliveredDates:[],
    createdAt:new Date().toISOString(),
    isDirect:isDirect, autoRegistered:true,
  };
}

function parseProd(text) {
  if (/수제.*돼지.*갈비|돼지.*양념.*갈비|수제양념돼지갈비/.test(text)) return 'pork_rib';
  if (/양념.*LA.*갈비|LA.*갈비|라갈비/.test(text)) return 'beef_la';
  if (/소고기.*무국|무국/.test(text)) return 'beef_soup';
  const m = text.match(/([ABC])세트/i);
  if (m) return m[1].toUpperCase();
  return '';
}

function parseOnceItem(order, item, itemIdx, actualOrderNum, syncKey) {
  try {
    const memo = (order.delivery && order.delivery.memo) || '';
    const isDirect = item.delivery && item.delivery.deliv_type === 'direct';
    const prodName = item.prod_name || '';
    const qty = Math.max(1, parseInt((item.payment && item.payment.count) || 1, 10));
    const optVals = getOptionValues(item);
    const optText = optVals.join(' ');
    const combined = prodName + ' ' + optText;

    let prod = parseProd(combined);
    if (!prod) {
      Logger.log('⚠ 상품 미인식: "' + prodName + '"');
      return null;
    }

    const isSingle = prod in SINGLE_PROD_MAP;
    const pLabel = {
      'A':'A세트','B':'B세트','C':'C세트',
      'pork_rib':'수제 돼지양념갈비','beef_la':'양념 LA갈비','beef_soup':'소고기무국'
    }[prod] || prod;

    const door = parseDoor([memo, optText].filter(Boolean).join(' '));

    let onceDate = '';
    const orderTs = order.order_time || 0;
    let reviewReason = '';

    if (isDirect) {
      const info = parseDirectHopeDateInfo(optVals, orderTs);
      onceDate = info.date;
      if (!onceDate) reviewReason = info.reason || '직배송 희망날짜를 확인할 수 없습니다';
    } else if (isSingle) {
      onceDate = getSingleProdDate(orderTs);
    } else {
      const info = parseDateFromProdName(prodName, orderTs);
      onceDate = info.date;
      if (!onceDate) reviewReason = info.reason || '세트 배송일을 상품명에서 확인할 수 없습니다';
    }

    Logger.log('  아이템' + itemIdx + ': ' + pLabel + ' / ' + (onceDate || 'NO_DATE') + ' / qty:' + qty);

    const base = buildBase(order, isDirect, prod, memo, door, actualOrderNum, syncKey);

    if (!onceDate) {
      return Object.assign(base, {
        orderType:'once', total:qty, remain:qty, qty:qty,
        onceDate:'', startDate:'',
        scheduleName:pLabel + ' / 배송일 확인 필요',
        arriveDays:[], cookDays:[],
        status:'pause', needsReview:true, reviewReason:reviewReason,
      });
    }

    return Object.assign(base, {
      orderType:'once', total:qty, remain:qty, qty:qty,
      onceDate:onceDate, startDate:onceDate,
      scheduleName:pLabel + (qty > 1 ? ' x' + qty + '개' : ''),
      arriveDays:[], cookDays:[],
      needsReview:false, reviewReason:'',
    });
  } catch(e) {
    Logger.log('parseOnceItem 오류: ' + e.message);
    return null;
  }
}

function parseSubOrder(order, items, actualOrderNum, syncKey) {
  try {
    const memo = (order.delivery && order.delivery.memo) || '';
    const isDirect = items.some(function(i) { return i.delivery && i.delivery.deliv_type === 'direct'; });
    const prodNames = items.map(function(i){ return i.prod_name||''; }).join(' ');
    const optVals = [];
    items.forEach(function(item){ getOptionValues(item).forEach(function(v){ optVals.push(v); }); });
    const optText = optVals.join(' ');
    const combined = prodNames + ' ' + optText;

    Logger.log('  [정기] 상품명: ' + prodNames + ' / 옵션값: ' + optText.slice(0,80));
    let prod = parseProd(combined);
    if (!prod) { Logger.log('⚠ 정기 상품 미인식: "' + prodNames + '" | 옵션: "' + optText.slice(0,100) + '"'); return null; }

    const door = parseDoor([memo, optText].filter(Boolean).join(' '));

    const totalM = optText.match(/총\s*(\d+)회/);
    const total  = totalM ? parseInt(totalM[1], 10) : 12;
    const sch    = matchSchedule(optText);
    const base   = buildBase(order, isDirect, prod, memo, door, actualOrderNum, syncKey);

    if (sch) {
      const firstDate = getFirstShipDate(sch.cookDays, order.order_time || 0) || '';
      if (firstDate) {
        return Object.assign(base, {
          orderType:'sub', type:parseInt(sch.freq,10),
          total:total, remain:total, startDate:firstDate,
          scheduleName:sch.scheduleName, cookDays:sch.cookDays, arriveDays:sch.arriveDays,
          needsReview:false, reviewReason:'',
        });
      }
    }

    return Object.assign(base, {
      orderType:'sub', total:total, remain:total,
      startDate:'',
      scheduleName:'정기배송 일정 확인 필요',
      cookDays:[], arriveDays:[],
      status:'pause', needsReview:true,
      reviewReason:'정기배송 일정/첫 배송일을 확인할 수 없습니다',
    });
  } catch(e) {
    Logger.log('parseSubOrder 오류: ' + e.message);
    return null;
  }
}

function getSingleProdDate(orderTimestamp) {
  if (!orderTimestamp) return formatDate(new Date());
  const KST = 9 * 3600;
  const dt   = new Date((orderTimestamp + KST) * 1000);
  const hour = dt.getUTCHours();
  if (hour < 12) {
    return dt.getUTCFullYear() + '-' +
      String(dt.getUTCMonth()+1).padStart(2,'0') + '-' +
      String(dt.getUTCDate()).padStart(2,'0');
  }
  const next = new Date(dt.getTime() + 86400000);
  return next.getUTCFullYear() + '-' +
    String(next.getUTCMonth()+1).padStart(2,'0') + '-' +
    String(next.getUTCDate()).padStart(2,'0');
}

function buildValidDateString(year, month, day) {
  if (!year || !month || !day) return '';
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (dt.getUTCFullYear() !== year || (dt.getUTCMonth() + 1) !== month || dt.getUTCDate() !== day) return '';
  return year + '-' + String(month).padStart(2,'0') + '-' + String(day).padStart(2,'0');
}

function parseDateFromProdName(prodName, orderTime) {
  const m = String(prodName || '').match(/(\d{1,2})월[\s.\-]*(\d{1,2})일/);
  if (!m) return {date:'', reason:'상품명에서 날짜를 찾지 못했습니다'};
  const base = orderTime ? new Date((orderTime + 9*3600)*1000) : new Date();
  let year = base.getUTCFullYear();
  const month = parseInt(m[1], 10);
  const day   = parseInt(m[2], 10);
  const om = base.getUTCMonth() + 1;
  if (om === 12 && month === 1) year++;
  if (om === 1  && month === 12) year--;
  const date = buildValidDateString(year, month, day);
  if (!date) return {date:'', reason:'상품명 날짜가 실제 달력에 없는 날짜입니다'};
  return {date:date, reason:''};
}

function parseDirectHopeDateInfo(optionValues, orderTime) {
  const joined = (optionValues || []).join(' ');
  let month = null, day = null;
  let hasDateLikeToken = false;
  const base = orderTime ? new Date((orderTime + 9*3600)*1000) : new Date();
  const baseMonth = base.getUTCMonth() + 1;

  let m = joined.match(/배송희망날짜[^\d]*(\d{1,2})\s*[\/.\-]\s*(\d{1,2})/)
       || joined.match(/배송\s*희망\s*날짜[^\d]*(\d{1,2})\s*[\/.\-]\s*(\d{1,2})/)
       || joined.match(/배송희망일[^\d]*(\d{1,2})\s*[\/.\-]\s*(\d{1,2})/);
  if (m) { month = parseInt(m[1],10); day = parseInt(m[2],10); hasDateLikeToken = true; }

  if (month === null) {
    m = joined.match(/(\d{1,2})월\s*(\d{1,2})일/);
    if (m) { month = parseInt(m[1],10); day = parseInt(m[2],10); hasDateLikeToken = true; }
  }

  if (month === null) {
    for (var i = 0; i < (optionValues||[]).length; i++) {
      const v = String(optionValues[i]||'').trim();
      const mm = v.match(/^(\d{1,2})\s*[\/.\-]\s*(\d{1,2})(?:\D.*)?$/)
              || v.match(/(?:^|\s)(\d{1,2})\s*[\/.\-]\s*(\d{1,2})(?=\s|$|[가-힣])/);
      if (mm) { month = parseInt(mm[1],10); day = parseInt(mm[2],10); hasDateLikeToken = true; break; }
    }
  }

  if (month === null) {
    m = joined.match(/배송\s*희망\s*(?:날짜|일)[^\d]*(\d{1,2})\s*일/)
     || joined.match(/배송희망(?:날짜|일)[^\d]*(\d{1,2})\s*일/);
    if (m) {
      month = baseMonth;
      day = parseInt(m[1], 10);
      hasDateLikeToken = true;
    }
  }

  if (month === null) {
    for (var j = 0; j < (optionValues||[]).length; j++) {
      const v2 = String(optionValues[j]||'').trim();
      const dm = v2.match(/^(\d{1,2})\s*일(?:\D.*)?$/);
      if (dm) {
        month = baseMonth;
        day = parseInt(dm[1], 10);
        hasDateLikeToken = true;
        break;
      }
    }
  }

  if (month === null || day === null) {
    return {date:'', reason:'직배송 희망날짜를 찾지 못했습니다', invalid:false};
  }
  let year = base.getUTCFullYear();
  const om = base.getUTCMonth() + 1;
  if (om === 12 && month === 1) year++;
  if (om === 1  && month === 12) year--;
  const date = buildValidDateString(year, month, day);
  if (!date) {
    return {date:'', reason:'직배송 희망날짜가 실제 달력에 없는 날짜입니다', invalid:hasDateLikeToken};
  }
  return {date:date, reason:'', invalid:false};
}

function parseDirectHopeDate(optionValues, orderTime) {
  return parseDirectHopeDateInfo(optionValues, orderTime).date;
}

function matchSchedule(optionText) {
  const normalized = optionText.replace(/요일/g, '');
  const m = normalized.match(/([가-힣\w\/·]+)\s*조리/);
  if (!m) return null;

  const DAY_MAP   = {'월':1,'화':2,'수':3,'목':4,'금':5,'토':6,'일':0};
  const DAY_NAMES = ['일','월','화','수','목','금','토'];
  const SCH_IDX   = {
    '1':{1:0,2:1,3:2,4:3,5:4},
    '2':{'1,3':0,'1,4':1,'2,4':2,'3,5':3,'1,5':4},
    '3':{'1,3,5':0,'2,4,5':1},
  };

  const daysKr = m[1].match(/[월화수목금토일]/g);
  if (!daysKr || !daysKr.length) return null;

  const cookDays   = daysKr.map(function(d){ return DAY_MAP[d]; });
  const arriveDays = cookDays.map(function(d){ return d===6?0:d+1; });
  const freq       = String(Math.min(daysKr.length,3));
  const cookKey    = cookDays.slice().sort(function(a,b){return a-b;}).join(',');
  const schIdx     = freq==='1'
    ? (SCH_IDX['1'][cookDays[0]]!==undefined ? SCH_IDX['1'][cookDays[0]] : 0)
    : (SCH_IDX[freq]&&SCH_IDX[freq][cookKey]!==undefined ? SCH_IDX[freq][cookKey] : 0);

  return {
    freq:freq, schIdx:schIdx,
    scheduleName: daysKr.join('·')+' 조리 → '+arriveDays.map(function(d){return DAY_NAMES[d];}).join('·')+' 도착',
    cookDays:cookDays, arriveDays:arriveDays,
  };
}

function getFirstShipDate(cookDays, orderTimestamp) {
  const KST_OFFSET = 9 * 3600;
  const orderDate  = new Date((orderTimestamp + KST_OFFSET) * 1000);
  const orderHour  = orderDate.getUTCHours();
  const CUTOFF     = 12;

  function toStr(d) {
    return d.getUTCFullYear()+'-'+String(d.getUTCMonth()+1).padStart(2,'0')+'-'+String(d.getUTCDate()).padStart(2,'0');
  }
  function addDay(d,n){ return new Date(d.getTime()+n*86400000); }
  const orderDateStr = toStr(orderDate);

  for (var i=0; i<14; i++) {
    const candidate = addDay(orderDate, i);
    if (cookDays.indexOf(candidate.getUTCDay()) === -1) continue;
    const prevDay    = addDay(candidate, -1);
    const prevDayStr = toStr(prevDay);
    if (orderDateStr < prevDayStr) return toStr(candidate);
    if (orderDateStr === prevDayStr && orderHour < CUTOFF) return toStr(candidate);
  }
  return '';
}

function getImwebToken() {
  const imwebKey = requireConfig_('IMWEB_API_KEY');
  const imwebSecret = requireConfig_('IMWEB_SECRET_KEY');
  const res = UrlFetchApp.fetch('https://api.imweb.me/v2/auth', {
    method:'post', contentType:'application/json',
    payload:JSON.stringify({key:imwebKey, secret:imwebSecret}),
    muteHttpExceptions:true,
  });
  const json = JSON.parse(res.getContentText());
  if (json.code !== 200) { Logger.log('토큰 오류: ' + json.msg); return null; }
  return json.access_token || (json.data && json.data.access_token);
}

function getImwebOrders(token) {
  const limit = 100;
  let page = 1;
  const all = [];
  const seen = new Set();
  let lastFirstOrderNo = '';

  while (page <= 20) {
    const url = 'https://api.imweb.me/v2/shop/orders?limit=' + limit + '&page=' + page;
    const res = UrlFetchApp.fetch(url, {
      method:'get', headers:{'Content-Type':'application/json','access-token':token},
      muteHttpExceptions:true,
    });
    const json = JSON.parse(res.getContentText());
    if (json.code !== 200) {
      Logger.log('주문 오류: ' + json.msg);
      break;
    }
    const list = (json.data && json.data.list) || [];
    if (!list.length) break;

    const firstOrderNo = String((list[0] && list[0].order_no) || '');
    if (page > 1 && firstOrderNo && firstOrderNo === lastFirstOrderNo) break;
    lastFirstOrderNo = firstOrderNo;

    list.forEach(function(o){
      const key = String(o.order_no || '');
      if (!seen.has(key)) {
        seen.add(key);
        all.push(o);
      }
    });

    if (list.length < limit) break;
    page++;
  }
  return all;
}

function getOrderProdOrders(token, orderNo) {
  const res = UrlFetchApp.fetch('https://api.imweb.me/v2/shop/orders/'+orderNo+'/prod-orders', {
    method:'get', headers:{'Content-Type':'application/json','access-token':token},
    muteHttpExceptions:true,
  });
  const json = JSON.parse(res.getContentText());
  if (json.code !== 200) return [];
  return json.data || [];
}

function getFirebaseToken() {
  const clientEmail = requireConfig_('CLIENT_EMAIL');
  const privateKey = requireConfig_('PRIVATE_KEY');
  const now = Math.floor(Date.now()/1000);
  const claim = {
    iss:clientEmail, sub:clientEmail,
    aud:'https://oauth2.googleapis.com/token',
    iat:now, exp:now+3600,
    scope:'https://www.googleapis.com/auth/datastore',
  };
  const header  = Utilities.base64EncodeWebSafe(JSON.stringify({alg:'RS256',typ:'JWT'}));
  const payload = Utilities.base64EncodeWebSafe(JSON.stringify(claim));
  const toSign  = header+'.'+payload;
  const key     = privateKey.replace(/\\n/g,'\n');
  const sig     = Utilities.base64EncodeWebSafe(Utilities.computeRsaSha256Signature(toSign,key));
  const res = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', {
    method:'post', contentType:'application/x-www-form-urlencoded',
    payload:'grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion='+toSign+'.'+sig,
    muteHttpExceptions:true,
  });
  return JSON.parse(res.getContentText()).access_token;
}

function saveToFirestore(data, collectionName) {
  const token = getFirebaseToken();
  const collection = collectionName || 'customers';
  const projectId = requireConfig_('PROJECT_ID');
  const url = 'https://firestore.googleapis.com/v1/projects/'+projectId+'/databases/(default)/documents/'+collection;
  function toFsValue(v) {
    if (v===null||v===undefined) return {nullValue:null};
    if (typeof v==='boolean') return {booleanValue:v};
    if (typeof v==='number')  return {integerValue:String(v)};
    if (Array.isArray(v))     return {arrayValue:{values:v.map(toFsValue)}};
    return {stringValue:String(v)};
  }
  const fields = {};
  Object.keys(data).forEach(function(k){ fields[k]=toFsValue(data[k]); });
  const res = UrlFetchApp.fetch(url, {
    method:'post', contentType:'application/json',
    headers:{Authorization:'Bearer '+token},
    payload:JSON.stringify({fields:fields}),
    muteHttpExceptions:true,
  });
  const json = JSON.parse(res.getContentText());
  if (json.error) Logger.log('Firestore 오류: '+JSON.stringify(json.error));
}

function recordImwebCancel(orderNo, status, records, cancelInfo) {
  const list = records || [];
  const info = cancelInfo || {};
  const log = {
    orderNo:String(orderNo || ''),
    cancelStatus:String(status || ''),
    cancelReason:String(info.cancelReason || ''),
    cancelReasonDetail:String(info.cancelReasonDetail || ''),
    cancelReasonText:String(info.cancelReasonText || ''),
    cancelRequestedAt:String(info.cancelRequestedAt || ''),
    source:'apps_script',
    deletedCount:list.length,
    deletedDocIds:list.map(function(r){ return String((r && r.id) || r || ''); }),
    customerNames:list.map(function(r){ return String((r && r.name) || ''); }),
    customerPhones:list.map(function(r){ return String((r && r.phone) || ''); }),
    products:list.map(function(r){ return String((r && r.product) || ''); }),
    schedules:list.map(function(r){ return String((r && r.schedule) || ''); }),
    createdAt:new Date().toISOString(),
    acknowledged:false,
  };
  saveToFirestore(log, 'imwebCancelLogs');
}

function deleteFromFirestore(docId) {
  const token = getFirebaseToken();
  const projectId = requireConfig_('PROJECT_ID');
  UrlFetchApp.fetch(
    'https://firestore.googleapis.com/v1/projects/'+projectId+'/databases/(default)/documents/customers/'+docId,
    {method:'delete', headers:{Authorization:'Bearer '+token}, muteHttpExceptions:true}
  );
}

function getExistingOrders() {
  const token = getFirebaseToken();
  const projectId = requireConfig_('PROJECT_ID');
  const map = {};
  let pageToken = '';

  while (true) {
    let url = 'https://firestore.googleapis.com/v1/projects/'+projectId+'/databases/(default)/documents/customers?pageSize=1000';
    if (pageToken) url += '&pageToken=' + encodeURIComponent(pageToken);
    const res = UrlFetchApp.fetch(url, {
      headers:{Authorization:'Bearer '+token}, muteHttpExceptions:true
    });
    const json = JSON.parse(res.getContentText());

    ((json.documents)||[]).forEach(function(doc) {
      const f = doc.fields || {};
      const key = (f.syncKey && f.syncKey.stringValue) || (f.orderNum && f.orderNum.stringValue) || '';
      if (key) {
        const parts = doc.name.split('/');
        if (!map[key]) map[key] = [];
        map[key].push({
          id:parts[parts.length-1],
          name:(f.name && f.name.stringValue) || '',
          phone:(f.phone && f.phone.stringValue) || '',
          product:(f.productId && f.productId.stringValue) || (f.set && f.set.stringValue) || '',
          schedule:(f.scheduleName && f.scheduleName.stringValue) || (f.onceDate && f.onceDate.stringValue) || '',
        });
      }
    });

    if (!json.nextPageToken) break;
    pageToken = json.nextPageToken;
  }
  return map;
}

function formatDate(d) {
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}

function testRun() {
  Logger.log('=== 테스트 실행 ===');
  syncImwebOrders();
}

function installFiveMinuteSyncTrigger() {
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (trigger.getHandlerFunction && trigger.getHandlerFunction() === 'syncImwebOrders') {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  ScriptApp.newTrigger('syncImwebOrders')
    .timeBased()
    .everyMinutes(5)
    .create();

  Logger.log('syncImwebOrders 5분 자동 동기화 트리거 설치 완료');
}
