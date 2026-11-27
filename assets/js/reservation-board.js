(function () {
  'use strict';
  // 돌담명가 직원 공용 예약장. 관리자가 준 링크(#token=…)로 연다. 로그인은 없다.
  // 직접 받은 예약은 등록·수정·삭제, 네이버 예약은 자동으로 보이고 룸·비고만 덧붙인다.
  const root = document.getElementById('rb-app');
  if (!root) return;
  const API = root.dataset.api;
  const KST = 9 * 3600000;
  const LUNCH_UNTIL = '16:00';
  const TIME_CHIPS = ['11:30', '12:00', '12:30', '13:00', '17:00', '17:30', '18:00', '18:30', '19:00', '19:30'];
  const PEOPLE_CHIPS = [2, 4, 6, 8, 10, 20];
  const BASE_MENUS = ['고기', '소(명품)', '돼지', '돼지갈비', '차돌쌈밥', '식사'];
  const WD = ['일', '월', '화', '수', '목', '금', '토'];
  const ROUTES = ['전화', '방문', '기타'];
  const STATUS = [['booked', '예약'], ['changed', '변경'], ['cancelled', '취소']];
  // 화면 안 사용법. 실제 동작을 적는다 — 동작을 바꾸면 이것도 같이 고친다(테스트가 대조한다).
  const HELP = [
    ['예약 보기', ['맨 위 「하루 · 일주일 · 달력」으로 보는 방식을 고릅니다. 고른 방식은 이 휴대폰에 기억됩니다.',
      '「📖 직원 매뉴얼」 탭에는 고객 응대(고기·소스 순서), 홀·주방 근무수칙, 계산·정산이 정리돼 있습니다.',
      '하루: 날짜 띠를 옆으로 밀어 날짜를 고르고, ‹ › 로 하루씩 넘깁니다. 낮(16시 전)과 밤(16시부터)으로 나뉩니다.',
      '일주일: 월요일부터 일요일까지 한 화면에 보입니다. 날짜 제목을 누르면 그날 하루 보기로 갑니다.',
      '달력: 날짜마다 팀 수와 인원이 보이고, 날짜를 누르면 아래에 그날 예약이 나옵니다.',
      '팀·인원 합계에는 취소된 예약이 들어가지 않습니다. 취소된 예약은 각 칸 맨 아래에 흐리게 남습니다.']],
    ['예약 등록 · 수정 · 삭제', ['오른쪽 아래 「＋ 예약 등록」을 누릅니다. 아는 만큼만 적으면 되고, 빈 칸이 있어도 저장됩니다.',
      '새 예약에 예약자명·시간·인원·연락처·메뉴 중 빈 칸이 있으면 한 번만 「빠진 정보가 있어요」 창이 뜹니다. 거기서 바로 적거나, 비워 둔 채 저장하면 됩니다. 예약자명을 비우면 「이름 미정」으로 저장됩니다.',
      '맨 위 「한 줄로 빠르게 입력」에 「홍길동 12월18일 금요일 6시 20~24명 1층 소고기 010-0000-0000」처럼 적거나 카톡 내용을 붙여 넣으면 날짜·시간·인원·룸·메뉴·연락처·예약자명이 칸에 나뉘어 들어갑니다. 「6시30분 홍길동4명 특수부위 오늘」처럼 순서가 달라도, 날짜를 오늘·내일·모레로 적어도 됩니다. 붙여 넣으면 바로, 직접 적었으면 「칸에 나눠 넣기」를 누르세요.',
      '오전·오후를 안 적은 1~9시는 저녁으로 봅니다(6시 → 18:00). 「20~24명」은 24명으로 넣고 비고에 범위를 남깁니다. 적은 요일이 날짜와 다르면 알려 줍니다. 채워진 칸을 확인하고 등록하세요.',
      '시간을 고르면 낮/밤이 저절로 맞춰집니다(16시 전 낮). 인원을 모르면 비워 두면 「인원 미정」으로 보입니다.',
      '예약 카드를 누르면 고칠 수 있습니다. 손님이 취소하면 예약상태를 「취소」로 바꾸세요. 기록이 남습니다.',
      '「삭제」는 잘못 적은 예약을 지울 때만 씁니다. 지운 예약도 기록은 남아 있어 관리자에게 말하면 되살릴 수 있습니다.',
      '다른 직원이 먼저 고친 예약을 저장하면 막힙니다. 새로고침해서 바뀐 내용을 보고 다시 저장하세요.']],
    ['네이버 예약', ['네이버 예약은 초록색 「N 네이버예약」 표시로 자동으로 들어옵니다(오너비스타 수집, 몇 분 늦을 수 있음).',
      '네이버 손님도 전화번호가 보입니다. 카드 오른쪽 ☎ 를 누르면 바로 전화가 걸립니다.',
      '손님이 네이버 쿠폰을 쓴 예약은 카드에 「🎟 쿠폰 · 리뷰 육사시미 증정」처럼 쿠폰 이름이 보입니다(일주일 보기는 🎟 표시). 증정 쿠폰이면 따로 챙겨 주세요.',
      '손님이 네이버 예약에 요청사항을 남겼으면 카드에 「💬 요청 · 창가 자리 부탁드려요」처럼 보입니다(길면 두 줄까지, 일주일 보기는 💬 표시). 카드를 누르면 전체 내용이 나옵니다. 손님 개인 사정이 적혀 있을 수 있으니 링크는 직원끼리만 나눠 주세요.',
      '네이버 예약의 날짜·인원 변경과 취소는 네이버(스마트플레이스)나 오너비스타에서 합니다. 여기서는 룸과 비고만 적을 수 있습니다.',
      '네이버 예약이 취소되면, 취소된 그날에만 이 화면을 열 때 경고 창이 뜹니다. 「오늘 그만 보기」를 누르면 이 휴대폰에서는 오늘 더 뜨지 않습니다(새로 취소된 예약은 다시 뜹니다).']],
    ['공지 · 내 이름 · 언어', ['맨 위 공지에서 「＋ 공지 쓰기」로 모두에게 알릴 내용을 적습니다. 공지를 누르면 고치거나 지울 수 있고, 「맨 위 고정」을 켜면 가장 위에 보입니다.',
      '오른쪽 위 이름 버튼에 내 이름을 적어 두면 등록할 때 「받은 직원」에 자동으로 들어가고, 누가 고쳤는지 기록됩니다.',
      '오른쪽 위 🇻🇳 버튼(Tiếng Việt, 휴대폰에서는 VI)을 누르면 화면과 직원 매뉴얼이 베트남어로 바뀝니다. 이름·메뉴·비고·공지처럼 직원과 손님이 적은 글은 그대로이고, 메뉴에는 뜻이 옆에 붙습니다. 🇰🇷 버튼(한국어, 휴대폰에서는 KO)을 누르면 돌아오고, 고른 말은 이 휴대폰에 기억됩니다.',
      '화면은 2분마다, 그리고 다시 열 때마다 새로 불러옵니다. 바로 보려면 ↻ 를 누르세요.',
      '이 링크를 가진 사람은 누구나 예약을 보고 고칠 수 있습니다. 직원 단톡방 밖으로 보내지 마세요.']],
  ];

  const store = {
    get(key) { try { return localStorage.getItem(key); } catch (_) { return null; } },
    set(key, value) { try { localStorage.setItem(key, value); } catch (_) { /* 사생활 모드: 이번 화면에서만 기억 */ } },
    remove(key) { try { localStorage.removeItem(key); } catch (_) { /* ignore */ } },
  };
  // 화면 말: 한국어(ko) · 베트남어(vi). 한국어 문구를 열쇠로 reservation-board-i18n.js 에서 찾는다. 없으면 한국어 그대로.
  // 이름·메뉴·비고·공지·요청사항처럼 사람이 적은 글은 번역하지 않는다(메뉴는 아는 낱말 뜻만 옆에 단다).
  const I18N = window.ReservationBoardI18n || { vi: {}, HELP_VI: [], WD_VI: [], STATUS_VI: { manual: {}, naver: {} }, ROUTE_VI: {}, MISSING_VI: {}, MENU_VI: [], SERVER_VI: {} };
  const LANGS = ['ko', 'vi'];
  let LANG = LANGS.includes(store.get('rb-lang')) ? store.get('rb-lang') : (/^vi\b/i.test(navigator.language || '') ? 'vi' : 'ko');
  const isVi = () => LANG === 'vi';
  const t = (ko, vars = null) => {
    const text = isVi() ? (I18N.vi[ko] ?? ko) : ko;
    return vars ? text.replace(/\{(\w+)\}/g, (_, key) => String(vars[key] ?? '')) : text;
  };
  document.documentElement.lang = LANG;
  const valid = value => /^[a-f0-9]{64}$/.test(value || '');
  const fromHash = new URLSearchParams(location.hash.slice(1)).get('token') || '';
  if (valid(fromHash)) store.set('rb-token', fromHash);
  let token = valid(fromHash) ? fromHash : (valid(store.get('rb-token')) ? store.get('rb-token') : '');
  // 홈 화면에 추가할 때도 링크가 따라가게 주소에 다시 붙여 둔다.
  if (token && !valid(fromHash)) history.replaceState(null, '', `${location.pathname}${location.search}#token=${token}`);

  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const kstToday = () => new Date(Date.now() + KST).toISOString().slice(0, 10);
  const addDays = (date, n) => { const v = new Date(`${date}T00:00:00Z`); v.setUTCDate(v.getUTCDate() + n); return v.toISOString().slice(0, 10); };
  const weekday = date => new Date(`${date}T00:00:00Z`).getUTCDay();
  const wdName = w => (isVi() ? I18N.WD_VI[w] : WD[w]);
  const md = date => (isVi() ? `${Number(date.slice(8, 10))}/${Number(date.slice(5, 7))}` : `${Number(date.slice(5, 7))}월 ${Number(date.slice(8, 10))}일`);
  const mdw = date => (isVi() ? `${wdName(weekday(date))} ${md(date)}` : `${md(date)} (${WD[weekday(date)]})`);
  const monthTitle = month => (isVi() ? `Tháng ${Number(month.slice(5))}/${month.slice(0, 4)}` : `${month.slice(0, 4)}년 ${Number(month.slice(5))}월`);
  const weekStart = date => addDays(date, -((weekday(date) + 6) % 7));
  const shiftMonth = (month, n) => { const v = new Date(`${month}-01T00:00:00Z`); v.setUTCMonth(v.getUTCMonth() + n); return v.toISOString().slice(0, 7); };
  const monthDays = month => { const v = new Date(`${month}-01T00:00:00Z`); v.setUTCMonth(v.getUTCMonth() + 1, 0); return v.getUTCDate(); };
  const clock = value => (value ? new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(value)) : '');
  const stamp = value => {
    if (!value) return '';
    const kst = new Date(new Date(value).getTime() + KST).toISOString();
    return `${Number(kst.slice(5, 7))}/${Number(kst.slice(8, 10))} ${kst.slice(11, 16)}`;
  };
  const mealOf = time => (time && time < LUNCH_UNTIL ? 'lunch' : 'dinner');
  // 네이버 쿠폰 이름을 짧게: 앞의 「네이버」, 뒤의 「쿠폰」은 뗀다(오너비스타 단톡방 줄과 같은 규칙). 그것뿐이면 그대로.
  const couponLabel = name => { const whole = String(name || '').replace(/\s+/g, ' ').trim(); return whole.replace(/^네이버\s*/, '').replace(/\s*쿠폰$/, '').trim() || whole; };
  // 날짜 옆 「오늘·내일·모레」 표시.
  const relTag = date => { const word = window.ReservationQuickEntry?.relativeDay(date, S.today) || ''; return word ? `<em${word === '오늘' ? '' : ' class="is-soon"'}>${esc(t(word))}</em>` : ''; };
  // 사람이 적은 값은 그대로 두고, 정해진 값(상태·경로·빈 이름)만 고른 말로 보인다.
  const statusText = item => (isVi() ? I18N.STATUS_VI[item.kind === 'naver' ? 'naver' : 'manual']?.[item.status] || item.statusLabel : item.statusLabel);
  const routeText = route => (isVi() ? I18N.ROUTE_VI[route] || route : route);
  const nameText = name => (!name ? t('이름 없음') : name === window.ReservationQuickEntry?.NO_NAME ? t('이름 미정') : name);
  const peopleText = people => (people ? t('{n}명', { n: people }) : t('인원 미정'));
  // 베트남어로 볼 때 메뉴에 아는 낱말 뜻을 붙인다(긴 낱말부터, 겹치지 않게). 메뉴 글자는 그대로 둔다.
  function menuGloss(menu) {
    if (!isVi() || !menu) return '';
    let rest = String(menu); const found = [];
    for (const [word, meaning] of [...I18N.MENU_VI].sort((a, b) => b[0].length - a[0].length)) {
      if (rest.includes(word)) { found.push(meaning); rest = rest.split(word).join(' '); }
    }
    return found.length ? `<small class="rb-gloss">${esc([...new Set(found)].join(', '))}</small>` : '';
  }
  const telHref = phone => { const digits = String(phone || '').replace(/\D/g, ''); return digits.length === 8 ? `010${digits}` : digits.length >= 9 ? digits : ''; };
  function uuid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    const b = crypto.getRandomValues(new Uint8Array(16)); b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
    const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }

  const NO_LINK = '관리자에게 받은 예약장 링크로 열어 주세요. 링크 끝의 #token=… 까지 모두 있어야 합니다.';
  const VIEWS = ['day', 'week', 'month', 'guide'];
  const S = { view: VIEWS.includes(store.get('rb-view')) ? store.get('rb-view') : 'day', today: kstToday(), date: kstToday(),
    me: store.get('rb-name') || '', range: null, months: {}, notices: [], cancellations: null, menuOptions: [], storeName: '돌담명가',
    loading: false, error: '', fatal: token ? '' : NO_LINK,
    sheet: null, allNotices: false, pollMs: 120000, lastLoaded: 0, seenCancels: new Set() };

  async function api(action, body = {}) {
    const abort = new AbortController(), timer = setTimeout(() => abort.abort(), 20000);
    try {
      const response = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store', referrerPolicy: 'no-referrer',
        body: JSON.stringify({ action, token, ...body }), signal: abort.signal });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) throw Object.assign(new Error(serverMessage(response.status, result.error)), { status: response.status });
      return result;
    } catch (err) {
      if (err.name === 'AbortError') throw Object.assign(new Error(t('연결이 늦어지고 있습니다. 잠시 후 다시 시도해 주세요.')), { status: 0 });
      if (err instanceof TypeError) throw Object.assign(new Error(t('인터넷 연결을 확인해 주세요.')), { status: 0 });
      throw err;
    } finally { clearTimeout(timer); }
  }

  // 서버가 보낸 한국어 오류. 베트남어로 볼 때는 상태 번호로 뜻을 옮기고, 입력 오류는 원문을 괄호에 남긴다(한국 직원이 도와줄 수 있게).
  function serverMessage(status, message) {
    if (!isVi()) return message || '연결을 확인한 뒤 다시 시도해 주세요.';
    const known = I18N.SERVER_VI[status];
    if (status === 400 && message) return `${I18N.SERVER_VI[400]} (${message})`;
    return known || I18N.SERVER_VI.other || message || '';
  }

  let sequence = 0;
  async function load() {
    if (!token) { render(); return; }
    const mine = ++sequence;
    const from = S.view === 'week' ? weekStart(S.date) : S.date;
    const to = S.view === 'week' ? addDays(from, 6) : S.date;
    const month = S.date.slice(0, 7);
    S.loading = true; renderStatus();
    try {
      const [read, monthData] = await Promise.all([api('read', { from, to }),
        S.view === 'week' ? null : api('month', { month }).catch(() => null)]);
      if (mine !== sequence) return;
      Object.assign(S, { today: read.today, range: read, notices: read.notices, cancellations: read.cancellations, menuOptions: read.menuOptions || [],
        storeName: read.storeName || '돌담명가', pollMs: read.pollMs || 120000, error: '', fatal: '', lastLoaded: Date.now() });
      if (monthData) S.months[month] = monthData;
      render();
      showCancellations();
    } catch (err) {
      if (mine !== sequence) return;
      if (err.status === 403) {
        if (store.get('rb-token') === token) store.remove('rb-token');
        S.fatal = err.message;
      }
      S.error = err.message;
      render();
    } finally {
      if (mine === sequence) { S.loading = false; renderStatus(); }
    }
  }

  // ── 그리기 ──────────────────────────────────────────────────────────────
  function routeBadge(item) {
    if (item.kind === 'naver') return item.origin === 'manual' ? `<span class="rb-badge rb-badge-ov">${t('오너비스타')}</span>` : `<span class="rb-badge rb-badge-naver"><b>N</b>${t('네이버예약')}</span>`;
    if (!item.route) return '';
    return `<span class="rb-badge rb-badge-route">${esc(item.route === '네이버' ? t('네이버(직접 적음)') : routeText(item.route))}</span>`;
  }
  function statusChip(item) {
    if (item.cancelledToday) return `<span class="rb-status rb-status-cancel">${t('오늘 취소')}</span>`;
    if (!item.active) return `<span class="rb-status rb-status-cancel">${esc(statusText(item))}</span>`;
    if (item.status === 'changed') return `<span class="rb-status rb-status-changed">${t('변경')}</span>`;
    if (item.status === 'requested') return `<span class="rb-status rb-status-wait">${t('확정 대기')}</span>`;
    return '';
  }
  function card(item) {
    const room = item.room || item.seat;
    const tel = telHref(item.phone);
    const who = item.updatedBy && item.updatedBy !== '이름 없음' ? `${item.updatedBy} ` : '';
    const verb = item.kind === 'naver' ? t('메모') : item.revision > 1 ? t('수정') : t('등록');
    const meta = [item.kind === 'manual' && item.staff ? t('받은 직원 {name}', { name: item.staff }) : '',
      item.updatedAt ? `${verb} ${who}${stamp(item.updatedAt)}` : ''].filter(Boolean);
    return `<article class="rb-card rb-${item.kind}${item.active ? '' : ' is-off'}${item.cancelledToday ? ' is-cancelled-today' : ''}" data-open="${esc(item.key)}" data-date="${esc(item.date)}" tabindex="0" role="button" aria-label="${esc(`${item.time || t('시간 미정')} ${nameText(item.name)} ${peopleText(item.people)} ${routeText(item.route)} ${statusText(item)}`)}">
      <div class="rb-card-time">${item.time ? esc(item.time) : `<small>${t('시간<br>미정')}</small>`}</div>
      <div class="rb-card-body">
        <div class="rb-card-top"><strong class="rb-card-name">${esc(nameText(item.name))}</strong><span class="rb-card-people">${esc(peopleText(item.people))}</span>${statusChip(item)}</div>
        <div class="rb-card-tags">${routeBadge(item)}${room ? `<span class="rb-badge rb-badge-room">${esc(room)}</span>` : ''}${item.menu ? `<span class="rb-card-menu">${esc(item.menu)}${menuGloss(item.menu)}</span>` : ''}</div>
        ${(item.coupons || []).length ? `<div class="rb-card-coupons">${item.coupons.map(name => `<span class="rb-badge rb-badge-coupon" title="${esc(name)}">${t('🎟 쿠폰 ·')} ${esc(couponLabel(name))}</span>`).join('')}</div>` : ''}
        ${item.request ? `<p class="rb-card-request"><span>${t('💬 요청 ·')} ${esc(item.request)}</span></p>` : ''}
        ${item.memo ? `<p class="rb-card-memo">${esc(item.memo)}</p>` : ''}
        ${item.maybeDuplicate ? `<p class="rb-card-dup">${t('같은 이름의 네이버예약이 따로 있습니다. 같은 예약이면 이 줄은 삭제하세요.')}</p>` : ''}
        ${meta.length ? `<p class="rb-card-meta">${esc(meta.join(' · '))}</p>` : ''}
      </div>
      ${tel ? `<a class="rb-call" href="tel:${esc(tel)}" aria-label="${esc(t('{name}에게 전화', { name: nameText(item.name) }))}">☎</a>` : ''}
    </article>`;
  }
  function daySummary(day) {
    const s = day.summary;
    return `<div class="rb-summary"><div class="rb-summary-main">${t('<b>{teams}</b>팀 <b>{people}</b>명', { teams: s.teams, people: s.people })}${s.unknownPeople ? `<small>${t('+ 인원 미정 {n}팀', { n: s.unknownPeople })}</small>` : ''}</div>
      <div class="rb-summary-meals"><span>${t('☀ 낮')} ${t('{teams}팀 {people}명', { teams: s.lunch.teams, people: s.lunch.people })}</span><span>${t('☾ 밤')} ${t('{teams}팀 {people}명', { teams: s.dinner.teams, people: s.dinner.people })}</span>${s.cancelled ? `<span class="rb-off">${t('취소 {n}', { n: s.cancelled })}</span>` : ''}</div></div>`;
  }
  function naverLine(days) {
    const failed = days.find(day => day.naver.state === 'error');
    if (failed) return `<p class="rb-warn" role="status">⚠ ${esc(isVi() ? t('네이버 예약을 불러오지 못했습니다.') : failed.naver.error)} ${t('직접 등록한 예약만 보입니다.')}</p>`;
    if (days.some(day => day.naver.state === 'unconfigured')) return `<p class="rb-warn" role="status">${t('네이버 예약 연결이 아직 설정되지 않았습니다.')} ${t('직접 등록한 예약만 보입니다.')}</p>`;
    const synced = days.map(day => day.naver.syncedAt).filter(Boolean).sort().at(-1);
    const stale = days.some(day => day.naver.syncFailed) || (synced && Date.now() - Date.parse(synced) > 15 * 60000);
    if (stale) return `<p class="rb-warn" role="status">${t('네이버 예약 최근 변경이 아직 안 들어왔을 수 있습니다.')}${synced ? ` ${esc(t('(마지막 반영 {time})', { time: stamp(synced) }))}` : ''}</p>`;
    return synced ? `<p class="rb-sync">${esc(t('네이버 예약 {time} 반영', { time: clock(synced) }))}</p>` : '';
  }
  function dayList(day) {
    if (!day) return `<div class="rb-empty">${t('예약을 불러오는 중…')}</div>`;
    const meal = (key, label, summary) => {
      const items = day.items.filter(item => item.meal === key);
      return `<section class="rb-meal rb-meal-${key}"><h3>${label}<small>${t('{teams}팀 {people}명', { teams: summary.teams, people: summary.people })}</small></h3>${items.length ? items.map(card).join('') : `<p class="rb-none">${t('예약 없음')}</p>`}</section>`;
    };
    const cancelled = (S.cancellations?.items || []).length;
    return `${daySummary(day)}${cancelled ? `<button class="rb-cancel-bar" data-act="show-cancels">${t('⚠ 오늘 취소된 네이버 예약 {n}건 보기', { n: cancelled })}</button>` : ''}${naverLine([day])}
      ${day.items.length ? meal('lunch', t('☀ 낮'), day.summary.lunch) + meal('dinner', t('☾ 밤'), day.summary.dinner) : `<div class="rb-empty">${t('{date} 예약이 없습니다.<br>오른쪽 아래 ＋ 로 등록하세요.', { date: md(day.date) })}</div>`}`;
  }
  function strip() {
    const month = S.date.slice(0, 7), counts = new Map((S.months[month]?.days || []).map(day => [day.date, day]));
    return `<div class="rb-strip" role="group" aria-label="${t('날짜 고르기')}">${Array.from({ length: monthDays(month) }, (_, i) => {
      const date = `${month}-${String(i + 1).padStart(2, '0')}`, count = counts.get(date), w = weekday(date);
      return `<button class="rb-chip${date === S.date ? ' is-selected' : ''}${date === S.today ? ' is-today' : ''}${w === 0 ? ' is-sun' : w === 6 ? ' is-sat' : ''}" data-pick="${date}" aria-pressed="${date === S.date}" aria-label="${esc(mdw(date))}${count?.teams ? ` ${esc(t('{n}팀', { n: count.teams }))}` : ''}">
        <span class="rb-chip-wd">${esc(wdName(w))}</span><span class="rb-chip-day">${i + 1}</span><span class="rb-chip-count">${count ? (count.teams ? esc(t('{n}팀', { n: count.teams })) : '') : '·'}</span></button>`;
    }).join('')}</div>`;
  }
  function dateBar() {
    return `<div class="rb-datebar"><button class="rb-icon" data-act="prev" aria-label="${t('이전 날')}">‹</button>
      <label class="rb-datebar-label"><span>${esc(mdw(S.date))}${relTag(S.date)}</span><input type="date" data-date-input value="${S.date}" aria-label="${t('날짜 바로 고르기')}"></label>
      <button class="rb-icon" data-act="next" aria-label="${t('다음 날')}">›</button>${S.date === S.today ? '' : `<button class="rb-today" data-act="today">${t('오늘')}</button>`}</div>`;
  }
  function dayView() {
    const day = S.range?.days?.find(row => row.date === S.date);
    return `${dateBar()}${strip()}${dayList(day)}`;
  }
  function weekView() {
    const start = weekStart(S.date), end = addDays(start, 6);
    const days = S.range?.from === start ? S.range.days : null;
    const endLabel = !isVi() && start.slice(5, 7) === end.slice(5, 7) ? `${Number(end.slice(8))}일` : md(end);
    const head = `<div class="rb-datebar"><button class="rb-icon" data-act="prev-week" aria-label="${t('지난 주')}">‹</button><div class="rb-datebar-label"><span>${esc(md(start))} – ${esc(endLabel)}</span></div><button class="rb-icon" data-act="next-week" aria-label="${t('다음 주')}">›</button>${weekStart(S.today) === start ? '' : `<button class="rb-today" data-act="today">${t('이번 주')}</button>`}</div>`;
    if (!days) return `${head}<div class="rb-empty">${t('일주일 예약을 불러오는 중…')}</div>`;
    const line = item => `<button class="rb-line${item.active ? '' : ' is-off'}" data-open="${esc(item.key)}" data-date="${esc(item.date)}"><span class="rb-line-time">${esc(item.time || t('미정'))}</span><span class="rb-line-name">${esc(nameText(item.name))}</span><span class="rb-line-people">${item.people ? esc(t('{n}명', { n: item.people })) : '?'}</span><span class="rb-line-menu">${esc(item.menu)}${menuGloss(item.menu)}</span>${(item.coupons || []).length ? `<span class="rb-coupon-mark" title="${esc(item.coupons.join(', '))}">🎟</span>` : ''}${item.request ? `<span class="rb-coupon-mark" title="${t('요청사항 있음')}">💬</span>` : ''}${item.kind === 'naver' ? `<span class="rb-n" title="${t('네이버예약')}">N</span>` : ''}${item.active ? '' : `<span class="rb-line-off">${esc(item.cancelledToday ? t('오늘 취소') : statusText(item))}</span>`}</button>`;
    return `${head}${naverLine(days)}${days.map(day => `<section class="rb-weekday${day.date === S.today ? ' is-today' : ''}${weekday(day.date) === 0 ? ' is-sun' : weekday(day.date) === 6 ? ' is-sat' : ''}">
      <button class="rb-weekday-head" data-goto="${day.date}"><span>${esc(mdw(day.date))}${relTag(day.date)}</span><span>${day.summary.teams ? esc(t('{teams}팀 {people}명', { teams: day.summary.teams, people: day.summary.people })) : t('예약 없음')} ›</span></button>
      ${['lunch', 'dinner'].map(meal => { const items = day.items.filter(item => item.meal === meal); return items.length ? `<div class="rb-week-meal"><span class="rb-week-meal-label">${meal === 'lunch' ? t('☀ 낮') : t('☾ 밤')}</span><div>${items.map(line).join('')}</div></div>` : ''; }).join('')}
    </section>`).join('')}`;
  }
  function monthView() {
    const month = S.date.slice(0, 7), data = S.months[month], counts = new Map((data?.days || []).map(day => [day.date, day]));
    const first = weekday(`${month}-01`);
    const cells = Array.from({ length: first }, () => '<span class="rb-cal-blank"></span>');
    for (let i = 1; i <= monthDays(month); i++) {
      const date = `${month}-${String(i).padStart(2, '0')}`, count = counts.get(date), w = weekday(date);
      const people = count?.teams ? (count.people ? `${t('{n}명', { n: count.people })}${count.unknownPeople ? '+' : ''}` : t('인원?')) : '';
      cells.push(`<button class="rb-cal-day${date === S.date ? ' is-selected' : ''}${date === S.today ? ' is-today' : ''}${w === 0 ? ' is-sun' : w === 6 ? ' is-sat' : ''}${count?.teams ? ' has' : ''}" data-pick="${date}" aria-pressed="${date === S.date}" aria-label="${esc(mdw(date))}${count?.teams ? ` ${esc(t('{n}팀', { n: count.teams }))} ${esc(people)}` : ''}"><span class="rb-cal-num">${i}</span>${count?.teams ? `<span class="rb-cal-teams">${esc(t('{n}팀', { n: count.teams }))}</span><span class="rb-cal-people">${esc(people)}</span>` : ''}</button>`);
    }
    const day = S.range?.days?.find(row => row.date === S.date);
    return `<div class="rb-datebar"><button class="rb-icon" data-act="prev-month" aria-label="${t('지난 달')}">‹</button><div class="rb-datebar-label"><span>${esc(monthTitle(month))}</span></div><button class="rb-icon" data-act="next-month" aria-label="${t('다음 달')}">›</button>${S.date.slice(0, 7) === S.today.slice(0, 7) ? '' : `<button class="rb-today" data-act="today">${t('오늘')}</button>`}</div>
      <div class="rb-cal">${WD.map((_, i) => `<span class="rb-cal-wd${i === 0 ? ' is-sun' : i === 6 ? ' is-sat' : ''}">${esc(wdName(i))}</span>`).join('')}${cells.join('')}</div>
      ${data ? (data.naverState === 'calendar' ? '' : `<p class="rb-warn">${t('네이버 예약 합계를 불러오지 못해 직접 등록한 예약만 셌습니다.')}</p>`) : `<p class="rb-sync">${t('달력 합계를 불러오는 중…')}</p>`}
      <h2 class="rb-day-title">${esc(mdw(S.date))}${S.date === S.today ? ` · ${t('오늘')}` : ''}</h2>${dayList(day)}`;
  }
  function notices() {
    const list = S.notices || [];
    const shown = S.allNotices ? list : list.slice(0, 2);
    return `<section class="rb-notices" aria-label="${t('공지사항')}"><div class="rb-notices-head"><h2>${t('📢 공지')}</h2><button class="rb-link" data-act="notice-new">${t('＋ 공지 쓰기')}</button></div>
      ${shown.length ? shown.map(n => `<button class="rb-notice${n.pinned ? ' is-pinned' : ''}" data-notice="${esc(n.id)}">${n.pinned ? `<span class="rb-pin">${t('📌 고정')}</span>` : ''}<span class="rb-notice-text">${esc(n.text)}</span><span class="rb-notice-meta">${esc(n.author)} · ${esc(stamp(n.createdAt))}</span></button>`).join('') : `<p class="rb-none">${t('공지가 없습니다.')}</p>`}
      ${list.length > 2 ? `<button class="rb-link rb-more" data-act="notice-more">${S.allNotices ? t('접기') : t('공지 {n}개 모두 보기', { n: list.length })}</button>` : ''}</section>`;
  }
  // 「📖 직원 매뉴얼」: 홀·주방 운영 매뉴얼(reservation-guide.js). 고른 말로 보이고, 손님에게 하는 말은 한국어 원문도 같이 둔다.
  function guideBlock(block) {
    const title = block.title ? `<h4>${esc(block.title)}</h4>` : '';
    if (block.type === 'list') return `<div class="rb-g-block">${title}<ul class="rb-g-list">${block.items.map(text => `<li>${esc(text)}</li>`).join('')}</ul></div>`;
    if (block.type === 'flow') return `<div class="rb-g-block">${title}<ol class="rb-g-flow">${block.steps.map((step, i) => `<li><span class="rb-g-step">${i + 1}</span>${esc(step)}</li>`).join('')}</ol></div>`;
    if (block.type === 'say') return `<div class="rb-g-block">${title}<figure class="rb-g-say">${block.ko ? `<blockquote lang="ko">${esc(block.ko)}</blockquote><figcaption>${esc(block.text)}</figcaption>` : `<blockquote>${esc(block.text)}</blockquote>`}</figure></div>`;
    if (block.type === 'cards') return `<div class="rb-g-block">${title}<div class="rb-g-cards">${block.items.map(card => `<div class="rb-g-card"><span class="rb-g-num">${esc(card.num)}</span><div><strong>${esc(card.name)}</strong>${card.ko ? `<small lang="ko">${esc(card.ko)}</small>` : ''}<ul>${card.desc.map(text => `<li>${esc(text)}</li>`).join('')}</ul></div></div>`).join('')}</div></div>`;
    if (block.type === 'note') return `<div class="rb-g-note">${block.title ? `<strong>${esc(block.title)}</strong>` : ''}<p>${esc(block.text)}</p>${block.items ? `<ul>${block.items.map(text => `<li>${esc(text)}</li>`).join('')}</ul>` : ''}</div>`;
    if (block.type === 'table') return `<div class="rb-g-block">${title}<table class="rb-g-table"><thead><tr>${block.head.map(cell => `<th>${esc(cell)}</th>`).join('')}</tr></thead><tbody>${block.rows.map(row => `<tr>${row.map(cell => `<td>${esc(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
    if (block.type === 'summary') return `<div class="rb-g-summary"><strong>${esc(block.title)}</strong><dl>${block.rows.map(([label, value]) => `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl>${block.footer ? `<p>${esc(block.footer)}</p>` : ''}</div>`;
    return '';
  }
  function guideView() {
    const guide = window.ReservationGuide?.[LANG] || window.ReservationGuide?.ko;
    if (!guide) return `<div class="rb-empty">${t('매뉴얼을 불러오지 못했습니다. 새로고침해 주세요.')}</div>`;
    return `<article class="rb-guide"><header class="rb-guide-head"><h2>${esc(guide.title)}</h2><p>${esc(guide.intro)}</p>
      <nav class="rb-guide-toc" aria-label="${esc(t('매뉴얼 차례'))}">${guide.sections.map(section => `<button type="button" data-guide-jump="${esc(section.id)}"><span aria-hidden="true">${section.icon}</span>${esc(section.label)}</button>`).join('')}</nav></header>
      ${guide.sections.map(section => `<section class="rb-guide-section" id="rb-guide-${esc(section.id)}"><h3><span class="rb-guide-icon" aria-hidden="true">${section.icon}</span>${esc(section.title)}<em>${esc(section.who)}</em></h3>${section.blocks.map(guideBlock).join('')}</section>`).join('')}
    </article>`;
  }
  function render() {
    if (S.fatal) {
      root.innerHTML = `${header()}<main class="rb-main"><div class="rb-fatal" role="alert"><h2>${t('예약장을 열 수 없습니다')}</h2><p>${esc(S.fatal === NO_LINK ? t(NO_LINK) : S.fatal)}</p></div></main>`;
      return;
    }
    const guide = S.view === 'guide';
    const body = S.view === 'week' ? weekView() : S.view === 'month' ? monthView() : guide ? guideView() : dayView();
    root.innerHTML = `${header()}<main class="rb-main">${S.error ? `<p class="rb-error" role="alert">${esc(S.error)}</p>` : ''}${guide ? '' : notices()}
      <nav class="rb-tabs" aria-label="${t('보기 방식')}">${[['day', t('하루')], ['week', t('일주일')], ['month', t('달력')], ['guide', t('📖 직원 매뉴얼')]].map(([key, label]) => `<button data-view="${key}" aria-pressed="${S.view === key}">${label}</button>`).join('')}</nav>
      ${body}
      <footer class="rb-footer"><span id="rb-status"></span><button class="rb-link" data-act="help">${t('사용법')}</button></footer></main>
      ${guide ? '' : `<button class="rb-fab" data-act="add">${t('＋ 예약 등록')}</button>`}`;
    renderStatus();
    // 다시 그릴 때마다 날짜 띠를 고른 날짜가 가운데 오게 맞춘다(화면 위아래는 움직이지 않는다).
    const stripEl = root.querySelector('.rb-strip'), chip = stripEl?.querySelector('.rb-chip.is-selected');
    if (stripEl && chip) stripEl.scrollLeft = chip.offsetLeft - stripEl.offsetLeft - (stripEl.clientWidth - chip.offsetWidth) / 2;
  }
  function header() {
    return `<header class="rb-header"><div class="rb-brand"><span class="rb-mark" aria-hidden="true">돌</span><div><strong>${esc(t('{store} 예약장', { store: S.storeName }))}</strong><small>${t('직원 공용 · 네이버 자동 표시')}</small></div></div>
      <div class="rb-header-actions"><button class="rb-lang" data-act="lang" lang="${isVi() ? 'ko' : 'vi'}" aria-label="${isVi() ? '한국어로 보기' : 'Xem bằng tiếng Việt'}"><span aria-hidden="true">${isVi() ? '🇰🇷' : '🇻🇳'}</span><span class="rb-lang-full">${isVi() ? '한국어' : 'Tiếng Việt'}</span><span class="rb-lang-short" aria-hidden="true">${isVi() ? 'KO' : 'VI'}</span></button><button class="rb-me" data-act="name">${S.me ? `👤 ${esc(S.me)}` : `👤 ${t('내 이름')}`}</button><button class="rb-icon${S.loading ? ' is-spinning' : ''}" data-act="refresh" aria-label="${t('새로고침')}">↻</button></div></header>`;
  }
  function renderStatus() {
    const el = document.getElementById('rb-status');
    if (el) el.textContent = S.loading ? t('불러오는 중…') : S.lastLoaded ? `${t('마지막 확인 {time} · 2분마다 새로고침', { time: clock(S.lastLoaded) })}${S.cancellations?.state === 'unavailable' ? ` · ${t('네이버 취소 알림 준비 중')}` : ''}` : '';
    root.querySelector('[data-act="refresh"]')?.classList.toggle('is-spinning', S.loading);
  }

  // ── 시트(아래에서 올라오는 창) ─────────────────────────────────────────────
  const layer = document.createElement('div');
  layer.className = 'rb-layer'; layer.hidden = true;
  document.body.appendChild(layer);
  let lastFocus = null;
  function openSheet(sheet) {
    lastFocus = document.activeElement;
    S.sheet = sheet;
    layer.innerHTML = `<div class="rb-backdrop" data-close></div><div class="rb-sheet${sheet.type === 'cancel' ? ' rb-alert' : ''}" role="dialog" aria-modal="true" aria-labelledby="rb-sheet-title">${sheetHtml(sheet)}</div>`;
    layer.hidden = false;
    document.documentElement.classList.add('rb-locked');
    (layer.querySelector('[autofocus]') || layer.querySelector('.rb-sheet h2'))?.focus?.();
  }
  function closeSheet({ silent = false } = {}) {
    if (!S.sheet) return;
    S.sheet = null; layer.hidden = true; layer.innerHTML = '';
    document.documentElement.classList.remove('rb-locked');
    lastFocus?.focus?.();
    // 등록 창을 여는 사이 새 취소가 들어왔으면 창을 닫을 때 띄운다.
    if (!silent) showCancellations();
  }
  function findItem(key, date) {
    for (const day of S.range?.days || []) if (!date || day.date === date) { const hit = day.items.find(item => item.key === key); if (hit) return hit; }
    return null;
  }
  function chips(name, values, current) {
    return `<div class="rb-chips">${values.map(value => `<button type="button" data-fill="${name}" data-value="${esc(value)}" aria-pressed="${String(value) === String(current)}">${name === 'people' ? esc(t('{n}명', { n: value })) : esc(value)}${name === 'menu' ? menuGloss(value) : ''}</button>`).join('')}</div>`;
  }
  function frequent(field, extra = []) {
    const counts = new Map();
    for (const day of S.range?.days || []) for (const item of day.items) if (item.kind === 'manual' && item[field]) counts.set(item[field], (counts.get(item[field]) || 0) + 1);
    return [...new Set([...[...counts].sort((a, b) => b[1] - a[1]).map(([value]) => value), ...extra])].filter(Boolean).slice(0, 10);
  }
  function sheetHtml(sheet) {
    const head = (title, sub = '') => `<div class="rb-sheet-head"><div><h2 id="rb-sheet-title" tabindex="-1">${title}</h2>${sub ? `<p>${sub}</p>` : ''}</div><button type="button" class="rb-icon" data-close aria-label="${t('닫기')}">✕</button></div>`;
    if (sheet.type === 'form') {
      const item = sheet.item;
      const v = item || { date: S.date < S.today ? S.today : S.date, time: '', meal: 'dinner', name: '', phone: '', people: null, menu: '', room: '', route: '전화', status: 'booked', memo: '', staff: S.me };
      const routes = v.route && !ROUTES.includes(v.route) ? [...ROUTES, v.route] : ROUTES;
      return `${head(item ? t('예약 수정') : t('예약 등록'), item?.updatedAt ? esc(t('마지막 수정 {by} · {time}', { by: item.updatedBy, time: stamp(item.updatedAt) })) : t('아는 만큼만 적으세요. 빈 칸이 있어도 저장됩니다'))}
      <form class="rb-form" data-form="reservation" novalidate>
        ${item ? '' : `<div class="rb-quick"><label for="rb-quick-text">${t('한 줄로 빠르게 입력')}</label>
          <textarea id="rb-quick-text" rows="2" maxlength="500" autofocus placeholder="${esc(t('예: 홍길동 12월18일 금요일 6시 20~24명 1층 소고기 010-0000-0000'))}"></textarea>
          <button type="button" class="rb-quick-go" data-act="quick-fill">${t('칸에 나눠 넣기')}</button>
          <div class="rb-quick-result" role="status"></div></div>`}
        <div class="rb-row2"><label class="rb-field"><span>${t('날짜')}</span><input type="date" name="date" value="${esc(v.date)}" required></label>
          <label class="rb-field"><span>${t('시간')}</span><input type="time" name="time" value="${esc(v.time)}" step="300"></label></div>
        ${chips('time', TIME_CHIPS, v.time)}
        <fieldset class="rb-seg"><legend>${t('낮 / 밤')}</legend>${[['lunch', t('☀ 낮')], ['dinner', t('☾ 밤')]].map(([key, label]) => `<label><input type="radio" name="meal" value="${key}"${v.meal === key ? ' checked' : ''}><span>${label}</span></label>`).join('')}</fieldset>
        <label class="rb-field"><span>${t('예약자명')}</span><input name="name" value="${esc(v.name)}" maxlength="40" autocomplete="off" placeholder="${esc(t('예: 홍길동, ○○회사 단체'))}"></label>
        <label class="rb-field"><span>${t('연락처')}</span><input name="phone" value="${esc(v.phone)}" maxlength="40" inputmode="tel" autocomplete="off" placeholder="010-0000-0000"></label>
        <div class="rb-field"><span>${t('인원')}</span><div class="rb-stepper"><button type="button" data-step="-1" aria-label="${t('한 명 빼기')}">−</button><input name="people" value="${v.people ?? ''}" inputmode="numeric" pattern="[0-9]*" maxlength="3" placeholder="${t('모름')}" aria-label="${t('인원')}"><button type="button" data-step="1" aria-label="${t('한 명 더하기')}">＋</button></div></div>
        ${chips('people', PEOPLE_CHIPS, v.people)}
        <label class="rb-field"><span>${t('메뉴')}</span><input name="menu" value="${esc(v.menu)}" maxlength="100" autocomplete="off" placeholder="${esc(t('예: 고기, 소(명품) 20'))}"></label>
        ${chips('menu', frequent('menu', [...BASE_MENUS, ...S.menuOptions]), v.menu)}
        <label class="rb-field"><span>${t('룸')}</span><input name="room" value="${esc(v.room)}" maxlength="40" autocomplete="off" placeholder="${esc(t('예: 2층, 7-9R'))}"></label>
        ${chips('room', frequent('room', ['2층']), v.room)}
        <fieldset class="rb-seg"><legend>${t('예약경로')}</legend>${routes.map(route => `<label><input type="radio" name="route" value="${esc(route)}"${v.route === route ? ' checked' : ''}><span>${esc(routeText(route))}</span></label>`).join('')}</fieldset>
        ${item ? `<fieldset class="rb-seg rb-seg-status"><legend>${t('예약상태')}</legend>${STATUS.map(([key, label]) => `<label><input type="radio" name="status" value="${key}"${v.status === key ? ' checked' : ''}><span>${esc(isVi() ? I18N.STATUS_VI.manual[key] || label : label)}</span></label>`).join('')}</fieldset>` : ''}
        <label class="rb-field"><span>${t('비고')}</span><textarea name="memo" rows="3" maxlength="1000" placeholder="${esc(t('예: 유아의자 1, 콜키지, 칠순잔치'))}">${esc(v.memo)}</textarea></label>
        <label class="rb-field"><span>${t('받은 직원')}</span><input name="staff" value="${esc(v.staff)}" maxlength="20" autocomplete="off" placeholder="${t('내 이름')}"></label>
        <p class="rb-form-error" role="alert"></p>
        <div class="rb-actions">${item ? `<button type="button" class="rb-danger" data-act="delete">${t('삭제')}</button>` : `<button type="button" data-close>${t('닫기')}</button>`}<button type="submit" class="rb-primary">${item ? t('저장') : t('등록')}</button></div>
      </form>`;
    }
    if (sheet.type === 'naver') {
      const item = sheet.item;
      const tel = telHref(item.phone);
      const people = item.people ? `${t('{n}명', { n: item.people })}${item.children ? ` ${t('(어린이 {n})', { n: item.children })}` : ''}` : t('인원 미정');
      const rows = [[t('날짜'), `${mdw(item.date)} ${item.time || t('시간 미정')}`], [t('인원'), people],
        [t('메뉴'), item.menu], [t('쿠폰'), (item.coupons || []).join(', ')], [t('요청사항'), item.request], [t('상품'), item.itemName], [t('좌석'), item.seat], [t('상태'), item.cancelledToday ? t('오늘 취소 ({time})', { time: clock(item.cancelledAt) }) : statusText(item)]].filter(([, value]) => value);
      return `${head(`${item.origin === 'manual' ? t('오너비스타 예약') : `<span class="rb-badge rb-badge-naver"><b>N</b>${t('네이버예약')}</span>`} ${esc(nameText(item.name))}`, t('날짜·인원 변경과 취소는 네이버(스마트플레이스)나 오너비스타에서 해 주세요. 여기서는 룸과 비고만 적습니다.'))}
      <dl class="rb-info">${rows.map(([key, value]) => `<div><dt>${key}</dt><dd>${esc(value)}${key === t('메뉴') ? menuGloss(value) : ''}</dd></div>`).join('')}${item.phone ? `<div><dt>${t('연락처')}</dt><dd>${tel ? `<a class="rb-tel" href="tel:${esc(tel)}">☎ ${esc(item.phone)}</a>` : esc(item.phone)}</dd></div>` : ''}</dl>
      <form class="rb-form" data-form="naver">
        <label class="rb-field"><span>${t('룸')}</span><input name="room" value="${esc(item.room)}" maxlength="40" autocomplete="off" placeholder="${esc(item.seat || t('예: 2층, 7-9R'))}"></label>
        ${chips('room', frequent('room', ['2층']), item.room)}
        <label class="rb-field"><span>${t('비고')}</span><textarea name="memo" rows="3" maxlength="1000" placeholder="${esc(t('예: 유아의자 1'))}">${esc(item.memo)}</textarea></label>
        ${item.updatedAt ? `<p class="rb-hint">${esc(t('마지막 메모 {by} · {time}', { by: item.updatedBy, time: stamp(item.updatedAt) }))}</p>` : ''}
        <p class="rb-form-error" role="alert"></p>
        <div class="rb-actions"><button type="button" data-close>${t('닫기')}</button><button type="submit" class="rb-primary">${t('저장')}</button></div>
      </form>`;
    }
    if (sheet.type === 'notice') {
      const n = sheet.notice || { text: '', author: S.me, pinned: false };
      return `${head(sheet.notice ? t('공지 고치기') : t('공지 쓰기'), t('이 링크를 가진 직원 모두에게 보입니다'))}
      <form class="rb-form" data-form="notice">
        <label class="rb-field"><span>${t('내용')} <b>*</b></span><textarea name="text" rows="5" maxlength="1000" required autofocus placeholder="${esc(t('예: 12월 25일은 저녁 영업만 합니다.'))}">${esc(n.text)}</textarea></label>
        <label class="rb-field"><span>${t('쓴 사람')}</span><input name="author" value="${esc(n.author)}" maxlength="20" autocomplete="off"></label>
        <label class="rb-check"><input type="checkbox" name="pinned"${n.pinned ? ' checked' : ''}> ${t('맨 위 고정')}</label>
        <p class="rb-form-error" role="alert"></p>
        <div class="rb-actions">${sheet.notice ? `<button type="button" class="rb-danger" data-act="notice-delete">${t('삭제')}</button>` : `<button type="button" data-close>${t('닫기')}</button>`}<button type="submit" class="rb-primary">${t('저장')}</button></div>
      </form>`;
    }
    if (sheet.type === 'name') {
      return `${head(t('내 이름'), t('이 휴대폰에만 저장됩니다'))}<form class="rb-form" data-form="name"><label class="rb-field"><span>${t('이름')}</span><input name="me" value="${esc(S.me)}" maxlength="20" autocomplete="name" autofocus placeholder="${esc(t('예: 김실장'))}"></label>
        <p class="rb-hint">${t('예약을 등록하면 「받은 직원」에 이 이름이 먼저 들어가고, 고친 사람으로 기록됩니다.')}</p><div class="rb-actions"><button type="button" data-close>${t('닫기')}</button><button type="submit" class="rb-primary">${t('저장')}</button></div></form>`;
    }
    if (sheet.type === 'help') {
      const help = isVi() && I18N.HELP_VI.length ? I18N.HELP_VI : HELP;
      return `${head(t('예약장 사용법'))}<div class="rb-help">${help.map(([title, lines]) => `<section><h3>${esc(title)}</h3><ul>${lines.map(line => `<li>${esc(line)}</li>`).join('')}</ul></section>`).join('')}</div>`;
    }
    if (sheet.type === 'cancel') {
      return `<div class="rb-alert-icon" aria-hidden="true">⚠</div><h2 id="rb-sheet-title" tabindex="-1">${t('네이버 예약이 취소됐어요')}</h2><p class="rb-alert-sub">${t('오늘 취소된 네이버 예약 {n}건', { n: sheet.items.length })}</p>
        <ul class="rb-cancel-list">${sheet.items.map(item => `<li><button type="button" data-goto="${esc(item.date)}" data-close-after>${sheet.fresh.has(item.id) ? `<span class="rb-new">${t('새로')}</span>` : ''}<strong>${esc(mdw(item.date))} ${esc(item.time || t('시간 미정'))}</strong><span>${esc(nameText(item.name))} · ${esc(peopleText(item.people))}${item.menu ? ` · ${esc(item.menu)}` : ''}</span><small>${esc(t('{time} 취소', { time: clock(item.cancelledAt) }))}</small></button></li>`).join('')}</ul>
        <div class="rb-actions"><button type="button" data-act="cancel-mute">${t('오늘 그만 보기')}</button><button type="button" class="rb-primary" data-close autofocus>${t('확인')}</button></div>`;
    }
    return '';
  }

  // 「오늘 그만 보기」는 이 휴대폰에서 오늘 본 취소만 숨긴다. 새로 취소된 예약은 다시 뜬다.
  function mutedIds() {
    try { const saved = JSON.parse(store.get('rb-cancel-muted') || '{}'); return saved.date === S.today && Array.isArray(saved.ids) ? new Set(saved.ids) : new Set(); } catch (_) { return new Set(); }
  }
  function showCancellations(force = false) {
    const items = S.cancellations?.state === 'ready' ? S.cancellations.items : [];
    if (!items.length || (S.sheet && !force)) return;
    const muted = force ? new Set() : mutedIds();
    const visible = items.filter(item => !muted.has(item.id));
    const fresh = visible.filter(item => !S.seenCancels.has(item.id));
    if (!force && !fresh.length) return;
    fresh.forEach(item => S.seenCancels.add(item.id));
    if (S.sheet) closeSheet({ silent: true });
    openSheet({ type: 'cancel', items: visible, fresh: new Set(fresh.map(item => item.id)) });
  }

  // ── 저장 ───────────────────────────────────────────────────────────────
  function toast(message, error = false) {
    document.querySelectorAll('.rb-toast').forEach(old => old.remove());
    const el = document.createElement('div');
    el.className = `rb-toast${error ? ' is-error' : ''}`; el.setAttribute('role', 'status'); el.textContent = message;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2600);
  }
  async function submit(form) {
    const kind = form.dataset.form;
    const button = form.querySelector('[type="submit"]'), errorBox = form.querySelector('.rb-form-error');
    const data = Object.fromEntries(new FormData(form));
    if (kind === 'name') {
      S.me = String(data.me || '').trim().slice(0, 20); store.set('rb-name', S.me); closeSheet(); render(); return;
    }
    if (button.disabled) return;
    button.disabled = true; if (errorBox) errorBox.textContent = '';
    try {
      if (kind === 'reservation') {
        // 빈 칸이 있는 새 예약은 저장 전에 한 번만 물어본다. 다시 누르거나 그 창에서 저장하면 그대로 저장한다.
        if (!S.sheet.item && !form.dataset.missingAsked && askMissing(form, 'save')) { button.disabled = false; return; }
        const people = String(data.people || '').trim();
        const item = { date: data.date, time: data.time || '', meal: data.meal, name: String(data.name || '').trim() || window.ReservationQuickEntry.NO_NAME, phone: data.phone, people: people ? Number(people) : null,
          menu: data.menu, room: data.room, route: data.route || '', status: data.status || S.sheet.item?.status || 'booked', memo: data.memo, staff: data.staff };
        const editing = S.sheet.item;
        const result = await api('save', editing ? { id: editing.id, revision: editing.revision, item, by: S.me } : { requestId: S.sheet.requestId, item, by: S.me });
        if (!S.me && data.staff) { S.me = String(data.staff).trim().slice(0, 20); store.set('rb-name', S.me); }
        toast(editing ? t('저장했습니다') : t('{date} 예약을 등록했습니다', { date: mdw(result.item.date) }));
        closeSheet();
        if (S.view === 'week' ? weekStart(result.item.date) !== weekStart(S.date) : result.item.date !== S.date) S.date = result.item.date;
      } else if (kind === 'naver') {
        const item = S.sheet.item;
        await api('naverNote', { bookingId: item.id, date: item.date, room: data.room, memo: data.memo, revision: item.revision, by: S.me });
        toast(t('룸·비고를 저장했습니다')); closeSheet();
      } else if (kind === 'notice') {
        const notice = S.sheet.notice;
        await api('noticeSave', notice ? { id: notice.id, revision: notice.revision, text: data.text, author: data.author, pinned: data.pinned === 'on' }
          : { requestId: S.sheet.requestId, text: data.text, author: data.author, pinned: data.pinned === 'on' });
        toast(t('공지를 저장했습니다')); closeSheet();
      }
      render(); load();
    } catch (err) {
      if (errorBox) errorBox.textContent = err.message;
      button.disabled = false;
      if (err.status === 409 || err.status === 404) load();
    }
  }
  // 「한 줄로 빠르게 입력」: 적은 한 줄을 칸으로 나눠 채운다. 저장은 직원이 확인하고 등록을 눌러야 한다.
  function quickFill(form) {
    const box = form.querySelector('#rb-quick-text'), out = form.querySelector('.rb-quick-result');
    const text = box.value.trim();
    if (!text) { out.innerHTML = `<span class="warn">${t('한 줄을 적거나 붙여 넣어 주세요.')}</span>`; box.focus(); return; }
    const { fields, warnings } = window.ReservationQuickEntry.parse(text, { today: S.today, menus: frequent('menu', [...BASE_MENUS, ...S.menuOptions]) });
    const set = (name, value) => {
      const input = form.elements[name];
      if (!input || value === undefined || value === null || value === '') return;
      input.value = String(value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    };
    ['date', 'time', 'name', 'phone', 'people', 'menu', 'room'].forEach(name => set(name, fields[name]));
    if (fields.meal && !fields.time) { const radio = form.querySelector(`[name="meal"][value="${fields.meal}"]`); if (radio) { radio.checked = true; form.dataset.mealTouched = '1'; } }
    if (fields.route) { const radio = form.querySelector(`[name="route"][value="${fields.route}"]`); if (radio) radio.checked = true; }
    // 두 번 눌러도 비고에 같은 말이 두 번 붙지 않게, 지난번에 붙인 말은 바꿔 끼운다.
    const memo = form.elements.memo, previous = form.dataset.quickMemo || '';
    let base = memo.value;
    if (previous && base.endsWith(previous)) base = base.slice(0, base.length - previous.length).replace(/\n$/, '');
    memo.value = [base, fields.memo].filter(Boolean).join('\n');
    form.dataset.quickMemo = fields.memo || '';
    const rel = fields.date ? window.ReservationQuickEntry.relativeDay(fields.date, S.today) : '';
    const got = [fields.name, fields.date && `${mdw(fields.date)}${rel ? ` ${t(rel)}` : ''}`, fields.time, fields.people && t('{n}명', { n: fields.people }), fields.room, fields.menu, fields.phone].filter(Boolean);
    out.innerHTML = `${got.length ? `<span class="ok">✓ ${esc(got.join(' · '))}</span>` : ''}${warnings.map(w => `<span class="warn">⚠ ${esc(warningText(w))}</span>`).join('')}<span class="hint">${t('아래 칸을 확인하고 등록을 누르세요.')}</span>`;
    if (!form.dataset.missingAsked) askMissing(form, 'quick');
  }
  // 한 줄 입력 경고(reservation-quick-entry.js)는 한국어로 온다. 베트남어로 볼 때 아는 문장만 옮긴다.
  function warningText(warning) {
    if (!isVi()) return warning;
    for (const [pattern, text] of I18N.WARNINGS_VI || []) {
      const match = warning.match(new RegExp(pattern));
      // 잡은 값이 「12월 18일(금)」 같은 한국어 날짜·요일이면 베트남어 꼴(T6 18/12)로 바꾼다.
      const value = raw => String(raw || '')
        .replace(/(\d+)월\s*(\d+)일\(([일월화수목금토])\)/g, (_, m, d, w) => `${I18N.WD_VI['일월화수목금토'.indexOf(w)]} ${d}/${m}`)
        .replace(/^([일월화수목금토])$/, w => I18N.WD_VI['일월화수목금토'.indexOf(w)]);
      if (match) return text.replace(/\$(\d)/g, (_, i) => value(match[Number(i)]));
    }
    return warning;
  }
  // 「빠진 정보가 있어요」: 빈 칸만 모아 그 자리에서 적게 한다. 비워 둬도 저장을 막지 않는다. 한 등록 창에서 한 번만 뜬다.
  const MISSING_INPUTS = {
    name: () => `<input name="name" maxlength="40" autocomplete="off" placeholder="${esc(t('모르면 비워 두세요 (이름 미정)'))}">`,
    time: () => '<input name="time" type="time" step="300">',
    people: () => `<input name="people" inputmode="numeric" pattern="[0-9]*" maxlength="3" placeholder="${esc(t('예: 4'))}">`,
    phone: () => '<input name="phone" maxlength="40" inputmode="tel" autocomplete="off" placeholder="010-0000-0000">',
    menu: () => `<input name="menu" maxlength="100" autocomplete="off" placeholder="${esc(t('예: 고기, 소(명품)'))}">`,
  };
  const missingLabel = m => (isVi() ? I18N.MISSING_VI[m.key] || m.label : m.label);
  function askMissing(form, mode) {
    const missing = window.ReservationQuickEntry.missingFields(Object.fromEntries(new FormData(form)));
    form.dataset.missingAsked = '1';
    if (!missing.length) return false;
    const box = document.createElement('div');
    box.className = 'rb-missing'; box.dataset.mode = mode;
    box.innerHTML = `<div class="rb-missing-card" role="dialog" aria-modal="true" aria-labelledby="rb-missing-title">
      <h3 id="rb-missing-title">${t('빠진 정보가 있어요')}</h3>
      <p>${t('비어 있는 칸:')} <b>${missing.map(m => esc(missingLabel(m))).join(' · ')}</b><br>${mode === 'save' ? t('아는 것만 적고, 몰라도 그대로 저장하세요. 나중에 예약 카드를 눌러 고칠 수 있습니다.') : t('아는 것만 적고, 몰라도 그대로 두세요. 나중에 예약 카드를 눌러 고칠 수 있습니다.')}</p>
      <form data-missing-form>${missing.map(m => `<label class="rb-field"><span>${esc(missingLabel(m))}</span>${MISSING_INPUTS[m.key]()}</label>`).join('')}</form>
      <div class="rb-actions"><button type="button" data-missing="back">${mode === 'save' ? t('돌아가기') : t('비워 두기')}</button><button type="button" class="rb-primary" data-missing="ok">${mode === 'save' ? t('저장') : t('칸에 넣기')}</button></div>
    </div>`;
    layer.appendChild(box);
    box.querySelector('input')?.focus();
    return true;
  }
  function closeMissing(apply) {
    const box = layer.querySelector('.rb-missing');
    const form = layer.querySelector('[data-form="reservation"]');
    if (!box) return;
    if (apply && form) {
      box.querySelectorAll('[data-missing-form] input').forEach(input => {
        const value = input.name === 'people' ? input.value.replace(/\D/g, '').slice(0, 3) : input.value.trim();
        const target = form.elements[input.name];
        if (target && value) { target.value = value; target.dispatchEvent(new Event('input', { bubbles: true })); }
      });
    }
    const mode = box.dataset.mode;
    box.remove();
    if (apply && mode === 'save' && form) submit(form);
    else layer.querySelector('.rb-sheet h2')?.focus();
  }
  async function removeReservation() {
    const item = S.sheet?.item;
    if (!item || !window.confirm(t('{what} 예약을 삭제할까요?\n손님이 취소한 것이면 삭제 말고 예약상태를 「취소」로 바꿔 주세요.', { what: `${mdw(item.date)} ${item.time || ''} ${nameText(item.name)}` }))) return;
    try {
      await api('delete', { id: item.id, revision: item.revision, by: S.me });
      toast(t('삭제했습니다')); closeSheet(); render(); load();
    } catch (err) {
      const box = layer.querySelector('.rb-form-error'); if (box) box.textContent = err.message;
      if (err.status === 409) load();
    }
  }
  async function removeNotice() {
    const notice = S.sheet?.notice;
    if (!notice || !window.confirm(t('이 공지를 지울까요?'))) return;
    try { await api('noticeDelete', { id: notice.id }); toast(t('공지를 지웠습니다')); closeSheet(); load(); } catch (err) { const box = layer.querySelector('.rb-form-error'); if (box) box.textContent = err.message; }
  }

  // ── 이벤트 ─────────────────────────────────────────────────────────────
  function go(date, view) {
    if (!/^20\d{2}-\d{2}-\d{2}$/.test(date || '')) return;
    S.date = date; if (view) { S.view = view; store.set('rb-view', view); }
    render(); load();
  }
  root.addEventListener('click', event => {
    if (event.target.closest('a')) return;
    const target = event.target.closest('[data-act],[data-view],[data-pick],[data-goto],[data-open],[data-notice],[data-guide-jump]');
    if (!target) return;
    const { act, view, pick, goto, open, notice, guideJump } = target.dataset;
    // 매뉴얼 차례: 주소의 #token 을 건드리지 않게 링크 대신 그 자리로 굴린다.
    if (guideJump) { document.getElementById(`rb-guide-${guideJump}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
    if (view) { S.view = view; store.set('rb-view', view); render(); load(); return; }
    if (pick) { go(pick); return; }
    if (goto) { go(goto, 'day'); return; }
    if (open) {
      const item = findItem(open, target.dataset.date);
      if (item) openSheet(item.kind === 'naver' ? { type: 'naver', item } : { type: 'form', item });
      return;
    }
    if (notice) { const found = S.notices.find(n => n.id === notice); if (found) openSheet({ type: 'notice', notice: found }); return; }
    const month = S.date.slice(0, 7);
    const actions = {
      refresh: () => load(), add: () => openSheet({ type: 'form', item: null, requestId: uuid() }), help: () => openSheet({ type: 'help' }),
      lang: () => { LANG = isVi() ? 'ko' : 'vi'; store.set('rb-lang', LANG); document.documentElement.lang = LANG; if (S.error) S.error = ''; render(); },
      name: () => openSheet({ type: 'name' }), 'notice-new': () => openSheet({ type: 'notice', notice: null, requestId: uuid() }),
      'notice-more': () => { S.allNotices = !S.allNotices; render(); }, 'show-cancels': () => showCancellations(true),
      prev: () => go(addDays(S.date, -1)), next: () => go(addDays(S.date, 1)), today: () => go(S.today),
      'prev-week': () => go(addDays(S.date, -7)), 'next-week': () => go(addDays(S.date, 7)),
      'prev-month': () => go(shiftMonth(month, -1) === S.today.slice(0, 7) ? S.today : `${shiftMonth(month, -1)}-01`),
      'next-month': () => go(shiftMonth(month, 1) === S.today.slice(0, 7) ? S.today : `${shiftMonth(month, 1)}-01`),
    };
    actions[act]?.();
  });
  root.addEventListener('keydown', event => {
    if ((event.key === 'Enter' || event.key === ' ') && event.target.matches('.rb-card[data-open]')) { event.preventDefault(); event.target.click(); }
  });
  root.addEventListener('change', event => { if (event.target.matches('[data-date-input]') && event.target.value) go(event.target.value); });
  layer.addEventListener('click', event => {
    const choice = event.target.closest('[data-missing]');
    if (choice) { closeMissing(choice.dataset.missing === 'ok'); return; }
    if (event.target.closest('.rb-missing')) return;
    const target = event.target.closest('[data-close],[data-act],[data-fill],[data-step],[data-goto]');
    if (!target) return;
    if (target.dataset.goto) { const date = target.dataset.goto; if (target.hasAttribute('data-close-after')) closeSheet(); go(date, 'day'); return; }
    if (target.hasAttribute('data-close')) { closeSheet(); return; }
    const form = layer.querySelector('form');
    if (target.dataset.act === 'delete') { removeReservation(); return; }
    if (target.dataset.act === 'quick-fill' && form) { quickFill(form); return; }
    if (target.dataset.act === 'notice-delete') { removeNotice(); return; }
    if (target.dataset.act === 'cancel-mute') {
      const ids = [...mutedIds(), ...(S.sheet?.items || []).map(item => item.id)];
      store.set('rb-cancel-muted', JSON.stringify({ date: S.today, ids: [...new Set(ids)] }));
      closeSheet(); toast(t('이 휴대폰에서 오늘은 이 취소 알림을 더 띄우지 않습니다')); return;
    }
    if (target.dataset.fill && form) {
      const input = form.elements[target.dataset.fill];
      if (!input) return;
      input.value = target.dataset.value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      form.querySelectorAll(`[data-fill="${target.dataset.fill}"]`).forEach(button => button.setAttribute('aria-pressed', String(button === target)));
      return;
    }
    if (target.dataset.step && form) {
      const input = form.elements.people;
      const next = Math.min(999, Math.max(1, (Number(input.value) || 0) + Number(target.dataset.step)));
      input.value = String(next); input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
  layer.addEventListener('input', event => {
    const form = event.target.form;
    if (!form || form.dataset.form !== 'reservation') return;
    if (event.target.name === 'meal') { form.dataset.mealTouched = '1'; return; }
    if (event.target.name === 'time' && !form.dataset.mealTouched && event.target.value) {
      const meal = form.querySelector(`[name="meal"][value="${mealOf(event.target.value)}"]`); if (meal) meal.checked = true;
    }
    if (event.target.name === 'people') event.target.value = event.target.value.replace(/\D/g, '').slice(0, 3);
    if (['time', 'people', 'menu', 'room'].includes(event.target.name)) {
      form.querySelectorAll(`[data-fill="${event.target.name}"]`).forEach(button => button.setAttribute('aria-pressed', String(button.dataset.value === event.target.value)));
    }
  });
  layer.addEventListener('change', event => { if (event.target.name === 'meal' && event.target.form) event.target.form.dataset.mealTouched = '1'; });
  layer.addEventListener('paste', event => {
    if (event.target.id !== 'rb-quick-text') return;
    setTimeout(() => { if (event.target.form) quickFill(event.target.form); }, 0);
  });
  layer.addEventListener('submit', event => {
    event.preventDefault();
    if (event.target.matches('[data-missing-form]')) closeMissing(true);
    else submit(event.target);
  });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    if (layer.querySelector('.rb-missing')) closeMissing(false);
    else if (S.sheet) closeSheet();
  });

  let timer = null;
  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(() => { if (!document.hidden && !S.sheet && !S.fatal) load(); schedule(); }, S.pollMs);
  }
  function wake() {
    if (document.hidden || S.fatal) return;
    const today = kstToday();
    if (today !== S.today && S.date === S.today) S.date = today;
    if (Date.now() - S.lastLoaded > 30000 && !S.sheet) load();
  }
  document.addEventListener('visibilitychange', wake);
  window.addEventListener('online', wake);
  window.addEventListener('hashchange', () => {
    const next = new URLSearchParams(location.hash.slice(1)).get('token') || '';
    if (valid(next) && next !== token) { token = next; store.set('rb-token', next); S.fatal = ''; S.error = ''; load(); }
  });
  render();
  load();
  schedule();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
  window.ReservationBoard = { HELP, LUNCH_UNTIL, TIME_CHIPS, VIEWS };
})();
