/**
 * 궁중수라간 내부 관리자용 카카오 챗봇 스킬 웹훅.
 *
 * 배송 판정은 assets/js/schedule-report.js의 todayStr, addDays,
 * isDelivSub, isDelivOnce, listFor 흐름과 동일하게 유지한다.
 */

var KAKAO_TZ = 'Asia/Seoul';
var KAKAO_ADMIN_URL = 'https://djmonnar.github.io/gjsuragan/admin.html';
var KAKAO_SESSION_TTL = 21600; // 6시간
var KAKAO_MAX_TEXT = 950;
var KAKAO_MAX_DELIVERY_ITEMS = 10;
var KAKAO_MAX_SEARCH_ITEMS = 6;
var KAKAO_MAX_TASK_ITEMS = 5;

function doGet(e) {
  return ContentService
    .createTextOutput('GJSURAGAN Kakao webhook OK')
    .setMimeType(ContentService.MimeType.TEXT);
}

function doPost(e) {
  return kakaoWebhookDoPost_(e);
}

function kakaoWebhookDoPost_(e) {
  try {
    var payload = kakaoParsePayload_(e);
    var utterance = kakaoUtterance_(payload);
    var auth = kakaoCheckAuth_(payload, utterance);

    if (!auth.ok) {
      return kakaoJson_(kakaoTextResponse_(kakaoAuthMessage_(auth)));
    }

    if (auth.justAuthed) {
      return kakaoJson_(kakaoTextResponse_(
        '관리자 인증이 완료되었습니다.\n\n' +
        '조회 명령어\n' +
        '- 오늘할일\n' +
        '- 오늘배송\n' +
        '- 내일배송\n' +
        '- 모레배송\n' +
        '- 요약\n' +
        '- 고객검색 홍길동\n' +
        '- 2026-06-12 배송'
      ));
    }

    var cmd = kakaoResolveCommand_(payload, utterance);
    var customers = kakaoFetchCustomers_();

    if (cmd.type === 'tasks') {
      return kakaoJson_(kakaoTextResponse_(kakaoBuildTodayTasksText_(customers)));
    }

    if (cmd.type === 'summary') {
      return kakaoJson_(kakaoTextResponse_(kakaoBuildSummaryText_(customers)));
    }

    if (cmd.type === 'customer') {
      return kakaoJson_(kakaoTextResponse_(kakaoBuildCustomerSearchText_(customers, cmd.keyword)));
    }

    return kakaoJson_(kakaoTextResponse_(kakaoBuildDeliveryText_(customers, cmd.date, cmd.label)));
  } catch (err) {
    Logger.log('kakaoWebhookDoPost_ 오류: ' + (err && err.stack ? err.stack : err));
    return kakaoJson_(kakaoTextResponse_(
      '조회 중 오류가 발생했습니다.\n' +
      'Apps Script 실행 로그와 Script Properties를 확인해주세요.\n\n' +
      '오류: ' + (err && err.message ? err.message : String(err))
    ));
  }
}

function kakaoParsePayload_(e) {
  if (!e || !e.postData || !e.postData.contents) return {};
  try {
    return JSON.parse(e.postData.contents);
  } catch (err) {
    return {};
  }
}

