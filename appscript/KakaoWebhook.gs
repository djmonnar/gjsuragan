/**
 * 궁중수라간 · 카카오 챗봇 스킬 웹훅
 *
 * 사용 목적
 * - 카카오 챗봇 블록에서 "오늘배송", "내일배송", "고객검색 홍길동"처럼 입력하면
 *   Firestore customers 컬렉션을 읽어 카카오톡 말풍선 JSON으로 응답합니다.
 *
 * 설치 위치
 * - 기존 appscript/Code.gs와 같은 Google Apps Script 프로젝트에 이 파일을 추가하세요.
 * - 이 파일은 기존 Code.gs의 CONFIG.PROJECT_ID, getFirebaseToken()을 재사용합니다.
 *
 * 보안 권장
 * - Apps Script > 프로젝트 설정 > 스크립트 속성에 KAKAO_ADMIN_PIN을 꼭 등록하세요.
 * - 챗봇에서 최초 1회 "인증 1234"처럼 입력하면 6시간 동안 조회가 허용됩니다.
 */

var KAKAO_TZ = 'Asia/Seoul';
var KAKAO_ADMIN_URL = 'https://djmonnar.github.io/gjsuragan/admin.html';
var KAKAO_SESSION_TTL = 21600; // 6시간
var KAKAO_MAX_LINES = 12;
var KAKAO_MAX_TEXT = 950;

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
      if (auth.reason === 'pin_missing') {
        return kakaoJson_(kakaoTextResponse_(
          '카카오 챗봇 보안 설정이 아직 없습니다.\n\n' +
          'Apps Script의 스크립트 속성에 KAKAO_ADMIN_PIN을 먼저 등록해주세요.\n' +
          '고객명/전화번호/주소가 포함되므로 공개 채널에서는 인증 없이 노출하면 안 됩니다.'
        ));
      }
      return kakaoJson_(kakaoTextResponse_(
        '관리자 인증이 필요합니다.\n\n' +
        '챗봇에 "인증 관리자PIN" 형식으로 입력한 뒤 다시 조회해주세요.\n' +
        '예: 인증 1234'
      ));
    }

    if (auth.justAuthed) {
      return kakaoJson_(kakaoTextResponse_(
        '관리자 인증 완료!\n\n' +
        '이제 아래 명령으로 바로 조회할 수 있습니다.\n' +
        '• 오늘배송\n' +
        '• 내일배송\n' +
        '• 고객검색 이름 또는 전화번호\n' +
        '• 요약'
      ));
    }

    var cmd = kakaoResolveCommand_(payload, utterance);
    var customers = kakaoFetchCustomers_();

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
      '관리자 페이지 또는 Apps Script 실행 로그를 확인해주세요.\n\n' +
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
        { label: '오늘배송', action: 'message', messageText: '오늘배송' },
        { label: '내일배송', action: 'message', messageText: '내일배송' },
        { label: '요약', action: 'message', messageText: '요약' },
        { label: '고객검색', action: 'message', messageText: '고객검색 ' }
      ]
    }
  };
}

