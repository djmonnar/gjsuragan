// ════════════════════════════════════════
// 궁중수라간 · 아임웹 → Firebase 자동 연동 v4
// - 한 주문에 여러 상품 → 각각 분리 등록
// - 단품(돼지갈비/LA갈비/소고기무국): 12시 이전→당일, 이후→다음날
// - 세트: 상품명에서 날짜 파싱
// - 현관비밀번호: 배송메모 + 옵션값에서 함께 파싱
// ════════════════════════════════════════

const CONFIG = {
  IMWEB_API_KEY    : 'f4c170bec9ca844a18e00057eed5c55cd9c386ed89',
  IMWEB_SECRET_KEY : '0f1de9c3db89406396c91a',
  PROJECT_ID       : 'gjsuragan-60505',
  CLIENT_EMAIL     : 'firebase-adminsdk-fbsvc@gjsuragan-60505.iam.gserviceaccount.com',
  PRIVATE_KEY      : '-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDODxBqvve4A9EV\n8HQtnhfCx0YYPooxvgQ9ivjldZQhMA4WeMXS2Nl+8XoDus7GzBCZ9/g7h03quoAc\nZzX6dPII1xkILg1PlV+sPm/xRtIdjlT6iOPJ+xeIAUNzcivUzEbkjiO8xdeWJW1N\nZLJILwz9v0oDSDIBMPIwCkhbAQ7G56qhw3e73UkUTSA1OyC6jZZgX26ApFaui2oN\nxpOwZiwV1gwtWTurlfREVrd9XLXWnOtUQSAedXgXKZrrN0QOuWma+KlimtkProtZ\ntsHsKnRDmaIOzAcUxzWanBx9YYBeZzFy3zKy3nOq3/RjyTzn6HBz/w/CQ1W8j1lP\nSGo0arp/AgMBAAECggEADr0gb9I1sSbXZ29UkAgVK6x0mhAByH8OmexSfe8uvOpN\nXP7J1O6ygpROeu0mFILM09vbGJRGrCR852CGiYygh1CuDK9mlQEFNTJzcARLISwT\nbfwpTELhMwGMITooYnHeHEOtJg0srM5ZMXD4w5WsozXHMHw91Lyl2257hcQ0mgt1\nMGRDzy2rZ9qI0H27+ej+r3wXvAu/X/R8Lvra852zv9/cM9pq/mKA+alUmbxSTtFa\nyzx8yC0cro1dJS/1BeAnCgawZYmYhzC7Z04NMxN0dcejWOnAITCupRq1euabpQd0\n21ZEZEQyuiRXw0n6PlN8mHolo/wqyqQABQxj8dEqmQKBgQDnv71mWhKzved83hFM\nB5vbH4mA14mOWEfBK0OQR5tYGyaMDxzHqHHLvs/W2boljOsAVdX91Rlhxt2DQRIo\nKGmADsdV7k1sZNmTRxFmzs3xOTbhnCr5S6BNtyte/YsjlEjlz3h3JDwmM5r0wOxw\nw21kobyO3r/zR5kZ43/SSWlJuwKBgQDjnx4/8Pl2b242Qw39bA9s/LYBUCcaDUZT\n/knkvyI0WuVOgp1Jm7LD78QHJ6KPrfY0EWhrqo46aXPPusJqKrsL2h6phxbT5P8+\nAoK9vGPyN29OMFf/6u4nxvfxv1PPutuoV+KbKWN/9n32pTmW6o19q3tGUeSyMzP1\nfiWiJ8g0DQKBgCyehA7SxMsKgylNcDMdO+rCdazy0q8vXBFbDRUYVFZwU8mfl0Dx\ns4cw479QCED2ksBrxlmqz8o9iaSdwKsurLFVJxfqW8nE2Qc8JaOPqaMKCwEBGl0J\nLIIKBDWzxzhAcpCck2sM9O+9+9Wn114Wolc/tJglVvu2C0oqvQ91xunFAoGBAJDl\nvsTnanY5UwhZwTMcsekoKdhGJM4Ruz5GttVV0rlPT3+d5/Bum+rc24XOdk5OaFcW\n6cj4Bpgqft2yvoYE85ME49X5N8/li5H22TFdFqafIUy9u5ce/0H1B+stZ3XqNmBA\nqfEp9LwFtoPnA/UNFMr1+YB3K0VBEQdqqRxDhM+VAoGAJZcD8yF5DPUXB73dfXOQ\nX/FbxomyaA8gj+4sOR/3XzRqk3NzjTFhdhn04WBfboZVu5sDEF4tCHNYq1nBZA47\nOHRNjy4rnK4ZsJgGbQTKGvB+egvjhcfoUx0vyy7T77sEP90ozJBmvuJvwlk/wtpH\nSsydyy5OfUHo4RM6WGCq6iM=\n-----END PRIVATE KEY-----\n',
};

