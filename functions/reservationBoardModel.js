'use strict';

// 돌담명가 직원 공용 예약장(reservations.html)의 규칙. Firestore 없이 돈다.
//
// 직원이 직접 받은 예약(전화·방문)은 궁중수라간 Firestore 에 두고, 네이버 예약은
// 오너비스타에서 읽어 와 하루 목록에서 한 줄로 합친다. 네이버 예약 자체는 여기서
// 고치지 않는다(네이버가 원본이다). 직원은 네이버 예약에 룸·비고만 덧붙인다.

const crypto = require('node:crypto');

const KST_OFFSET_MS = 9 * 3600000;
// 이 시각 전은 낮(점심), 이후는 밤(저녁). 시트의 「낮/밤」 칸을 시간으로 대신 고를 때 쓴다.
const LUNCH_UNTIL = '16:00';
const ROUTES = ['전화', '방문', '기타', '네이버'];
const STATUS_LABELS = { booked: '예약', changed: '변경', cancelled: '취소' };
// 기존 태블릿과 같은 기준: 신청·확정·이용완료는 올 손님으로 센다.
const NAVER_ACTIVE = new Set(['requested', 'confirmed', 'completed']);
const NAVER_LABELS = { requested: '확정 대기', confirmed: '확정', completed: '이용 완료', cancelled: '취소',
  cancelled_by_change: '변경으로 취소', noshowed: '노쇼', unknown: '상태 확인' };
const MAX_RANGE_DAYS = 7;
const LIMITS = { name: 40, phone: 40, menu: 100, room: 40, memo: 1000, staff: 20, notice: 1000 };

function error(status, message) { return Object.assign(new Error(message), { status }); }
const kstDate = ms => new Date(ms + KST_OFFSET_MS).toISOString().slice(0, 10);
function isDate(value) {
  if (typeof value !== 'string' || !/^20\d{2}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
function requireDate(value, message = '날짜를 확인해 주세요.') {
  if (!isDate(value)) throw error(400, message);
  return value;
}
function addDays(date, days) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
function daysBetween(from, to) { return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000); }
function requireRange(from, to) {
  requireDate(from, '조회 시작 날짜를 확인해 주세요.'); requireDate(to, '조회 끝 날짜를 확인해 주세요.');
  const span = daysBetween(from, to);
  if (span < 0 || span >= MAX_RANGE_DAYS) throw error(400, `한 번에 ${MAX_RANGE_DAYS}일까지 볼 수 있습니다.`);
  return Array.from({ length: span + 1 }, (_, i) => addDays(from, i));
}
function requireMonth(value) {
  if (typeof value !== 'string' || !/^20\d{2}-(0[1-9]|1[0-2])$/.test(value)) throw error(400, '조회 월을 확인해 주세요.');
  const last = new Date(`${value}-01T00:00:00Z`); last.setUTCMonth(last.getUTCMonth() + 1, 0);
  return { from: `${value}-01`, to: last.toISOString().slice(0, 10), days: last.getUTCDate() };
}
const isTime = value => typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
function mealOf(time) { return isTime(time) && time < LUNCH_UNTIL ? 'lunch' : 'dinner'; }

// 한 줄 칸은 공백을 하나로, 비고·공지처럼 여러 줄 칸은 줄바꿈을 살린다. 제어문자는 버린다.
function text(value, max, label, { required = false, multiline = false } = {}) {
  if (value === undefined || value === null) value = '';
  if (typeof value === 'number' && Number.isFinite(value)) value = String(value);
  if (typeof value !== 'string') throw error(400, `${label} 칸을 확인해 주세요.`);
  const cleaned = value.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, ' ');
  const result = multiline
    ? cleaned.split('\n').map(line => line.replace(/[ \t]+/g, ' ').trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim()
    : cleaned.replace(/\s+/g, ' ').trim();
  if (required && !result) throw error(400, `${label} 칸을 채워 주세요.`);
  if ([...result].length > max) throw error(400, `${label} 칸은 ${max}자까지 적을 수 있습니다.`);
  return result;
}
function people(value) {
  if (value === undefined || value === null || value === '') return null;
  const number = typeof value === 'string' && /^\d{1,3}$/.test(value.trim()) ? Number(value) : value;
  if (!Number.isInteger(number) || number < 1 || number > 999) throw error(400, '인원은 1명부터 999명까지 숫자로 적어 주세요. 모르면 비워 두세요.');
  return number;
}

function reservationInput(input, now) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw error(400, '예약 내용을 확인해 주세요.');
  const date = requireDate(input.date, '예약 날짜를 확인해 주세요.');
  const today = kstDate(now);
  if (date < addDays(today, -366) || date > addDays(today, 731)) throw error(400, '예약 날짜는 1년 전부터 2년 뒤까지 적을 수 있습니다.');
  const time = input.time === undefined || input.time === null ? '' : input.time;
  if (time !== '' && !isTime(time)) throw error(400, '예약 시간을 확인해 주세요.');
  const route = input.route === undefined || input.route === null ? '' : input.route;
  if (route !== '' && !ROUTES.includes(route)) throw error(400, '예약 경로를 확인해 주세요.');
  const status = input.status === undefined || input.status === null || input.status === '' ? 'booked' : input.status;
  if (!Object.hasOwn(STATUS_LABELS, status)) throw error(400, '예약 상태를 확인해 주세요.');
  return {
    date, time,
    meal: input.meal === 'lunch' || input.meal === 'dinner' ? input.meal : mealOf(time),
    name: text(input.name, LIMITS.name, '예약자명', { required: true }),
    phone: text(input.phone, LIMITS.phone, '연락처'),
    people: people(input.people),
    menu: text(input.menu, LIMITS.menu, '메뉴'),
    room: text(input.room, LIMITS.room, '룸'),
    route, status,
    memo: text(input.memo, LIMITS.memo, '비고', { multiline: true }),
    staff: text(input.staff, LIMITS.staff, '받은 직원'),
  };
}
function actorName(value) {
  try { return text(value, LIMITS.staff, '이름') || '이름 없음'; } catch (_) { return '이름 없음'; }
}
function requireId(value, message = '예약을 다시 선택해 주세요.') {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) throw error(400, message);
  return value;
}
function requireRevision(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw error(400, '화면을 새로고침한 뒤 다시 저장해 주세요.');
  return value;
}
function requireRequestId(value) {
  if (typeof value !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value)) throw error(400, '예약 등록 창을 다시 열어 주세요.');
  return value.toLowerCase();
}
function noteInput(input) {
  return {
    bookingId: requireId(input?.bookingId, '네이버 예약을 다시 선택해 주세요.'),
    date: requireDate(input?.date, '예약 날짜를 확인해 주세요.'),
    room: text(input?.room, LIMITS.room, '룸'),
    memo: text(input?.memo, LIMITS.memo, '비고', { multiline: true }),
  };
}
function noticeInput(input) {
  return {
    text: text(input?.text, LIMITS.notice, '공지 내용', { required: true, multiline: true }),
    author: actorName(input?.author),
    pinned: input?.pinned === true,
  };
}