function kakaoTrimText_(text) {
  var s = String(text || '');
  if (s.length <= KAKAO_MAX_TEXT) return s;
  return s.slice(0, KAKAO_MAX_TEXT - 38) + '\n…\n내용이 길어 일부만 표시했습니다.';
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

function kakaoUserKey_(payload) {
  var user = payload && payload.userRequest && payload.userRequest.user ? payload.userRequest.user : {};
  var props = user.properties || {};
  return String(user.id || props.plusfriendUserKey || 'anonymous');
}

function kakaoAdminPin_() {
  var propPin = PropertiesService.getScriptProperties().getProperty('KAKAO_ADMIN_PIN');
  if (propPin) return String(propPin).trim();
  if (typeof CONFIG !== 'undefined' && CONFIG.KAKAO_ADMIN_PIN) return String(CONFIG.KAKAO_ADMIN_PIN).trim();
  return '';
}

function kakaoCheckAuth_(payload, utterance) {
  var expected = kakaoAdminPin_();
  if (!expected) return { ok:false, reason:'pin_missing' };

  var key = 'kakao-admin-ok-' + kakaoUserKey_(payload);
  var cache = CacheService.getScriptCache();
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

function kakaoResolveCommand_(payload, utterance) {
  var params = kakaoActionParams_(payload);
  var mode = String(params.mode || '').trim();
  var keyword = String(params.keyword || params.name || params.phone || '').trim();
  var dateParam = String(params.date || '').trim();
  var u = String(utterance || '').trim();

  if (/요약|현황|summary/i.test(mode + ' ' + u)) {
    return { type:'summary' };
  }

  if (/고객|검색|정보/.test(mode + ' ' + u) || keyword) {
    return { type:'customer', keyword: keyword || kakaoExtractKeyword_(u) };
  }

  var today = kakaoToday_();
  var parsedDate = kakaoParseDateText_(dateParam || u, today);
  if (parsedDate) return { type:'delivery', date:parsedDate, label:kakaoDateLabel_(parsedDate) };

  if (/모레/.test(u)) {
    var afterTomorrow = kakaoAddDays_(today, 2);
    return { type:'delivery', date:afterTomorrow, label:'모레 배송' };
  }

  if (/내일/.test(u) || /tomorrow/i.test(mode + ' ' + u)) {
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
  if (iso) return kakaoBuildDate_(parseInt(iso[1],10), parseInt(iso[2],10), parseInt(iso[3],10));

  var md = s.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/) || s.match(/(?:^|\s)(\d{1,2})[/.](\d{1,2})(?:\s|$)/);
  if (md) {
    var y = parseInt(today.slice(0,4), 10);
    return kakaoBuildDate_(y, parseInt(md[1],10), parseInt(md[2],10));
  }

  return '';
}

function kakaoBuildDate_(year, month, day) {
  var d = new Date(year, month - 1, day);
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return '';
  return Utilities.formatDate(d, KAKAO_TZ, 'yyyy-MM-dd');
}

function kakaoFetchCustomers_() {
  if (typeof getFirebaseToken !== 'function') {
    throw new Error('getFirebaseToken()을 찾을 수 없습니다. 기존 Code.gs와 같은 Apps Script 프로젝트에 추가해야 합니다.');
  }
  if (typeof CONFIG === 'undefined' || !CONFIG.PROJECT_ID) {
    throw new Error('CONFIG.PROJECT_ID를 찾을 수 없습니다. 기존 Code.gs 설정을 확인하세요.');
  }

  var token = getFirebaseToken();
  var docs = [];
  var pageToken = '';

  while (true) {
    var url = 'https://firestore.googleapis.com/v1/projects/' + CONFIG.PROJECT_ID + '/databases/(default)/documents/customers?pageSize=1000';
    if (pageToken) url += '&pageToken=' + encodeURIComponent(pageToken);

    var res = UrlFetchApp.fetch(url, {
      method: 'get',
      headers: { Authorization: 'Bearer ' + token },
      muteHttpExceptions: true
    });
    var json = JSON.parse(res.getContentText() || '{}');
    if (json.error) throw new Error(json.error.message || 'Firestore 조회 오류');

    (json.documents || []).forEach(function(doc) {
      var obj = kakaoFirestoreDocToObject_(doc);
      docs.push(obj);
    });

    if (!json.nextPageToken) break;
    pageToken = json.nextPageToken;
  }

  return docs;
}

function kakaoFirestoreDocToObject_(doc) {
  var f = doc.fields || {};
  var out = {};
  Object.keys(f).forEach(function(key) {
    out[key] = kakaoFsValue_(f[key]);
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
    var fields = (v.mapValue && v.mapValue.fields) || {};
    var out = {};
    Object.keys(fields).forEach(function(key) { out[key] = kakaoFsValue_(fields[key]); });
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
    return c.cookDays.map(Number).indexOf(d) >= 0;
  }

  var arriveDays = Array.isArray(c.arriveDays) ? c.arriveDays.map(Number) : [];
  var cookFromArrive = arriveDays.map(function(a) { return a === 0 ? 6 : a - 1; });
  return cookFromArrive.indexOf(d) >= 0;
}

function kakaoIsDeliveryOnce_(c, dateStr) {
  if (c.orderType !== 'once') return false;
  if (kakaoWasDeliveredOn_(c, dateStr)) return true;
  if (c.status !== 'active' || Number(c.remain || 0) <= 0) return false;
  if (c.startDate && dateStr < c.startDate) return false;
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
    pork_rib: '수제 돼지양념갈비',
    beef_la: '양념 LA갈비',
    beef_soup: '소고기무국'
  };
  return map[id] || id || '-';
}

function kakaoQtyText_(c) {
  if (c.orderType === 'once') {
    var q = Number(c.qty || c.total || 1);
    return q > 1 ? q + '개' : '1개';
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
  lines.push('🍱 궁중수라간 ' + (label || kakaoDateLabel_(dateStr)));
  lines.push(dateStr + ' 기준');
  lines.push('총 ' + list.length + '건 · 직배송 ' + direct.length + '건 · 택배 ' + courier.length + '건');

  if (!list.length) {
    lines.push('');
    lines.push('조회된 배송 예정이 없습니다.');
    return lines.join('\n');
  }

  lines.push('');
  lines.push('🚚 직배송');
  kakaoAppendDeliveryLines_(lines, direct, dateStr);

  lines.push('');
  lines.push('📦 택배');
  kakaoAppendDeliveryLines_(lines, courier, dateStr);

  if (list.length > KAKAO_MAX_LINES) {
    lines.push('');
    lines.push('외 ' + (list.length - KAKAO_MAX_LINES) + '건은 관리자 페이지에서 확인하세요.');
    lines.push(KAKAO_ADMIN_URL);
  }

  return lines.join('\n');
}

function kakaoAppendDeliveryLines_(lines, list, dateStr) {
  if (!list.length) {
    lines.push('- 없음');
    return;
  }

  var remainSlots = Math.max(1, KAKAO_MAX_LINES - kakaoCountItemLines_(lines));
  list.slice(0, remainSlots).forEach(function(c, idx) {
    var product = kakaoProductLabel_(c.productId || c.set);
    var done = kakaoWasDeliveredOn_(c, dateStr) ? '완료' : '대기';
    var req = kakaoShort_(c.request || c.memo || '', 26);
    var addr = kakaoShort_(c.addr || '', 36);

    lines.push(
      '- ' + (c.name || '이름없음') + ' / ' + product + ' / ' + kakaoQtyText_(c) + ' / ' + done + '\n' +
      '  ' + (c.phone || '-') + (addr ? '\n  ' + addr : '') + (req ? '\n  요청: ' + req : '')
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
    return '고객검색은 이름 또는 전화번호 일부를 같이 입력해주세요.\n\n예: 고객검색 홍길동\n예: 고객검색 0101234';
  }

  var needle = kakaoNorm_(kw);
  var matches = (customers || []).filter(function(c) {
    var hay = [c.name, c.phone, c.addr, c.orderNum, c.memo, c.request, c.scheduleName]
      .map(kakaoNorm_)
      .join(' ');
    return hay.indexOf(needle) >= 0;
  });

  var lines = [];
  lines.push('🔎 고객검색: ' + kw);
  lines.push('총 ' + matches.length + '건');

  if (!matches.length) {
    lines.push('');
    lines.push('검색 결과가 없습니다. 이름/전화번호 일부로 다시 조회해주세요.');
    return lines.join('\n');
  }

  lines.push('');
  matches.slice(0, 8).forEach(function(c, idx) {
    var product = kakaoProductLabel_(c.productId || c.set);
    var status = c.status || '-';
    var schedule = c.orderType === 'once' ? (c.onceDate || '-') : (c.scheduleName || '-');
    lines.push(
      (idx + 1) + '. ' + (c.name || '이름없음') + ' / ' + product + ' / ' + status + '\n' +
      '  ' + (c.phone || '-') + '\n' +
      '  일정: ' + schedule + ' / ' + kakaoQtyText_(c) + '\n' +
      '  주소: ' + kakaoShort_(c.addr || '-', 42)
    );
  });

  if (matches.length > 8) lines.push('\n외 ' + (matches.length - 8) + '건은 관리자 페이지에서 확인하세요.');
  return lines.join('\n');
}

function kakaoBuildSummaryText_(customers) {
  var today = kakaoToday_();
  var tomorrow = kakaoAddDays_(today, 1);
  var todayList = kakaoListFor_(customers, today);
  var tomorrowList = kakaoListFor_(customers, tomorrow);
  var activeSubs = customers.filter(function(c) { return c.orderType === 'sub' && c.status === 'active'; }).length;
  var activeOnce = customers.filter(function(c) { return c.orderType === 'once' && c.status === 'active'; }).length;
  var needsReview = customers.filter(function(c) { return !!c.needsReview; }).length;

  return [
    '📊 궁중수라간 배송 요약',
    Utilities.formatDate(new Date(), KAKAO_TZ, 'yyyy-MM-dd HH:mm') + ' 기준',
    '',
    '오늘 배송: ' + todayList.length + '건',
    '내일 배송: ' + tomorrowList.length + '건',
    '활성 정기배송: ' + activeSubs + '건',
    '활성 선택주문: ' + activeOnce + '건',
    '확인 필요: ' + needsReview + '건',
    '',
    '명령어: 오늘배송 / 내일배송 / 고객검색 이름'
  ].join('\n');
}

function kakaoNorm_(v) {
  return String(v || '').replace(/\s+/g, '').toLowerCase();
}