// 아임웹 주문 상태 코드
const CANCEL_STATUS = ['order_cancel', 'pay_cancel', 'refund_req', 'refund_done'];
const ALLOW_STATUS  = ['pay_done', 'delivery_ready', 'delivery', 'complete'];

const SINGLE_PROD_MAP = {
  'pork_rib' : '수제 돼지양념갈비',
  'beef_la'  : '양념 LA갈비',
  'beef_soup': '소고기무국',
};

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

      const status = prodOrders[0].status || '';

      if (CANCEL_STATUS.indexOf(status) !== -1) {
        let deletedAny = false;
        Object.keys(existingMap).forEach(function(key) {
          if (key === orderNo || key.indexOf(orderNo + '-') === 0) {
            deleteFromFirestore(existingMap[key]);
            deletedAny = true;
            deleted++;
          }
        });
        if (deletedAny) Logger.log('🗑 취소 삭제: ' + orderNo);
        continue;
      }

      if (ALLOW_STATUS.indexOf(status) === -1) {
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
        if (existingMap[syncKey]) { skipped++; continue; }
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
          if (existingMap[syncKey]) { skipped++; continue; }

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

  if (month === null || day === null) {
    return {date:'', reason:'직배송 희망날짜를 찾지 못했습니다', invalid:false};
  }
  const base = orderTime ? new Date((orderTime + 9*3600)*1000) : new Date();
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
  const res = UrlFetchApp.fetch('https://api.imweb.me/v2/auth', {
    method:'post', contentType:'application/json',
    payload:JSON.stringify({key:CONFIG.IMWEB_API_KEY, secret:CONFIG.IMWEB_SECRET_KEY}),
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
  const now = Math.floor(Date.now()/1000);
  const claim = {
    iss:CONFIG.CLIENT_EMAIL, sub:CONFIG.CLIENT_EMAIL,
    aud:'https://oauth2.googleapis.com/token',
    iat:now, exp:now+3600,
    scope:'https://www.googleapis.com/auth/datastore',
  };
  const header  = Utilities.base64EncodeWebSafe(JSON.stringify({alg:'RS256',typ:'JWT'}));
  const payload = Utilities.base64EncodeWebSafe(JSON.stringify(claim));
  const toSign  = header+'.'+payload;
  const key     = CONFIG.PRIVATE_KEY.replace(/\\n/g,'\n');
  const sig     = Utilities.base64EncodeWebSafe(Utilities.computeRsaSha256Signature(toSign,key));
  const res = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', {
    method:'post', contentType:'application/x-www-form-urlencoded',
    payload:'grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion='+toSign+'.'+sig,
    muteHttpExceptions:true,
  });
  return JSON.parse(res.getContentText()).access_token;
}

function saveToFirestore(data) {
  const token = getFirebaseToken();
  const url = 'https://firestore.googleapis.com/v1/projects/'+CONFIG.PROJECT_ID+'/databases/(default)/documents/customers';
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

function deleteFromFirestore(docId) {
  const token = getFirebaseToken();
  UrlFetchApp.fetch(
    'https://firestore.googleapis.com/v1/projects/'+CONFIG.PROJECT_ID+'/databases/(default)/documents/customers/'+docId,
    {method:'delete', headers:{Authorization:'Bearer '+token}, muteHttpExceptions:true}
  );
}

function getExistingOrders() {
  const token = getFirebaseToken();
  const map = {};
  let pageToken = '';

  while (true) {
    let url = 'https://firestore.googleapis.com/v1/projects/'+CONFIG.PROJECT_ID+'/databases/(default)/documents/customers?pageSize=1000';
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
        map[key] = parts[parts.length-1];
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