function kakaoJson_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function kakaoTextResponse_(text) {
  return {
    version: '2.0',
    template: {
      outputs: [
        {
          simpleText: {
            text: kakaoTrimText_(text)
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

function kakaoListCardResponse_(title, items) {
  var buttons = (items || []).slice(0, 5).map(function(item) {
    return {
      title: kakaoShort_(item.title || '-', 24),
      description: kakaoShort_(item.description || '', 34),
      action: 'message',
      messageText: item.messageText || item.title || title
    };
  });

  return {
    version: '2.0',
    template: {
      outputs: [
        {
          listCard: {
            header: { title: kakaoShort_(title || '궁중수라간', 24) },
            items: buttons
          }
        }
      ]
    }
  };
}

function kakaoTrimText_(text) {
  var s = String(text || '');
  if (s.length <= KAKAO_MAX_TEXT) return s;
  return s.slice(0, KAKAO_MAX_TEXT - 24) + '\n...\n일부만 표시했습니다.';
}

function kakaoUtterance_(payload) {
  return String(
    payload && payload.userRequest && payload.userRequest.utterance
      ? payload.userRequest.utterance
      : ''
  ).trim();
}

function kakaoActionParams_(payload) {
  return (payload && payload.action && payload.action.params) ? payload.action.params : {};
}

function kakaoScriptProperty_(name) {
  return String(PropertiesService.getScriptProperties().getProperty(name) || '').trim();
}

function kakaoFirebaseProjectId_() {
  var projectId = kakaoScriptProperty_('FIREBASE_PROJECT_ID');
  if (projectId) return projectId;
  if (typeof requireConfig_ === 'function') return requireConfig_('PROJECT_ID');
  return '';
}

function kakaoAdminPin_() {
  return kakaoScriptProperty_('KAKAO_ADMIN_PIN');
}

function kakaoAllowedUsers_() {
  var raw = kakaoScriptProperty_('KAKAO_ALLOWED_USERS');
  if (!raw) return [];
  return raw.split(',').map(function(id) {
    return String(id || '').trim();
  }).filter(Boolean);
}

function kakaoUserKey_(payload) {
  var user = payload && payload.userRequest && payload.userRequest.user ? payload.userRequest.user : {};
  var props = user.properties || {};
  return String(
    user.id ||
    props.appUserId ||
    props.plusfriendUserKey ||
    props.botUserKey ||
    'anonymous'
  );
}

function kakaoCheckAuth_(payload, utterance) {
  var userKey = kakaoUserKey_(payload);
  var allowedUsers = kakaoAllowedUsers_();
  if (allowedUsers.length && allowedUsers.indexOf(userKey) < 0) {
    return { ok:false, reason:'not_allowed', userKey:userKey };
  }

  var expected = kakaoAdminPin_();
  if (!expected) return { ok:false, reason:'pin_missing' };

  var cache = CacheService.getScriptCache();
  var key = 'gjs-kakao-admin-ok-' + userKey;
  if (cache.get(key) === '1') return { ok:true, justAuthed:false };

  var params = kakaoActionParams_(payload);
  var given = String(params.pin || params.adminPin || '').trim();
  if (!given) {
    var m = String(utterance || '').match(/(?:인증|핀|pin)\s*[:：]?\s*([^\s]+)/i);
    given = m ? String(m[1]).trim() : '';
  }

  if (given && given === expected) {
    cache.put(key, '1', KAKAO_SESSION_TTL);
    return { ok:true, justAuthed:true };
  }

  return { ok:false, reason:'need_auth' };
}

function kakaoAuthMessage_(auth) {
  if (auth.reason === 'not_allowed') {
    return '허용된 관리자 카카오 계정이 아닙니다.\n\n' +
      'Script Properties의 KAKAO_ALLOWED_USERS에 현재 user id를 등록해야 합니다.\n' +
      '현재 user id: ' + (auth.userKey || '-');
  }

  if (auth.reason === 'pin_missing') {
    return '카카오 챗봇 보안 설정이 아직 없습니다.\n\n' +
      'Apps Script Script Properties에 KAKAO_ADMIN_PIN을 먼저 등록해주세요.\n' +
      '고객명, 전화번호, 주소가 포함되므로 인증 없이 조회할 수 없습니다.';
  }

  return '관리자 인증이 필요합니다.\n\n' +
    '챗봇에 "인증 관리자PIN" 형식으로 입력한 뒤 다시 조회해주세요.\n' +
    '예: 인증 1234';
}

function kakaoResolveCommand_(payload, utterance) {
  var params = kakaoActionParams_(payload);
  var mode = String(params.mode || '').trim();
  var keyword = String(params.keyword || params.name || params.phone || '').trim();
  var dateParam = String(params.date || '').trim();
  var u = String(utterance || '').trim();
  var commandText = mode + ' ' + u;

  if (/오늘\s*할\s*일|할일|업무|체크|todo|tasks?/i.test(commandText)) {
    return { type:'tasks' };
  }

  if (/요약|현황|summary/i.test(commandText)) {
    return { type:'summary' };
  }

  if (/고객|검색|정보/.test(commandText) || keyword) {
    return { type:'customer', keyword: keyword || kakaoExtractKeyword_(u) };
  }

  var today = kakaoToday_();
  var parsedDate = kakaoParseDateText_(dateParam || u, today);
  if (parsedDate) return { type:'delivery', date:parsedDate, label:kakaoDateLabel_(parsedDate) };

  if (/모레/.test(commandText)) {
    var afterTomorrow = kakaoAddDays_(today, 2);
    return { type:'delivery', date:afterTomorrow, label:'모레 배송' };
  }

  if (/내일|tomorrow/i.test(commandText)) {
    var tomorrow = kakaoAddDays_(today, 1);
    return { type:'delivery', date:tomorrow, label:'내일 배송' };
  }

  return { type:'delivery', date:today, label:'오늘 배송' };
}

function kakaoExtractKeyword_(utterance) {
  var s = String(utterance || '').trim();
  s = s.replace(/고객검색|고객정보|고객|검색|정보/g, '');
  s = s.replace(/^[:：\-\s]+/, '').trim();
  return s;
}

function kakaoToday_() {
  return Utilities.formatDate(new Date(), KAKAO_TZ, 'yyyy-MM-dd');
}

function kakaoAddDays_(dateStr, offset) {
  var p = String(dateStr).split('-').map(Number);
  var d = new Date(p[0], p[1] - 1, p[2] + offset);
  return Utilities.formatDate(d, KAKAO_TZ, 'yyyy-MM-dd');
}

function kakaoDow_(dateStr) {
  var p = String(dateStr).split('-').map(Number);
  return new Date(p[0], p[1] - 1, p[2]).getDay();
}

function kakaoDateLabel_(dateStr) {
  var days = ['일','월','화','수','목','금','토'];
  var p = String(dateStr).split('-').map(Number);
  return p[1] + '/' + p[2] + '(' + days[kakaoDow_(dateStr)] + ') 배송';
}

function kakaoParseDateText_(text, today) {
  var s = String(text || '').trim();
  if (!s) return '';

  var iso = s.match(/(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (iso) return kakaoBuildDate_(parseInt(iso[1], 10), parseInt(iso[2], 10), parseInt(iso[3], 10));

  var md = s.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/) ||
    s.match(/(?:^|\s)(\d{1,2})[/.](\d{1,2})(?:\s|$)/);
  if (md) {
    var y = parseInt(today.slice(0, 4), 10);
    return kakaoBuildDate_(y, parseInt(md[1], 10), parseInt(md[2], 10));
  }

  return '';
}

function kakaoBuildDate_(year, month, day) {
  var d = new Date(year, month - 1, day);
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return '';
  return Utilities.formatDate(d, KAKAO_TZ, 'yyyy-MM-dd');
}

function kakaoFetchCustomers_() {
  return kakaoFetchCollection_('customers', 1000);
}

function kakaoFetchCollectionSafe_(collectionId, pageSize) {
  try {
    return { ok:true, items:kakaoFetchCollection_(collectionId, pageSize) };
  } catch (err) {
    return { ok:false, items:[], error:(err && err.message ? err.message : String(err)) };
  }
}

function kakaoFetchDocSafe_(documentPath) {
  try {
    return { ok:true, item:kakaoFetchDoc_(documentPath) };
  } catch (err) {
    return { ok:false, item:null, error:(err && err.message ? err.message : String(err)) };
  }
}

function kakaoFetchCollection_(collectionId, pageSize) {
  if (typeof getFirebaseToken !== 'function') {
    throw new Error('getFirebaseToken()을 찾을 수 없습니다. Code.gs와 같은 Apps Script 프로젝트에 추가해야 합니다.');
  }

  var projectId = kakaoFirebaseProjectId_();
  if (!projectId) {
    throw new Error('Script Properties에 FIREBASE_PROJECT_ID 값이 없습니다.');
  }

  var token = getFirebaseToken();
  var docs = [];
  var pageToken = '';

  while (true) {
    var url = 'https://firestore.googleapis.com/v1/projects/' + projectId +
      '/databases/(default)/documents/' + encodeURIComponent(collectionId) +
      '?pageSize=' + encodeURIComponent(String(pageSize || 100));
    if (pageToken) url += '&pageToken=' + encodeURIComponent(pageToken);

    var res = UrlFetchApp.fetch(url, {
      method: 'get',
      headers: { Authorization: 'Bearer ' + token },
      muteHttpExceptions: true
    });
    var json = JSON.parse(res.getContentText() || '{}');
    if (json.error) throw new Error(json.error.message || 'Firestore 조회 오류');

    (json.documents || []).forEach(function(doc) {
      docs.push(kakaoFirestoreDocToObject_(doc));
    });

    if (!json.nextPageToken) break;
    pageToken = json.nextPageToken;
  }

  return docs;
}

function kakaoFetchDoc_(documentPath) {
  if (typeof getFirebaseToken !== 'function') {
    throw new Error('getFirebaseToken()을 찾을 수 없습니다. Code.gs와 같은 Apps Script 프로젝트에 추가해야 합니다.');
  }

  var projectId = kakaoFirebaseProjectId_();
  if (!projectId) {
    throw new Error('Script Properties에 FIREBASE_PROJECT_ID 값이 없습니다.');
  }

  var url = 'https://firestore.googleapis.com/v1/projects/' + projectId +
    '/databases/(default)/documents/' + String(documentPath || '').split('/').map(encodeURIComponent).join('/');
  var res = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: { Authorization: 'Bearer ' + getFirebaseToken() },
    muteHttpExceptions: true
  });
  var code = res.getResponseCode();
  if (code === 404) return null;

  var json = JSON.parse(res.getContentText() || '{}');
  if (json.error) throw new Error(json.error.message || 'Firestore 문서 조회 오류');
  return kakaoFirestoreDocToObject_(json);
}

function kakaoFirestoreDocToObject_(doc) {
  var fields = doc.fields || {};
  var out = {};
  Object.keys(fields).forEach(function(key) {
    out[key] = kakaoFsValue_(fields[key]);
  });
  var parts = String(doc.name || '').split('/');
  out.id = parts[parts.length - 1] || '';
  return out;
}

function kakaoFsValue_(v) {
  if (!v) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return parseInt(v.integerValue, 10) || 0;
  if ('doubleValue' in v) return Number(v.doubleValue) || 0;
  if ('booleanValue' in v) return !!v.booleanValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('nullValue' in v) return null;
  if ('arrayValue' in v) {
    return (v.arrayValue.values || []).map(function(item) { return kakaoFsValue_(item); });
  }
  if ('mapValue' in v) {
    var mapFields = (v.mapValue && v.mapValue.fields) || {};
    var out = {};
    Object.keys(mapFields).forEach(function(key) {
      out[key] = kakaoFsValue_(mapFields[key]);
    });
    return out;
  }
  return null;
}

function kakaoWasDeliveredOn_(c, dateStr) {
  return Array.isArray(c.deliveredDates) && c.deliveredDates.indexOf(dateStr) >= 0;
}

function kakaoIsDeliverySub_(c, dateStr) {
  if (c.orderType !== 'sub') return false;
  if (kakaoWasDeliveredOn_(c, dateStr)) return true;
  if (c.status !== 'active' || Number(c.remain || 0) <= 0) return false;
  if (c.startDate && dateStr < c.startDate) return false;
  var d = kakaoDow_(dateStr);
  if (Array.isArray(c.cookDays) && c.cookDays.length > 0) {
    return c.cookDays.indexOf(d) >= 0;
  }
  var arriveDays = Array.isArray(c.arriveDays) ? c.arriveDays : [];
  var cookFromArrive = arriveDays.map(function(a) { return a === 0 ? 6 : a - 1; });
  return cookFromArrive.indexOf(d) >= 0;
}

function kakaoIsDeliveryOnce_(c, dateStr) {
  if (c.orderType !== 'once') return false;
  if (kakaoWasDeliveredOn_(c, dateStr)) return true;
  if (c.status !== 'active' || Number(c.remain || 0) <= 0) return false;
  if (c.startDate && dateStr < c.startDate) return false;
  if (c.isDirect) {
    return c.onceDate === dateStr;
  }
  return c.onceDate === dateStr;
}

function kakaoIsDelivery_(c, dateStr) {
  return kakaoIsDeliverySub_(c, dateStr) || kakaoIsDeliveryOnce_(c, dateStr);
}

function kakaoListFor_(customers, dateStr) {
  return (customers || []).filter(function(c) { return kakaoIsDelivery_(c, dateStr); });
}

function kakaoProductLabel_(id) {
  var map = {
    A: 'A세트',
    B: 'B세트',
    C: 'C세트',
    pork_rib: '수제 양념돼지갈비',
    beef_la: '양념 LA갈비',
    beef_soup: '소고기무국'
  };
  return map[id] || id || '-';
}

function kakaoQtyText_(c) {
  if (c.orderType === 'once') {
    var q = Number(c.qty || c.total || 1);
    return '수량 ' + Math.max(1, q) + '개';
  }
  return '잔여 ' + Number(c.remain || 0) + '회';
}

function kakaoShort_(text, max) {
  var s = String(text || '').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function kakaoBuildDeliveryText_(customers, dateStr, label) {
  var list = kakaoListFor_(customers, dateStr);
  var direct = list.filter(function(c) { return !!c.isDirect; });
  var courier = list.filter(function(c) { return !c.isDirect; });
  var lines = [];

  lines.push('궁중수라간 ' + (label || kakaoDateLabel_(dateStr)));
  lines.push('조회 날짜: ' + dateStr);
  lines.push('총 배송 ' + list.length + '건 / 직배송 ' + direct.length + '건 / 택배 ' + courier.length + '건');

  if (!list.length) {
    lines.push('');
    lines.push('조회된 배송 예정이 없습니다.');
    return lines.join('\n');
  }

  lines.push('');
  lines.push('[직배송]');
  kakaoAppendDeliveryLines_(lines, direct, dateStr);

  lines.push('');
  lines.push('[택배]');
  kakaoAppendDeliveryLines_(lines, courier, dateStr);

  if (list.length > KAKAO_MAX_DELIVERY_ITEMS) {
    lines.push('');
    lines.push('외 ' + (list.length - KAKAO_MAX_DELIVERY_ITEMS) + '건은 관리자 페이지에서 확인하세요.');
    lines.push(KAKAO_ADMIN_URL);
  }

  return lines.join('\n');
}

function kakaoAppendDeliveryLines_(lines, list, dateStr) {
  if (!list.length) {
    lines.push('- 없음');
    return;
  }

  var used = kakaoCountItemLines_(lines);
  var remainSlots = Math.max(0, KAKAO_MAX_DELIVERY_ITEMS - used);
  list.slice(0, remainSlots).forEach(function(c) {
    var product = kakaoProductLabel_(c.productId || c.set);
    var done = kakaoWasDeliveredOn_(c, dateStr) ? '완료' : '대기';
    var phone = kakaoShort_(c.phone || '-', 24);
    var addr = kakaoShort_(c.addr || '-', 34);
    var req = kakaoShort_(c.request || '', 28) || '-';

    lines.push(
      '- ' + (c.name || '이름없음') + ' / ' + product + ' / ' + kakaoQtyText_(c) + ' / ' + done + '\n' +
      '  전화: ' + phone + '\n' +
      '  주소: ' + addr + '\n' +
      '  요청: ' + req
    );
  });

  if (list.length > remainSlots) {
    lines.push('- 외 ' + (list.length - remainSlots) + '건');
  }
}

function kakaoCountItemLines_(lines) {
  return lines.filter(function(line) { return /^- /.test(line); }).length;
}

function kakaoBuildCustomerSearchText_(customers, keyword) {
  var kw = String(keyword || '').trim();
  if (!kw) {
    return '고객검색은 이름 또는 전화번호 일부를 같이 입력해주세요.\n\n' +
      '예: 고객검색 홍길동\n' +
      '예: 고객검색 0101234';
  }

  var needle = kakaoNorm_(kw);
  var needleDigits = kakaoDigits_(kw);
  var matches = (customers || []).filter(function(c) {
    var values = [c.name, c.phone, c.addr, c.orderNum, c.memo, c.request, c.scheduleName];
    var hay = values.map(kakaoNorm_).join(' ');
    var hayDigits = values.map(kakaoDigits_).join('');
    return hay.indexOf(needle) >= 0 || (!!needleDigits && hayDigits.indexOf(needleDigits) >= 0);
  });

  var lines = [];
  lines.push('고객검색: ' + kw);
  lines.push('총 ' + matches.length + '건');

  if (!matches.length) {
    lines.push('');
    lines.push('검색 결과가 없습니다. 이름, 전화번호, 주문번호 일부로 다시 조회해주세요.');
    return lines.join('\n');
  }

  lines.push('');
  matches.slice(0, KAKAO_MAX_SEARCH_ITEMS).forEach(function(c, idx) {
    var product = kakaoProductLabel_(c.productId || c.set);
    var schedule = c.orderType === 'once' ? (c.onceDate || '-') : (c.scheduleName || '-');
    var memo = kakaoShort_(c.memo || '', 28);
    var req = kakaoShort_(c.request || '', 28);

    lines.push(
      (idx + 1) + '. ' + (c.name || '이름없음') + ' / ' + product + ' / ' + (c.status || '-') + '\n' +
      '  전화: ' + (c.phone || '-') + '\n' +
      '  주소: ' + kakaoShort_(c.addr || '-', 34) + '\n' +
      '  주문번호: ' + (c.orderNum || '-') + '\n' +
      '  일정: ' + kakaoShort_(schedule, 34) +
      (memo ? '\n  메모: ' + memo : '') +
      (req ? '\n  요청: ' + req : '')
    );
  });

  if (matches.length > KAKAO_MAX_SEARCH_ITEMS) {
    lines.push('');
    lines.push('외 ' + (matches.length - KAKAO_MAX_SEARCH_ITEMS) + '건은 관리자 페이지에서 확인하세요.');
    lines.push(KAKAO_ADMIN_URL);
  }

  return lines.join('\n');
}

function kakaoBuildSummaryText_(customers) {
  var today = kakaoToday_();
  var tomorrow = kakaoAddDays_(today, 1);
  var afterTomorrow = kakaoAddDays_(today, 2);
  var todayList = kakaoListFor_(customers, today);
  var tomorrowList = kakaoListFor_(customers, tomorrow);
  var afterTomorrowList = kakaoListFor_(customers, afterTomorrow);
  var activeSubs = customers.filter(function(c) { return c.orderType === 'sub' && c.status === 'active'; }).length;
  var activeOnce = customers.filter(function(c) { return c.orderType === 'once' && c.status === 'active'; }).length;
  var needsReview = customers.filter(function(c) { return !!c.needsReview; }).length;

  return [
    '궁중수라간 배송 요약',
    Utilities.formatDate(new Date(), KAKAO_TZ, 'yyyy-MM-dd HH:mm') + ' 기준',
    '',
    '오늘 배송: ' + todayList.length + '건',
    '내일 배송: ' + tomorrowList.length + '건',
    '모레 배송: ' + afterTomorrowList.length + '건',
    '활성 정기배송: ' + activeSubs + '건',
    '활성 선택주문: ' + activeOnce + '건',
    '확인 필요: ' + needsReview + '건',
    '',
    '명령어: 오늘할일 / 오늘배송 / 내일배송 / 모레배송 / 고객검색 이름'
  ].join('\n');
}

function kakaoLogenShipment_(c, dateStr) {
  var map = c && c.logenShipments ? c.logenShipments : {};
  return map && map[dateStr] ? map[dateStr] : {};
}

function kakaoLogenStatus_(c, dateStr) {
  return kakaoLogenShipment_(c, dateStr).status || 'logen_ready';
}

function kakaoLogenNeedsChange_(c, dateStr) {
  var s = kakaoLogenShipment_(c, dateStr);
  var status = kakaoLogenStatus_(c, dateStr);
  return ['logen_registered','slip_pending','slip_ready','printed'].indexOf(status) >= 0 && s.changeNeeded === true;
}

function kakaoEventDate_(item) {
  return String(item.eventDate || item.date || '').slice(0, 10);
}

function kakaoIsOpenEventOrder_(item) {
  var status = String(item.status || '').toLowerCase();
  return ['registered','deleted','done','cancelled','canceled'].indexOf(status) < 0;
}

function kakaoBuildTodayTasksText_(customers) {
  var today = kakaoToday_();
  var tomorrow = kakaoAddDays_(today, 1);
  var todayList = kakaoListFor_(customers, today);
  var direct = todayList.filter(function(c) { return !!c.isDirect; });
  var courier = todayList.filter(function(c) { return !c.isDirect; });
  var notDone = todayList.filter(function(c) { return !kakaoWasDeliveredOn_(c, today); });
  var needsReview = (customers || []).filter(function(c) { return !!c.needsReview; });
  var courierFailed = courier.filter(function(c) { return kakaoLogenStatus_(c, today) === 'logen_failed'; });
  var courierSlipWait = courier.filter(function(c) {
    var status = kakaoLogenStatus_(c, today);
    var s = kakaoLogenShipment_(c, today);
    return ['logen_registered','slip_pending'].indexOf(status) >= 0 && !(s.slipNo || s.invoiceNo);
  });
  var courierChange = courier.filter(function(c) { return kakaoLogenNeedsChange_(c, today); });
  var changeReq = kakaoFetchCollectionSafe_('changeRequests', 100);
  var eventOrders = kakaoFetchCollectionSafe_('eventOrders', 100);
  var todayMenu = kakaoFetchDocSafe_('mealMenus/' + today);
  var tomorrowMenu = kakaoFetchDocSafe_('mealMenus/' + tomorrow);
  var newReq = changeReq.items.filter(function(item) { return String(item.status || 'new') === 'new'; });
  var checkingReq = changeReq.items.filter(function(item) { return String(item.status || '') === 'checking'; });
  var openEvents = eventOrders.items.filter(kakaoIsOpenEventOrder_);
  var todayEvents = openEvents.filter(function(item) {
    var d = kakaoEventDate_(item);
    return !d || d <= today;
  });
  var lines = [];
  var warnings = [];

  if (!changeReq.ok) warnings.push('변경요청 조회 실패');
  if (!eventOrders.ok) warnings.push('행사도시락 조회 실패');
  if (!todayMenu.ok || !tomorrowMenu.ok) warnings.push('식단 조회 일부 실패');

  lines.push('[궁중수라간 오늘 할 일]');
  lines.push(Utilities.formatDate(new Date(), KAKAO_TZ, 'yyyy-MM-dd HH:mm') + ' 기준');
  lines.push('');
  lines.push('오늘 배송: ' + todayList.length + '건');
  lines.push('- 직배송 ' + direct.length + '건 / 택배 ' + courier.length + '건');
  lines.push('- 미완료 ' + notDone.length + '건');
  lines.push('');
  lines.push('확인 필요 주문: ' + needsReview.length + '건');
  lines.push('로젠: 전송실패 ' + courierFailed.length + '건 / 송장대기 ' + courierSlipWait.length + '건 / 변경필요 ' + courierChange.length + '건');
  lines.push('고객 문의/변경요청: 신규 ' + newReq.length + '건 / 확인중 ' + checkingReq.length + '건');
  lines.push('행사도시락 미처리: ' + todayEvents.length + '건');
  lines.push('식단: 오늘 ' + (todayMenu.item ? '등록' : '미등록') + ' / 내일 ' + (tomorrowMenu.item ? '등록' : '미등록'));

  if (needsReview.length || courierFailed.length || courierSlipWait.length || courierChange.length || newReq.length || todayEvents.length || !todayMenu.item || !tomorrowMenu.item) {
    lines.push('');
    lines.push('[먼저 볼 것]');
    kakaoAppendTaskNames_(lines, '확인필요', needsReview);
    kakaoAppendTaskNames_(lines, '로젠실패', courierFailed);
    kakaoAppendTaskNames_(lines, '송장대기', courierSlipWait);
    kakaoAppendTaskNames_(lines, '로젠변경', courierChange);
    kakaoAppendTaskNames_(lines, '신규문의', newReq, 'customerName');
    kakaoAppendTaskNames_(lines, '행사', todayEvents, 'businessName');
  } else {
    lines.push('');
    lines.push('크게 걸리는 항목은 없습니다.');
  }

  if (warnings.length) {
    lines.push('');
    lines.push('주의: ' + warnings.join(', '));
  }

  lines.push('');
  lines.push('명령어: 오늘배송 / 고객검색 이름 / 요약');
  return lines.join('\n');
}

function kakaoAppendTaskNames_(lines, label, items, nameField) {
  if (!items || !items.length) return;
  var names = items.slice(0, KAKAO_MAX_TASK_ITEMS).map(function(item) {
    return kakaoShort_(item[nameField || 'name'] || item.customerName || item.businessName || item.phone || item.id || '-', 12);
  });
  lines.push('- ' + label + ': ' + names.join(', ') + (items.length > KAKAO_MAX_TASK_ITEMS ? ' 외 ' + (items.length - KAKAO_MAX_TASK_ITEMS) + '건' : ''));
}

function kakaoNorm_(v) {
  return String(v || '').replace(/[\s\-().]/g, '').toLowerCase();
}

function kakaoDigits_(v) {
  return String(v || '').replace(/\D/g, '');
}