const iso = value => (value?.toDate ? value.toDate().toISOString() : typeof value === 'string' ? value : '');
const whole = value => (Number.isSafeInteger(value) && value >= 0 ? value : 0);
function manualItem(id, data) {
  const status = Object.hasOwn(STATUS_LABELS, data.status) ? data.status : 'booked';
  const time = isTime(data.time) ? data.time : '';
  return { key: `m:${id}`, kind: 'manual', id, date: data.date, time,
    meal: data.meal === 'lunch' || data.meal === 'dinner' ? data.meal : mealOf(time),
    name: String(data.name || ''), phone: String(data.phone || ''),
    people: Number.isInteger(data.people) && data.people > 0 ? data.people : null,
    menu: String(data.menu || ''), room: String(data.room || ''), memo: String(data.memo || ''),
    route: ROUTES.includes(data.route) ? data.route : '', staff: String(data.staff || ''),
    status, statusLabel: STATUS_LABELS[status], active: status !== 'cancelled',
    source: data.source === 'sheet' ? 'sheet' : 'board', revision: whole(data.revision),
    updatedAt: iso(data.updatedAt), updatedBy: String(data.updatedBy || '') };
}
function naverItem(row, date, note, cancelledAt) {
  const menu = row.menuItems?.length ? row.menuItems.map(item => `${item.name} ${item.count}`).join(', ') : String(row.itemName || '');
  return { key: `n:${row.id}`, kind: 'naver', id: row.id, date, time: isTime(row.time) ? row.time : '',
    meal: mealOf(row.time), name: String(row.name || ''), phone: typeof row.phone === 'string' ? row.phone : '',
    people: whole(row.adults) + whole(row.children) || null, children: whole(row.children),
    menu, itemName: String(row.itemName || ''), seat: String(row.seat || ''),
    coupons: Array.isArray(row.coupons) ? row.coupons.filter(name => typeof name === 'string' && name).slice(0, 5) : [],
    request: typeof row.request === 'string' ? row.request : '',
    room: String(note?.room || ''), memo: String(note?.memo || ''),
    route: row.origin === 'manual' ? '오너비스타' : '네이버예약', origin: row.origin === 'manual' ? 'manual' : 'naver',
    status: row.status, statusLabel: NAVER_LABELS[row.status] || NAVER_LABELS.unknown, active: NAVER_ACTIVE.has(row.status),
    cancelledToday: Boolean(cancelledAt), cancelledAt: cancelledAt || '',
    revision: whole(note?.revision), updatedAt: iso(note?.updatedAt), updatedBy: String(note?.updatedBy || '') };
}
function compareItems(a, b) {
  return (a.meal === b.meal ? 0 : a.meal === 'lunch' ? -1 : 1)
    || (a.active === b.active ? 0 : a.active ? -1 : 1)
    || (a.time || '99:99').localeCompare(b.time || '99:99')
    || a.name.localeCompare(b.name, 'ko') || a.key.localeCompare(b.key);
}
function summarize(items) {
  const blank = () => ({ teams: 0, people: 0 });
  const result = { ...blank(), lunch: blank(), dinner: blank(), cancelled: 0, unknownPeople: 0 };
  for (const item of items) {
    if (!item.active) { result.cancelled += 1; continue; }
    const count = item.people || 0;
    result.teams += 1; result.people += count;
    result[item.meal].teams += 1; result[item.meal].people += count;
    if (!item.people) result.unknownPeople += 1;
  }
  return result;
}
// 하루 목록: 직접 받은 예약 + 네이버 예약. 네이버 조회가 실패해도 직접 받은 예약은 그대로 보인다.
function dayView(date, manualRows, naver, notes = {}, cancelledAt = {}) {
  const items = manualRows.filter(row => row.data.date === date && row.data.deleted !== true).map(row => manualItem(row.id, row.data));
  const feed = naver?.value;
  if (feed && Array.isArray(feed.bookings)) {
    items.push(...feed.bookings.map(row => naverItem(row, date, notes[row.id], cancelledAt[row.id])));
  }
  // 시트 시절에는 네이버 예약도 손으로 옮겨 적었다(예약경로 「네이버」). 같은 날 같은 이름의 네이버 예약이
  // 있으면 두 번 세고 있을 수 있으니 표시한다. 지우는 것은 직원이 판단한다.
  const naverNames = new Set(items.filter(item => item.kind === 'naver' && item.active).map(item => item.name.replace(/\s+/g, '')));
  for (const item of items) item.maybeDuplicate = item.kind === 'manual' && item.route === '네이버' && item.active && naverNames.has(item.name.replace(/\s+/g, ''));
  items.sort(compareItems);
  return { date, items, summary: summarize(items),
    naver: feed ? { state: feed.state, syncedAt: feed.sourceUpdatedAt ? new Date(feed.sourceUpdatedAt).toISOString() : '',
      syncFailed: feed.syncFailed === true, error: '' }
      : { state: 'error', syncedAt: '', syncFailed: false, error: naver?.error || '네이버 예약을 불러오지 못했습니다.' } };
}
// 달력: 날짜마다 올 팀·인원. 네이버는 오너비스타의 날짜별 합계(확정·이용완료)를 쓴다.
function monthView(month, manualRows, calendar) {
  const { from, days } = requireMonth(month);
  const byDate = new Map(Array.from({ length: days }, (_, i) => {
    const date = addDays(from, i);
    return [date, { date, teams: 0, people: 0, unknownPeople: 0, manualTeams: 0, naverTeams: 0, naverPeople: 0, naverVerified: false }];
  }));
  for (const row of manualRows) {
    const target = byDate.get(row.data.date);
    if (!target || row.data.deleted === true) continue;
    const item = manualItem(row.id, row.data);
    if (!item.active) continue;
    target.manualTeams += 1; target.teams += 1; target.people += item.people || 0;
    if (!item.people) target.unknownPeople += 1;
  }
  for (const day of calendar?.days || []) {
    const target = byDate.get(day.date);
    if (!target) continue;
    target.naverTeams = whole(day.activeCount); target.naverPeople = whole(day.headcount); target.naverVerified = day.verified === true;
    target.teams += target.naverTeams; target.people += target.naverPeople;
  }
  return [...byDate.values()];
}
function cancellationItems(feed) {
  return (feed?.bookings || []).map(row => ({ id: row.id, date: row.useDate, time: row.time || '', name: row.name || '',
    people: whole(row.adults) + whole(row.children) || null,
    menu: row.menuItems?.length ? row.menuItems.map(item => `${item.name} ${item.count}`).join(', ') : row.itemName || '',
    seat: row.seat || '', cancelledAt: row.cancelledAt }));
}

