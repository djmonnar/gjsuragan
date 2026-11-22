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
      '하루: 날짜 띠를 옆으로 밀어 날짜를 고르고, ‹ › 로 하루씩 넘깁니다. 낮(16시 전)과 밤(16시부터)으로 나뉩니다.',
      '일주일: 월요일부터 일요일까지 한 화면에 보입니다. 날짜 제목을 누르면 그날 하루 보기로 갑니다.',
      '달력: 날짜마다 팀 수와 인원이 보이고, 날짜를 누르면 아래에 그날 예약이 나옵니다.',
      '팀·인원 합계에는 취소된 예약이 들어가지 않습니다. 취소된 예약은 각 칸 맨 아래에 흐리게 남습니다.']],
    ['예약 등록 · 수정 · 삭제', ['오른쪽 아래 「＋ 예약 등록」을 누릅니다. 예약자명만 꼭 적으면 되고, 나머지는 아는 만큼 적습니다.',
      '맨 위 「한 줄로 빠르게 입력」에 「홍길동 12월18일 금요일 6시 20~24명 1층 소고기 010-0000-0000」처럼 적거나 카톡 내용을 붙여 넣으면 날짜·시간·인원·룸·메뉴·연락처·예약자명이 칸에 나뉘어 들어갑니다. 붙여 넣으면 바로, 직접 적었으면 「칸에 나눠 넣기」를 누르세요.',
      '오전·오후를 안 적은 1~9시는 저녁으로 봅니다(6시 → 18:00). 「20~24명」은 24명으로 넣고 비고에 범위를 남깁니다. 적은 요일이 날짜와 다르면 알려 줍니다. 채워진 칸을 확인하고 등록하세요.',
      '시간을 고르면 낮/밤이 저절로 맞춰집니다(16시 전 낮). 인원을 모르면 비워 두면 「인원 미정」으로 보입니다.',
      '예약 카드를 누르면 고칠 수 있습니다. 손님이 취소하면 예약상태를 「취소」로 바꾸세요. 기록이 남습니다.',
      '「삭제」는 잘못 적은 예약을 지울 때만 씁니다. 지운 예약도 기록은 남아 있어 관리자에게 말하면 되살릴 수 있습니다.',
      '다른 직원이 먼저 고친 예약을 저장하면 막힙니다. 새로고침해서 바뀐 내용을 보고 다시 저장하세요.']],
    ['네이버 예약', ['네이버 예약은 초록색 「N 네이버예약」 표시로 자동으로 들어옵니다(오너비스타 수집, 몇 분 늦을 수 있음).',
      '네이버 손님도 전화번호가 보입니다. 카드 오른쪽 ☎ 를 누르면 바로 전화가 걸립니다.',
      '네이버 예약의 날짜·인원 변경과 취소는 네이버(스마트플레이스)나 오너비스타에서 합니다. 여기서는 룸과 비고만 적을 수 있습니다.',
      '네이버 예약이 취소되면, 취소된 그날에만 이 화면을 열 때 경고 창이 뜹니다. 「오늘 그만 보기」를 누르면 이 휴대폰에서는 오늘 더 뜨지 않습니다(새로 취소된 예약은 다시 뜹니다).']],
    ['공지 · 내 이름', ['맨 위 공지에서 「＋ 공지 쓰기」로 모두에게 알릴 내용을 적습니다. 공지를 누르면 고치거나 지울 수 있고, 「맨 위 고정」을 켜면 가장 위에 보입니다.',
      '오른쪽 위 이름 버튼에 내 이름을 적어 두면 등록할 때 「받은 직원」에 자동으로 들어가고, 누가 고쳤는지 기록됩니다.',
      '화면은 2분마다, 그리고 다시 열 때마다 새로 불러옵니다. 바로 보려면 ↻ 를 누르세요.',
      '이 링크를 가진 사람은 누구나 예약을 보고 고칠 수 있습니다. 직원 단톡방 밖으로 보내지 마세요.']],
  ];

  const store = {
    get(key) { try { return localStorage.getItem(key); } catch (_) { return null; } },
    set(key, value) { try { localStorage.setItem(key, value); } catch (_) { /* 사생활 모드: 이번 화면에서만 기억 */ } },
    remove(key) { try { localStorage.removeItem(key); } catch (_) { /* ignore */ } },
  };
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
  const md = date => `${Number(date.slice(5, 7))}월 ${Number(date.slice(8, 10))}일`;
  const mdw = date => `${md(date)} (${WD[weekday(date)]})`;
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
  const telHref = phone => { const digits = String(phone || '').replace(/\D/g, ''); return digits.length === 8 ? `010${digits}` : digits.length >= 9 ? digits : ''; };
  function uuid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    const b = crypto.getRandomValues(new Uint8Array(16)); b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
    const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }

  const S = { view: ['day', 'week', 'month'].includes(store.get('rb-view')) ? store.get('rb-view') : 'day', today: kstToday(), date: kstToday(),
    me: store.get('rb-name') || '', range: null, months: {}, notices: [], cancellations: null, menuOptions: [], storeName: '돌담명가',
    loading: false, error: '', fatal: token ? '' : '관리자에게 받은 예약장 링크로 열어 주세요. 링크 끝의 #token=… 까지 모두 있어야 합니다.',
    sheet: null, allNotices: false, pollMs: 120000, lastLoaded: 0, seenCancels: new Set() };

  async function api(action, body = {}) {
    const abort = new AbortController(), timer = setTimeout(() => abort.abort(), 20000);
    try {
      const response = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store', referrerPolicy: 'no-referrer',
        body: JSON.stringify({ action, token, ...body }), signal: abort.signal });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) throw Object.assign(new Error(result.error || '연결을 확인한 뒤 다시 시도해 주세요.'), { status: response.status });
      return result;
    } catch (err) {
      if (err.name === 'AbortError') throw Object.assign(new Error('연결이 늦어지고 있습니다. 잠시 후 다시 시도해 주세요.'), { status: 0 });
      if (err instanceof TypeError) throw Object.assign(new Error('인터넷 연결을 확인해 주세요.'), { status: 0 });
      throw err;
    } finally { clearTimeout(timer); }
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
    if (item.kind === 'naver') return item.origin === 'manual' ? '<span class="rb-badge rb-badge-ov">오너비스타</span>' : '<span class="rb-badge rb-badge-naver"><b>N</b>네이버예약</span>';
    if (!item.route) return '';
    return `<span class="rb-badge rb-badge-route">${esc(item.route === '네이버' ? '네이버(직접 적음)' : item.route)}</span>`;
  }
  function statusChip(item) {
    if (item.cancelledToday) return '<span class="rb-status rb-status-cancel">오늘 취소</span>';
    if (!item.active) return `<span class="rb-status rb-status-cancel">${esc(item.statusLabel)}</span>`;
    if (item.status === 'changed') return '<span class="rb-status rb-status-changed">변경</span>';
    if (item.status === 'requested') return '<span class="rb-status rb-status-wait">확정 대기</span>';
    return '';
  }
  function card(item) {
    const room = item.room || item.seat;
    const tel = telHref(item.phone);
    const who = item.updatedBy && item.updatedBy !== '이름 없음' ? `${item.updatedBy} ` : '';
    const verb = item.kind === 'naver' ? '메모' : item.revision > 1 ? '수정' : '등록';
    const meta = [item.kind === 'manual' && item.staff ? `받은 직원 ${item.staff}` : '',
      item.updatedAt ? `${verb} ${who}${stamp(item.updatedAt)}` : ''].filter(Boolean);
    return `<article class="rb-card rb-${item.kind}${item.active ? '' : ' is-off'}${item.cancelledToday ? ' is-cancelled-today' : ''}" data-open="${esc(item.key)}" data-date="${esc(item.date)}" tabindex="0" role="button" aria-label="${esc(`${item.time || '시간 미정'} ${item.name} ${item.people ? item.people + '명' : '인원 미정'} ${item.route} ${item.statusLabel}`)}">
      <div class="rb-card-time">${item.time ? esc(item.time) : '<small>시간<br>미정</small>'}</div>
      <div class="rb-card-body">
        <div class="rb-card-top"><strong class="rb-card-name">${esc(item.name || '이름 없음')}</strong><span class="rb-card-people">${item.people ? `${item.people}명` : '인원 미정'}</span>${statusChip(item)}</div>
        <div class="rb-card-tags">${routeBadge(item)}${room ? `<span class="rb-badge rb-badge-room">${esc(room)}</span>` : ''}${item.menu ? `<span class="rb-card-menu">${esc(item.menu)}</span>` : ''}</div>
        ${item.memo ? `<p class="rb-card-memo">${esc(item.memo)}</p>` : ''}
        ${item.maybeDuplicate ? '<p class="rb-card-dup">같은 이름의 네이버예약이 따로 있습니다. 같은 예약이면 이 줄은 삭제하세요.</p>' : ''}
        ${meta.length ? `<p class="rb-card-meta">${esc(meta.join(' · '))}</p>` : ''}
      </div>
      ${tel ? `<a class="rb-call" href="tel:${esc(tel)}" aria-label="${esc(item.name)}에게 전화">☎</a>` : ''}
    </article>`;
  }
  function daySummary(day) {
    const s = day.summary;
    return `<div class="rb-summary"><div class="rb-summary-main"><b>${s.teams}</b>팀 <b>${s.people}</b>명${s.unknownPeople ? `<small>+ 인원 미정 ${s.unknownPeople}팀</small>` : ''}</div>
      <div class="rb-summary-meals"><span>☀ 낮 ${s.lunch.teams}팀 ${s.lunch.people}명</span><span>☾ 밤 ${s.dinner.teams}팀 ${s.dinner.people}명</span>${s.cancelled ? `<span class="rb-off">취소 ${s.cancelled}</span>` : ''}</div></div>`;
  }
  function naverLine(days) {
    const failed = days.find(day => day.naver.state === 'error');
    if (failed) return `<p class="rb-warn" role="status">⚠ ${esc(failed.naver.error)} 직접 등록한 예약만 보입니다.</p>`;
    if (days.some(day => day.naver.state === 'unconfigured')) return '<p class="rb-warn" role="status">네이버 예약 연결이 아직 설정되지 않았습니다. 직접 등록한 예약만 보입니다.</p>';
    const synced = days.map(day => day.naver.syncedAt).filter(Boolean).sort().at(-1);
    const stale = days.some(day => day.naver.syncFailed) || (synced && Date.now() - Date.parse(synced) > 15 * 60000);
    if (stale) return `<p class="rb-warn" role="status">네이버 예약 최근 변경이 아직 안 들어왔을 수 있습니다${synced ? ` (마지막 반영 ${esc(stamp(synced))})` : ''}.</p>`;
    return synced ? `<p class="rb-sync">네이버 예약 ${esc(clock(synced))} 반영</p>` : '';
  }
  function dayList(day) {
    if (!day) return '<div class="rb-empty">예약을 불러오는 중…</div>';
    const meal = (key, label, summary) => {
      const items = day.items.filter(item => item.meal === key);
      return `<section class="rb-meal rb-meal-${key}"><h3>${label}<small>${summary.teams}팀 ${summary.people}명</small></h3>${items.length ? items.map(card).join('') : '<p class="rb-none">예약 없음</p>'}</section>`;
    };
    const cancelled = (S.cancellations?.items || []).length;
    return `${daySummary(day)}${cancelled ? `<button class="rb-cancel-bar" data-act="show-cancels">⚠ 오늘 취소된 네이버 예약 ${cancelled}건 보기</button>` : ''}${naverLine([day])}
      ${day.items.length ? meal('lunch', '☀ 낮', day.summary.lunch) + meal('dinner', '☾ 밤', day.summary.dinner) : `<div class="rb-empty">${md(day.date)} 예약이 없습니다.<br>오른쪽 아래 ＋ 로 등록하세요.</div>`}`;
  }
  function strip() {
    const month = S.date.slice(0, 7), counts = new Map((S.months[month]?.days || []).map(day => [day.date, day]));
    return `<div class="rb-strip" role="group" aria-label="날짜 고르기">${Array.from({ length: monthDays(month) }, (_, i) => {
      const date = `${month}-${String(i + 1).padStart(2, '0')}`, count = counts.get(date), w = weekday(date);
      return `<button class="rb-chip${date === S.date ? ' is-selected' : ''}${date === S.today ? ' is-today' : ''}${w === 0 ? ' is-sun' : w === 6 ? ' is-sat' : ''}" data-pick="${date}" aria-pressed="${date === S.date}" aria-label="${esc(mdw(date))}${count?.teams ? ` ${count.teams}팀` : ''}">
        <span class="rb-chip-wd">${WD[w]}</span><span class="rb-chip-day">${i + 1}</span><span class="rb-chip-count">${count ? (count.teams ? `${count.teams}팀` : '') : '·'}</span></button>`;
    }).join('')}</div>`;
  }
  function dateBar() {
    return `<div class="rb-datebar"><button class="rb-icon" data-act="prev" aria-label="이전 날">‹</button>
      <label class="rb-datebar-label"><span>${esc(mdw(S.date))}${S.date === S.today ? '<em>오늘</em>' : ''}</span><input type="date" data-date-input value="${S.date}" aria-label="날짜 바로 고르기"></label>
      <button class="rb-icon" data-act="next" aria-label="다음 날">›</button>${S.date === S.today ? '' : '<button class="rb-today" data-act="today">오늘</button>'}</div>`;
  }
  function dayView() {
    const day = S.range?.days?.find(row => row.date === S.date);
    return `${dateBar()}${strip()}${dayList(day)}`;
  }
  function weekView() {
    const start = weekStart(S.date), end = addDays(start, 6);
    const days = S.range?.from === start ? S.range.days : null;
    const head = `<div class="rb-datebar"><button class="rb-icon" data-act="prev-week" aria-label="지난 주">‹</button><div class="rb-datebar-label"><span>${esc(md(start))} – ${esc(start.slice(5, 7) === end.slice(5, 7) ? `${Number(end.slice(8))}일` : md(end))}</span></div><button class="rb-icon" data-act="next-week" aria-label="다음 주">›</button>${weekStart(S.today) === start ? '' : '<button class="rb-today" data-act="today">이번 주</button>'}</div>`;
    if (!days) return `${head}<div class="rb-empty">일주일 예약을 불러오는 중…</div>`;
    const line = item => `<button class="rb-line${item.active ? '' : ' is-off'}" data-open="${esc(item.key)}" data-date="${esc(item.date)}"><span class="rb-line-time">${esc(item.time || '미정')}</span><span class="rb-line-name">${esc(item.name)}</span><span class="rb-line-people">${item.people ? `${item.people}명` : '?'}</span><span class="rb-line-menu">${esc(item.menu)}</span>${item.kind === 'naver' ? '<span class="rb-n" title="네이버예약">N</span>' : ''}${item.active ? '' : `<span class="rb-line-off">${esc(item.cancelledToday ? '오늘 취소' : item.statusLabel)}</span>`}</button>`;
    return `${head}${naverLine(days)}${days.map(day => `<section class="rb-weekday${day.date === S.today ? ' is-today' : ''}${weekday(day.date) === 0 ? ' is-sun' : weekday(day.date) === 6 ? ' is-sat' : ''}">
      <button class="rb-weekday-head" data-goto="${day.date}"><span>${esc(mdw(day.date))}${day.date === S.today ? '<em>오늘</em>' : ''}</span><span>${day.summary.teams ? `${day.summary.teams}팀 ${day.summary.people}명` : '예약 없음'} ›</span></button>
      ${['lunch', 'dinner'].map(meal => { const items = day.items.filter(item => item.meal === meal); return items.length ? `<div class="rb-week-meal"><span class="rb-week-meal-label">${meal === 'lunch' ? '☀ 낮' : '☾ 밤'}</span><div>${items.map(line).join('')}</div></div>` : ''; }).join('')}
    </section>`).join('')}`;
  }
  function monthView() {
    const month = S.date.slice(0, 7), data = S.months[month], counts = new Map((data?.days || []).map(day => [day.date, day]));
    const first = weekday(`${month}-01`);
    const cells = Array.from({ length: first }, () => '<span class="rb-cal-blank"></span>');
    for (let i = 1; i <= monthDays(month); i++) {
      const date = `${month}-${String(i).padStart(2, '0')}`, count = counts.get(date), w = weekday(date);
      const people = count?.teams ? (count.people ? `${count.people}명${count.unknownPeople ? '+' : ''}` : '인원?') : '';
      cells.push(`<button class="rb-cal-day${date === S.date ? ' is-selected' : ''}${date === S.today ? ' is-today' : ''}${w === 0 ? ' is-sun' : w === 6 ? ' is-sat' : ''}${count?.teams ? ' has' : ''}" data-pick="${date}" aria-pressed="${date === S.date}" aria-label="${esc(mdw(date))}${count?.teams ? ` ${count.teams}팀 ${people}` : ''}"><span class="rb-cal-num">${i}</span>${count?.teams ? `<span class="rb-cal-teams">${count.teams}팀</span><span class="rb-cal-people">${people}</span>` : ''}</button>`);
    }
    const day = S.range?.days?.find(row => row.date === S.date);
    return `<div class="rb-datebar"><button class="rb-icon" data-act="prev-month" aria-label="지난 달">‹</button><div class="rb-datebar-label"><span>${month.slice(0, 4)}년 ${Number(month.slice(5))}월</span></div><button class="rb-icon" data-act="next-month" aria-label="다음 달">›</button>${S.date.slice(0, 7) === S.today.slice(0, 7) ? '' : '<button class="rb-today" data-act="today">오늘</button>'}</div>
      <div class="rb-cal">${WD.map((name, i) => `<span class="rb-cal-wd${i === 0 ? ' is-sun' : i === 6 ? ' is-sat' : ''}">${name}</span>`).join('')}${cells.join('')}</div>
      ${data ? (data.naverState === 'calendar' ? '' : '<p class="rb-warn">네이버 예약 합계를 불러오지 못해 직접 등록한 예약만 셌습니다.</p>') : '<p class="rb-sync">달력 합계를 불러오는 중…</p>'}
      <h2 class="rb-day-title">${esc(mdw(S.date))}${S.date === S.today ? ' · 오늘' : ''}</h2>${dayList(day)}`;
  }
  function notices() {
    const list = S.notices || [];
    const shown = S.allNotices ? list : list.slice(0, 2);
    return `<section class="rb-notices" aria-label="공지사항"><div class="rb-notices-head"><h2>📢 공지</h2><button class="rb-link" data-act="notice-new">＋ 공지 쓰기</button></div>
      ${shown.length ? shown.map(n => `<button class="rb-notice${n.pinned ? ' is-pinned' : ''}" data-notice="${esc(n.id)}">${n.pinned ? '<span class="rb-pin">📌 고정</span>' : ''}<span class="rb-notice-text">${esc(n.text)}</span><span class="rb-notice-meta">${esc(n.author)} · ${esc(stamp(n.createdAt))}</span></button>`).join('') : '<p class="rb-none">공지가 없습니다.</p>'}
      ${list.length > 2 ? `<button class="rb-link rb-more" data-act="notice-more">${S.allNotices ? '접기' : `공지 ${list.length}개 모두 보기`}</button>` : ''}</section>`;
  }
  function render() {
    if (S.fatal) {
      root.innerHTML = `${header()}<main class="rb-main"><div class="rb-fatal" role="alert"><h2>예약장을 열 수 없습니다</h2><p>${esc(S.fatal)}</p></div></main>`;
      return;
    }
    const body = S.view === 'week' ? weekView() : S.view === 'month' ? monthView() : dayView();
    root.innerHTML = `${header()}<main class="rb-main">${S.error ? `<p class="rb-error" role="alert">${esc(S.error)}</p>` : ''}${notices()}
      <nav class="rb-tabs" aria-label="보기 방식">${[['day', '하루'], ['week', '일주일'], ['month', '달력']].map(([key, label]) => `<button data-view="${key}" aria-pressed="${S.view === key}">${label}</button>`).join('')}</nav>
      ${body}
      <footer class="rb-footer"><span id="rb-status"></span><button class="rb-link" data-act="help">사용법</button></footer></main>
      <button class="rb-fab" data-act="add">＋ 예약 등록</button>`;
    renderStatus();
    // 다시 그릴 때마다 날짜 띠를 고른 날짜가 가운데 오게 맞춘다(화면 위아래는 움직이지 않는다).
    const stripEl = root.querySelector('.rb-strip'), chip = stripEl?.querySelector('.rb-chip.is-selected');
    if (stripEl && chip) stripEl.scrollLeft = chip.offsetLeft - stripEl.offsetLeft - (stripEl.clientWidth - chip.offsetWidth) / 2;
  }
  function header() {
    return `<header class="rb-header"><div class="rb-brand"><span class="rb-mark" aria-hidden="true">돌</span><div><strong>${esc(S.storeName)} 예약장</strong><small>직원 공용 · 네이버 자동 표시</small></div></div>
      <div class="rb-header-actions"><button class="rb-me" data-act="name">${S.me ? `👤 ${esc(S.me)}` : '👤 내 이름'}</button><button class="rb-icon${S.loading ? ' is-spinning' : ''}" data-act="refresh" aria-label="새로고침">↻</button></div></header>`;
  }
  function renderStatus() {
    const el = document.getElementById('rb-status');
    if (el) el.textContent = S.loading ? '불러오는 중…' : S.lastLoaded ? `마지막 확인 ${clock(S.lastLoaded)} · 2분마다 새로고침${S.cancellations?.state === 'unavailable' ? ' · 네이버 취소 알림 준비 중' : ''}` : '';
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
    return `<div class="rb-chips">${values.map(value => `<button type="button" data-fill="${name}" data-value="${esc(value)}" aria-pressed="${String(value) === String(current)}">${esc(value)}${name === 'people' ? '명' : ''}</button>`).join('')}</div>`;
  }
  function frequent(field, extra = []) {
    const counts = new Map();
    for (const day of S.range?.days || []) for (const item of day.items) if (item.kind === 'manual' && item[field]) counts.set(item[field], (counts.get(item[field]) || 0) + 1);
    return [...new Set([...[...counts].sort((a, b) => b[1] - a[1]).map(([value]) => value), ...extra])].filter(Boolean).slice(0, 10);
  }
  function sheetHtml(sheet) {
    const head = (title, sub = '') => `<div class="rb-sheet-head"><div><h2 id="rb-sheet-title" tabindex="-1">${title}</h2>${sub ? `<p>${sub}</p>` : ''}</div><button type="button" class="rb-icon" data-close aria-label="닫기">✕</button></div>`;
    if (sheet.type === 'form') {
      const item = sheet.item;
      const v = item || { date: S.date < S.today ? S.today : S.date, time: '', meal: 'dinner', name: '', phone: '', people: null, menu: '', room: '', route: '전화', status: 'booked', memo: '', staff: S.me };
      const routes = v.route && !ROUTES.includes(v.route) ? [...ROUTES, v.route] : ROUTES;
      return `${head(item ? '예약 수정' : '예약 등록', item?.updatedAt ? `마지막 수정 ${esc(item.updatedBy)} · ${esc(stamp(item.updatedAt))}` : '예약자명만 꼭 적으면 됩니다')}
      <form class="rb-form" data-form="reservation" novalidate>
        ${item ? '' : `<div class="rb-quick"><label for="rb-quick-text">한 줄로 빠르게 입력</label>
          <textarea id="rb-quick-text" rows="2" maxlength="500" autofocus placeholder="예: 홍길동 12월18일 금요일 6시 20~24명 1층 소고기 010-0000-0000"></textarea>
          <button type="button" class="rb-quick-go" data-act="quick-fill">칸에 나눠 넣기</button>
          <div class="rb-quick-result" role="status"></div></div>`}
        <div class="rb-row2"><label class="rb-field"><span>날짜</span><input type="date" name="date" value="${esc(v.date)}" required></label>
          <label class="rb-field"><span>시간</span><input type="time" name="time" value="${esc(v.time)}" step="300"></label></div>
        ${chips('time', TIME_CHIPS, v.time)}
        <fieldset class="rb-seg"><legend>낮 / 밤</legend>${[['lunch', '☀ 낮'], ['dinner', '☾ 밤']].map(([key, label]) => `<label><input type="radio" name="meal" value="${key}"${v.meal === key ? ' checked' : ''}><span>${label}</span></label>`).join('')}</fieldset>
        <label class="rb-field"><span>예약자명 <b>*</b></span><input name="name" value="${esc(v.name)}" maxlength="40" autocomplete="off" required placeholder="예: 홍길동, ○○회사 단체"></label>
        <label class="rb-field"><span>연락처</span><input name="phone" value="${esc(v.phone)}" maxlength="40" inputmode="tel" autocomplete="off" placeholder="010-0000-0000"></label>
        <div class="rb-field"><span>인원</span><div class="rb-stepper"><button type="button" data-step="-1" aria-label="한 명 빼기">−</button><input name="people" value="${v.people ?? ''}" inputmode="numeric" pattern="[0-9]*" maxlength="3" placeholder="모름" aria-label="인원"><button type="button" data-step="1" aria-label="한 명 더하기">＋</button></div></div>
        ${chips('people', PEOPLE_CHIPS, v.people)}
        <label class="rb-field"><span>메뉴</span><input name="menu" value="${esc(v.menu)}" maxlength="100" autocomplete="off" placeholder="예: 고기, 소(명품) 20"></label>
        ${chips('menu', frequent('menu', [...BASE_MENUS, ...S.menuOptions]), v.menu)}
        <label class="rb-field"><span>룸</span><input name="room" value="${esc(v.room)}" maxlength="40" autocomplete="off" placeholder="예: 2층, 7-9R"></label>
        ${chips('room', frequent('room', ['2층']), v.room)}
        <fieldset class="rb-seg"><legend>예약경로</legend>${routes.map(route => `<label><input type="radio" name="route" value="${esc(route)}"${v.route === route ? ' checked' : ''}><span>${esc(route)}</span></label>`).join('')}</fieldset>
        ${item ? `<fieldset class="rb-seg rb-seg-status"><legend>예약상태</legend>${STATUS.map(([key, label]) => `<label><input type="radio" name="status" value="${key}"${v.status === key ? ' checked' : ''}><span>${label}</span></label>`).join('')}</fieldset>` : ''}
        <label class="rb-field"><span>비고</span><textarea name="memo" rows="3" maxlength="1000" placeholder="예: 유아의자 1, 콜키지, 칠순잔치">${esc(v.memo)}</textarea></label>
        <label class="rb-field"><span>받은 직원</span><input name="staff" value="${esc(v.staff)}" maxlength="20" autocomplete="off" placeholder="내 이름"></label>
        <p class="rb-form-error" role="alert"></p>
        <div class="rb-actions">${item ? '<button type="button" class="rb-danger" data-act="delete">삭제</button>' : '<button type="button" data-close>닫기</button>'}<button type="submit" class="rb-primary">${item ? '저장' : '등록'}</button></div>
      </form>`;
    }
    if (sheet.type === 'naver') {
      const item = sheet.item;
      const tel = telHref(item.phone);
      const rows = [['날짜', `${mdw(item.date)} ${item.time || '시간 미정'}`], ['인원', item.people ? `${item.people}명${item.children ? ` (어린이 ${item.children})` : ''}` : '인원 미정'],
        ['메뉴', item.menu], ['상품', item.itemName], ['좌석', item.seat], ['상태', item.cancelledToday ? `오늘 취소 (${clock(item.cancelledAt)})` : item.statusLabel]].filter(([, value]) => value);
      return `${head(`${item.origin === 'manual' ? '오너비스타 예약' : '<span class="rb-badge rb-badge-naver"><b>N</b>네이버예약</span>'} ${esc(item.name)}`, '날짜·인원 변경과 취소는 네이버(스마트플레이스)나 오너비스타에서 해 주세요. 여기서는 룸과 비고만 적습니다.')}
      <dl class="rb-info">${rows.map(([key, value]) => `<div><dt>${key}</dt><dd>${esc(value)}</dd></div>`).join('')}${item.phone ? `<div><dt>연락처</dt><dd>${tel ? `<a class="rb-tel" href="tel:${esc(tel)}">☎ ${esc(item.phone)}</a>` : esc(item.phone)}</dd></div>` : ''}</dl>
      <form class="rb-form" data-form="naver">
        <label class="rb-field"><span>룸</span><input name="room" value="${esc(item.room)}" maxlength="40" autocomplete="off" placeholder="${esc(item.seat || '예: 2층, 7-9R')}"></label>
        ${chips('room', frequent('room', ['2층']), item.room)}
        <label class="rb-field"><span>비고</span><textarea name="memo" rows="3" maxlength="1000" placeholder="예: 유아의자 1">${esc(item.memo)}</textarea></label>
        ${item.updatedAt ? `<p class="rb-hint">마지막 메모 ${esc(item.updatedBy)} · ${esc(stamp(item.updatedAt))}</p>` : ''}
        <p class="rb-form-error" role="alert"></p>
        <div class="rb-actions"><button type="button" data-close>닫기</button><button type="submit" class="rb-primary">저장</button></div>
      </form>`;
    }
    if (sheet.type === 'notice') {
      const n = sheet.notice || { text: '', author: S.me, pinned: false };
      return `${head(sheet.notice ? '공지 고치기' : '공지 쓰기', '이 링크를 가진 직원 모두에게 보입니다')}
      <form class="rb-form" data-form="notice">
        <label class="rb-field"><span>내용 <b>*</b></span><textarea name="text" rows="5" maxlength="1000" required autofocus placeholder="예: 12월 25일은 저녁 영업만 합니다.">${esc(n.text)}</textarea></label>
        <label class="rb-field"><span>쓴 사람</span><input name="author" value="${esc(n.author)}" maxlength="20" autocomplete="off"></label>
        <label class="rb-check"><input type="checkbox" name="pinned"${n.pinned ? ' checked' : ''}> 맨 위 고정</label>
        <p class="rb-form-error" role="alert"></p>
        <div class="rb-actions">${sheet.notice ? '<button type="button" class="rb-danger" data-act="notice-delete">삭제</button>' : '<button type="button" data-close>닫기</button>'}<button type="submit" class="rb-primary">저장</button></div>
      </form>`;
    }
    if (sheet.type === 'name') {
      return `${head('내 이름', '이 휴대폰에만 저장됩니다')}<form class="rb-form" data-form="name"><label class="rb-field"><span>이름</span><input name="me" value="${esc(S.me)}" maxlength="20" autocomplete="name" autofocus placeholder="예: 김실장"></label>
        <p class="rb-hint">예약을 등록하면 「받은 직원」에 이 이름이 먼저 들어가고, 고친 사람으로 기록됩니다.</p><div class="rb-actions"><button type="button" data-close>닫기</button><button type="submit" class="rb-primary">저장</button></div></form>`;
    }
    if (sheet.type === 'help') {
      return `${head('예약장 사용법')}<div class="rb-help">${HELP.map(([title, lines]) => `<section><h3>${esc(title)}</h3><ul>${lines.map(line => `<li>${esc(line)}</li>`).join('')}</ul></section>`).join('')}</div>`;
    }
    if (sheet.type === 'cancel') {
      return `<div class="rb-alert-icon" aria-hidden="true">⚠</div><h2 id="rb-sheet-title" tabindex="-1">네이버 예약이 취소됐어요</h2><p class="rb-alert-sub">오늘 취소된 네이버 예약 ${sheet.items.length}건</p>
        <ul class="rb-cancel-list">${sheet.items.map(item => `<li><button type="button" data-goto="${esc(item.date)}" data-close-after>${sheet.fresh.has(item.id) ? '<span class="rb-new">새로</span>' : ''}<strong>${esc(mdw(item.date))} ${esc(item.time || '시간 미정')}</strong><span>${esc(item.name || '이름 없음')} · ${item.people ? `${item.people}명` : '인원 미정'}${item.menu ? ` · ${esc(item.menu)}` : ''}</span><small>${esc(clock(item.cancelledAt))} 취소</small></button></li>`).join('')}</ul>
        <div class="rb-actions"><button type="button" data-act="cancel-mute">오늘 그만 보기</button><button type="button" class="rb-primary" data-close autofocus>확인</button></div>`;
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
        if (!String(data.name || '').trim()) throw new Error('예약자명을 적어 주세요.');
        const people = String(data.people || '').trim();
        const item = { date: data.date, time: data.time || '', meal: data.meal, name: data.name, phone: data.phone, people: people ? Number(people) : null,
          menu: data.menu, room: data.room, route: data.route || '', status: data.status || S.sheet.item?.status || 'booked', memo: data.memo, staff: data.staff };
        const editing = S.sheet.item;
        const result = await api('save', editing ? { id: editing.id, revision: editing.revision, item, by: S.me } : { requestId: S.sheet.requestId, item, by: S.me });
        if (!S.me && data.staff) { S.me = String(data.staff).trim().slice(0, 20); store.set('rb-name', S.me); }
        toast(editing ? '저장했습니다' : `${mdw(result.item.date)} 예약을 등록했습니다`);
        closeSheet();
        if (S.view === 'week' ? weekStart(result.item.date) !== weekStart(S.date) : result.item.date !== S.date) S.date = result.item.date;
      } else if (kind === 'naver') {
        const item = S.sheet.item;
        await api('naverNote', { bookingId: item.id, date: item.date, room: data.room, memo: data.memo, revision: item.revision, by: S.me });
        toast('룸·비고를 저장했습니다'); closeSheet();
      } else if (kind === 'notice') {
        const notice = S.sheet.notice;
        await api('noticeSave', notice ? { id: notice.id, revision: notice.revision, text: data.text, author: data.author, pinned: data.pinned === 'on' }
          : { requestId: S.sheet.requestId, text: data.text, author: data.author, pinned: data.pinned === 'on' });
        toast('공지를 저장했습니다'); closeSheet();
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
    if (!text) { out.innerHTML = '<span class="warn">한 줄을 적거나 붙여 넣어 주세요.</span>'; box.focus(); return; }
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
    const got = [fields.name, fields.date && mdw(fields.date), fields.time, fields.people && `${fields.people}명`, fields.room, fields.menu, fields.phone].filter(Boolean);
    out.innerHTML = `${got.length ? `<span class="ok">✓ ${esc(got.join(' · '))}</span>` : ''}${warnings.map(w => `<span class="warn">⚠ ${esc(w)}</span>`).join('')}<span class="hint">아래 칸을 확인하고 등록을 누르세요.</span>`;
  }
  async function removeReservation() {
    const item = S.sheet?.item;
    if (!item || !window.confirm(`${mdw(item.date)} ${item.time || ''} ${item.name} 예약을 삭제할까요?\n손님이 취소한 것이면 삭제 말고 예약상태를 「취소」로 바꿔 주세요.`)) return;
    try {
      await api('delete', { id: item.id, revision: item.revision, by: S.me });
      toast('삭제했습니다'); closeSheet(); render(); load();
    } catch (err) {
      const box = layer.querySelector('.rb-form-error'); if (box) box.textContent = err.message;
      if (err.status === 409) load();
    }
  }
  async function removeNotice() {
    const notice = S.sheet?.notice;
    if (!notice || !window.confirm('이 공지를 지울까요?')) return;
    try { await api('noticeDelete', { id: notice.id }); toast('공지를 지웠습니다'); closeSheet(); load(); } catch (err) { const box = layer.querySelector('.rb-form-error'); if (box) box.textContent = err.message; }
  }

  // ── 이벤트 ─────────────────────────────────────────────────────────────
  function go(date, view) {
    if (!/^20\d{2}-\d{2}-\d{2}$/.test(date || '')) return;
    S.date = date; if (view) { S.view = view; store.set('rb-view', view); }
    render(); load();
  }
  root.addEventListener('click', event => {
    if (event.target.closest('a')) return;
    const target = event.target.closest('[data-act],[data-view],[data-pick],[data-goto],[data-open],[data-notice]');
    if (!target) return;
    const { act, view, pick, goto, open, notice } = target.dataset;
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
      closeSheet(); toast('이 휴대폰에서 오늘은 이 취소 알림을 더 띄우지 않습니다'); return;
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
  layer.addEventListener('submit', event => { event.preventDefault(); submit(event.target); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && S.sheet) closeSheet(); });

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
  window.ReservationBoard = { HELP, LUNCH_UNTIL, TIME_CHIPS };
})();