// ── 구글 시트 가져오기 ─────────────────────────────────────────────────────────
// 「직원 공용 예약장」 시트(첫 줄이 제목)를 gviz JSON 으로 읽는다. CSV 는 날짜가
// 「 11월 20일 금」처럼 연도 없이 나오지만 gviz 는 Date(2026,10,20) 로 준다.
const SHEET_COLUMNS = { date: '날짜', meal: '낮/밤', time: '예약시간', name: '예약자명', phone: '연락처', people: '인원',
  menu: '메뉴', route: '예약경로', memo: '비고', status: '예약상태', room: '룸', staff: '예약자' };
const SHEET_STATUS = { 예약: 'booked', 변경: 'changed', 취소: 'cancelled' };
function sheetSource(url) {
  const value = String(url || '').trim();
  const match = value.match(/^https:\/\/docs\.google\.com\/spreadsheets\/d\/([A-Za-z0-9_-]{20,100})(?:[/?#].*)?$/);
  if (!match) throw error(400, '구글 시트 주소를 확인해 주세요. https://docs.google.com/spreadsheets/d/… 로 시작합니다.');
  const gid = (value.match(/[#&?]gid=(\d{1,12})(?:\D|$)/) || [])[1] || '0';
  return { id: match[1], gid, url: `https://docs.google.com/spreadsheets/d/${match[1]}/gviz/tq?tqx=out:json&headers=1&gid=${gid}` };
}
function parseGviz(body) {
  const start = body.indexOf('setResponse(');
  const end = body.lastIndexOf(')');
  const sharing = '시트를 읽지 못했습니다. 구글 시트의 공유를 「링크가 있는 모든 사용자 · 뷰어」로 바꾼 뒤 다시 눌러 주세요.';
  if (start < 0 || end <= start) throw error(400, sharing);
  let parsed;
  try { parsed = JSON.parse(body.slice(start + 'setResponse('.length, end)); } catch (_) { throw error(400, sharing); }
  if (parsed?.status !== 'ok' || !Array.isArray(parsed.table?.cols) || !Array.isArray(parsed.table?.rows)) throw error(400, sharing);
  return parsed.table;
}
function cellText(cell) {
  if (!cell) return '';
  if (typeof cell.v === 'string') return cell.v;
  if (typeof cell.f === 'string') return cell.f;
  if (typeof cell.v === 'number' && Number.isFinite(cell.v)) return String(cell.v);
  return '';
}
// 연도 없는 「11월 20일」은 오늘에서 가장 가까운 해로 본다(지난 6개월 ~ 앞으로 6개월).
function sheetDate(cell, today) {
  const typed = typeof cell?.v === 'string' && cell.v.match(/^Date\((\d{4}),(\d{1,2}),(\d{1,2})/);
  if (typed) {
    const date = `${typed[1]}-${String(Number(typed[2]) + 1).padStart(2, '0')}-${typed[3].padStart(2, '0')}`;
    return isDate(date) ? date : '';
  }
  const raw = cellText(cell);
  const full = raw.match(/(20\d{2})\s*[-./년]\s*(\d{1,2})\s*[-./월]\s*(\d{1,2})/);
  if (full) { const date = `${full[1]}-${full[2].padStart(2, '0')}-${full[3].padStart(2, '0')}`; return isDate(date) ? date : ''; }
  const short = raw.match(/(\d{1,2})\s*[월/.-]\s*(\d{1,2})/);
  if (!short) return '';
  const year = Number(today.slice(0, 4));
  const candidates = [year - 1, year, year + 1].map(y => `${y}-${short[1].padStart(2, '0')}-${short[2].padStart(2, '0')}`).filter(isDate);
  return candidates.sort((a, b) => Math.abs(daysBetween(today, a)) - Math.abs(daysBetween(today, b)))[0] || '';
}
function sheetTime(cell) {
  const typed = typeof cell?.v === 'string' && cell.v.match(/^Date\(\d{4},\d{1,2},\d{1,2},(\d{1,2}),(\d{1,2})/);
  if (typed) return `${typed[1].padStart(2, '0')}:${typed[2].padStart(2, '0')}`;
  const raw = cellText(cell).trim();
  const match = raw.match(/^(오전|오후)?\s*(\d{1,2})\s*[:시]\s*(\d{1,2})?/);
  if (!match) return '';
  let hour = Number(match[2]);
  if (match[1] === '오후' && hour < 12) hour += 12;
  if (match[1] === '오전' && hour === 12) hour = 0;
  const time = `${String(hour).padStart(2, '0')}:${String(Number(match[3] || 0)).padStart(2, '0')}`;
  return isTime(time) ? time : '';
}
function sheetId(source, value) {
  return `s_${crypto.createHash('sha256').update([source.id, source.gid, value.date, value.time, value.name, value.phone].join('|')).digest('hex').slice(0, 32)}`;
}
function sheetRows(table, source, now) {
  const columns = {};
  table.cols.forEach((col, index) => {
    const label = String(col?.label || '').trim();
    for (const [key, name] of Object.entries(SHEET_COLUMNS)) if (label === name && columns[key] === undefined) columns[key] = index;
  });
  for (const key of ['date', 'name']) {
    if (columns[key] === undefined) throw error(400, `시트 첫 줄에서 「${SHEET_COLUMNS[key]}」 칸을 찾지 못했습니다. 「직원 공용 예약장」 탭 주소인지 확인해 주세요.`);
  }
  const today = kstDate(now);
  const rows = [], skipped = [];
  table.rows.forEach((row, index) => {
    const cells = row?.c || [];
    const cell = key => (columns[key] === undefined ? null : cells[columns[key]]);
    const name = cellText(cell('name')).trim();
    const date = sheetDate(cell('date'), today);
    if (!name && !date) return;
    const label = `${index + 1}번째 예약${name ? ` (${name})` : ''}`;
    if (!date) { skipped.push(`${label}: 날짜를 읽지 못했습니다.`); return; }
    if (!name) { skipped.push(`${label}: 예약자명이 비어 있습니다.`); return; }
    const time = sheetTime(cell('time'));
    const peopleCell = cell('people');
    const peopleText = cellText(peopleCell).trim();
    const count = typeof peopleCell?.v === 'number' ? Math.round(peopleCell.v) : Number((peopleText.match(/^\d{1,3}/) || [''])[0]);
    const exactPeople = typeof peopleCell?.v === 'number' || /^\d{1,3}(?:\.0+)?$/.test(peopleText);
    const mealText = cellText(cell('meal')).trim();
    const routeText = cellText(cell('route')).trim();
    const memo = [cellText(cell('memo')), !exactPeople && peopleText ? `인원: ${peopleText}` : ''].filter(Boolean).join('\n');
    try {
      const value = reservationInput({ date, time, meal: mealText === '낮' ? 'lunch' : mealText === '밤' ? 'dinner' : undefined,
        name, phone: cellText(cell('phone')), people: count >= 1 && count <= 999 ? count : null, menu: cellText(cell('menu')),
        room: cellText(cell('room')), route: ROUTES.includes(routeText) ? routeText : routeText ? '기타' : '',
        status: SHEET_STATUS[cellText(cell('status')).trim()] || 'booked', memo, staff: cellText(cell('staff')) }, now);
      rows.push({ id: sheetId(source, value), value });
    } catch (err) {
      skipped.push(`${label}: ${err.message}`);
    }
  });
  return { rows, skipped };
}

function shareHash(token) {
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) throw error(403, '예약장 링크가 올바르지 않습니다. 관리자에게 링크를 다시 받아 주세요.');
  return crypto.createHash('sha256').update(token).digest('hex');
}

module.exports = { KST_OFFSET_MS, LUNCH_UNTIL, ROUTES, STATUS_LABELS, NAVER_LABELS, MAX_RANGE_DAYS, LIMITS, SHEET_COLUMNS,
  error, kstDate, isDate, requireDate, addDays, requireRange, requireMonth, mealOf, reservationInput, actorName,
  requireId, requireRevision, requireRequestId, noteInput, noticeInput, manualItem, naverItem, summarize, dayView,
  monthView, cancellationItems, sheetSource, parseGviz, sheetDate, sheetTime, sheetRows, shareHash };
