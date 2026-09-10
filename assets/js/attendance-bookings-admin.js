(function () {
  'use strict';
  const U = window.AttendanceUI, $ = id => document.getElementById(id);
  const labels = { requested: '예약 신청', confirmed: '확정', completed: '이용 완료', cancelled: '취소', cancelled_by_change: '변경 취소', noshowed: '노쇼', unknown: '상태 확인' };
  let initialized = false, data = null, calendar = null, daySequence = 0, monthSequence = 0, timer;
  let today = U.date(Date.now()), date = today, month = today.slice(0, 7);
  const monthLabel = value => `${Number(value.slice(0, 4))}년 ${Number(value.slice(5))}월`;
  const dateLabel = value => `${Number(value.slice(5, 7))}월 ${Number(value.slice(8))}일`;
  async function api(action, input) { return U.request(action, input, { token: await window.AttendanceSession.getToken() }); }
  function renderCalendar() {
    $('reservation-month-label').textContent = monthLabel(month);
    $('reservation-prev').disabled = month === '2000-01'; $('reservation-next').disabled = month === '2099-12';
    const rows = calendar?.days || [], byDate = new Map(rows.map(row => [row.date, row]));
    $('reservation-month-count').textContent = calendar?.state === 'unconfigured' ? '예약 연결 설정 필요'
      : calendar ? `저장된 예약 ${rows.reduce((sum, row) => sum + row.activeCount, 0).toLocaleString('ko-KR')}건 · ${rows.reduce((sum, row) => sum + row.headcount, 0).toLocaleString('ko-KR')}명` : '월별 예약을 불러오는 중…';
    const first = new Date(`${month}-01T00:00:00Z`), last = new Date(first);
    last.setUTCMonth(last.getUTCMonth() + 1, 0);
    const cells = Array.from({ length: first.getUTCDay() }, () => '<div class="reservation-calendar-blank" aria-hidden="true"></div>');
    for (let i = 1; i <= last.getUTCDate(); i++) {
      const value = `${month}-${String(i).padStart(2, '0')}`, row = byDate.get(value), selected = value === date;
      const state = !row ? '집계 확인 중' : `${row.activeCount}건, ${row.headcount}명${row.verified ? '' : ', 저장된 예약 기준'}`;
      cells.push(`<button class="reservation-calendar-day ${value === today ? 'is-today' : ''} ${selected ? 'is-selected' : ''}" data-reservation-date="${value}" aria-pressed="${selected}" aria-label="${dateLabel(value)}${value === today ? ' 오늘' : ''}, ${state}"><span class="reservation-day-number">${i}</span>${row ? `<span class="reservation-day-count ${row.activeCount ? 'has-bookings' : ''}">${row.activeCount ? row.activeCount + '건' : row.verified ? '—' : '미확인'}</span>${row.activeCount ? `<span class="reservation-day-people">${row.headcount}명</span>` : ''}${row.activeCount && !row.verified ? '<span class="reservation-unverified" aria-hidden="true">·</span>' : ''}` : '<span class="reservation-day-count">…</span>'}</button>`);
    }
    while (cells.length % 7) cells.push('<div class="reservation-calendar-blank" aria-hidden="true"></div>');
    $('reservation-calendar-grid').innerHTML = cells.join('');
    $('reservation-calendar-note').textContent = calendar?.state === 'unconfigured' ? '오너비스타 연결 후 예약을 확인할 수 있습니다.'
      : '확정·신청·이용완료 기준 · 미확인/점 표시는 최근 수집 범위 밖이며, 저장된 예약만 표시합니다.';
  }
  function renderDay() {
    const rows = data?.bookings || [], active = rows.filter(row => row.active);
    $('reservation-date').value = date;
    $('reservation-day-heading').textContent = date === today ? '오늘 예약' : `${dateLabel(date)} 예약`;
    $('reservation-day-date').textContent = `${date} · ${new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', weekday: 'long' }).format(new Date(`${date}T12:00:00+09:00`))}`;
    $('reservation-count').textContent = data?.state === 'unconfigured' ? '연결 설정 필요' : data ? `${active.length}건 · ${active.reduce((sum, row) => sum + row.adults + row.children, 0)}명` : '확인 중…';
    $('reservation-add').disabled = !data || data.state === 'unconfigured';
    $('reservation-title').textContent = `${data?.storeName || calendar?.storeName || '돌담명가'} 예약 관리${data?.demo ? ' · 미리보기' : ''}`;
    $('reservation-content').innerHTML = rows.length ? `<div class="staff-reservation-cards">${rows.map(row => `<article class="staff-reservation-card"><div class="att-row"><div><div class="staff-reservation-time">${U.esc(row.time || '시간 미정')}</div><h3>${U.esc(row.name || '이름 확인 필요')} <span class="att-meta">${row.adults + row.children}명</span></h3></div><span class="att-pill ${row.active ? 'green' : ''}">${labels[row.status] || '확인 필요'}</span></div><div class="staff-reservation-detail"><p class="staff-menu"><span>예약 메뉴</span>${U.esc(row.menuItems.length ? row.menuItems.map(item => `${item.name} ${item.count}`).join(' · ') : row.itemName)}</p><p><span>좌석</span>${U.esc(row.seat || '미지정')}</p><p><span>등록 경로</span>${row.origin === 'manual' ? '직접 등록' : '네이버'}</p></div></article>`).join('')}</div>`
      : `<div class="att-empty">${!data ? '예약 정보를 불러오는 중…' : data.state === 'unconfigured' ? '오너비스타 연결을 설정하면 예약이 표시됩니다.' : data.state === 'waiting' || data.state === 'partial' ? '저장된 예약이 없습니다. 네이버 최신 수집 범위 밖의 날짜입니다.' : date === today ? '오늘 예약이 없습니다.' : '이 날짜의 예약이 없습니다.'}</div>`;
    const notes = [];
    if (data?.state === 'partial' || data?.state === 'waiting') notes.push('최근 네이버 수집 범위 밖입니다. 저장된 예약 기준으로 표시합니다.');
    if (data?.syncFailed || (data?.sourceUpdatedAt && Date.now() - data.sourceUpdatedAt > 15 * 60000)) notes.push('최근 변경 사항이 아직 반영되지 않았을 수 있습니다.');
    $('reservation-day-note').textContent = notes.join(' ');
    $('reservation-sync').textContent = data?.sourceUpdatedAt ? `네이버 수집 ${U.date(data.sourceUpdatedAt)} ${U.time(data.sourceUpdatedAt)} · 화면 확인 ${U.time(data.fetchedAt)} · 5분마다 갱신` : '';
  }
  async function loadDay() {
    if (!initialized) return;
    const version = ++daySequence;
    $('reservation-error').textContent = '';
    try {
      const result = await api('admin.bookings', { date });
      if (!initialized || version !== daySequence) return;
      data = result; renderDay();
    } catch (error) {
      if (!initialized || version !== daySequence) return;
      if (error.status === 401 || error.status === 403) { daySequence++; monthSequence++; data = null; calendar = null; renderCalendar(); renderDay(); }
      if (!data) { $('reservation-count').textContent = '조회 실패'; $('reservation-content').innerHTML = '<div class="att-empty">예약을 확인하지 못했습니다. 새로고침해 주세요.</div>'; }
      $('reservation-error').textContent = `${error.message}${data ? ' 마지막으로 확인한 예약입니다.' : ''}`;
    }
  }
  async function loadMonth() {
    if (!initialized) return;
    const version = ++monthSequence;
    $('reservation-calendar-error').textContent = '';
    try {
      const result = await api('admin.bookings.calendar', { month });
      if (!initialized || version !== monthSequence) return;
      calendar = result; renderCalendar();
      if (calendar.syncFailed) $('reservation-calendar-error').textContent = '최근 네이버 수집에 실패했습니다. 저장된 집계입니다.';
    } catch (error) {
      if (!initialized || version !== monthSequence) return;
      if (error.status === 401 || error.status === 403) { daySequence++; monthSequence++; calendar = null; data = null; renderCalendar(); renderDay(); }
      if (!calendar) $('reservation-month-count').textContent = '월별 집계 확인 필요';
      $('reservation-calendar-error').textContent = `${error.message}${calendar ? ' 마지막으로 확인한 집계입니다.' : ''}`;
    }
  }
  function selectDate(value) {
    const parsed = /^20\d{2}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00Z`) : null;
    if (!parsed || !Number.isFinite(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) { $('reservation-date').value = date; return; }
    const differentMonth = month !== value.slice(0, 7);
    date = value; month = value.slice(0, 7); data = null;
    if (differentMonth) calendar = null;
    renderCalendar(); renderDay(); loadDay();
    if (differentMonth) loadMonth();
  }
  function shiftMonth(delta) {
    const next = new Date(`${month}-01T00:00:00Z`); next.setUTCMonth(next.getUTCMonth() + delta);
    const value = next.toISOString().slice(0, 10);
    if (value < '2000-01-01' || value > '2099-12-31') return;
    selectDate(value.slice(0, 7) === today.slice(0, 7) ? today : value);
  }
  function refresh() {
    if (!initialized || document.hidden || !window.AttendanceSession.isActive('reservations') || document.querySelector('dialog[open]')) return;
    const current = U.date(Date.now());
    if (current !== today) {
      const wasToday = date === today; today = current;
      if (wasToday) { date = today; month = today.slice(0, 7); data = null; calendar = null; }
      renderCalendar(); renderDay();
    }
    loadDay(); loadMonth();
  }
  function init() {
    if (initialized) { refresh(); return; }
    initialized = true; today = U.date(Date.now()); date = today; month = today.slice(0, 7);
    $('reservations-root').innerHTML = `<div class="att-topline"><div><p class="att-eyebrow">RESERVATIONS</p><h2 id="reservation-title">돌담명가 예약 관리</h2><p class="att-subtitle">월간 예약을 한눈에 보고, 오늘 오실 손님을 확인하세요.</p></div><button class="att-button att-primary" id="reservation-add" disabled>＋ 예약 등록</button></div><div class="reservation-overview-toolbar"><p class="att-meta">날짜를 누르면 예약 내역이 보여요.</p><div class="att-filters"><button class="att-button" id="reservation-today">오늘 예약</button><button class="att-button" id="reservation-refresh">새로고침</button></div></div><p class="att-booking-saved" id="reservation-saved" role="status"></p><div class="reservation-workspace"><section class="att-panel reservation-calendar" aria-label="월간 예약 캘린더"><div class="reservation-calendar-header"><button class="att-button" id="reservation-prev" aria-label="예약 이전 달">‹</button><div><h3 id="reservation-month-label"></h3><p id="reservation-month-count" role="status"></p></div><button class="att-button" id="reservation-next" aria-label="예약 다음 달">›</button></div><div class="reservation-weekdays" aria-hidden="true">${['일','월','화','수','목','금','토'].map(day => `<span>${day}</span>`).join('')}</div><div id="reservation-calendar-grid" class="reservation-calendar-grid" role="group" aria-label="예약 날짜 선택"></div><p class="att-meta reservation-calendar-note" id="reservation-calendar-note"></p><p class="att-error" id="reservation-calendar-error" role="alert"></p></section><section class="att-panel reservation-day-panel" aria-label="선택한 날짜 예약"><div class="reservation-day-header"><div><p class="att-eyebrow" id="reservation-day-date"></p><h3 id="reservation-day-heading">오늘 예약</h3></div><strong id="reservation-count" role="status"></strong></div><div class="reservation-date-picker"><label for="reservation-date">날짜 바로 선택</label><input class="att-input" type="date" id="reservation-date" aria-label="예약 조회 날짜" min="2000-01-01" max="2099-12-31"></div><p class="att-meta" id="reservation-day-note"></p><p class="att-error" id="reservation-error" role="alert"></p><div id="reservation-content"></div></section></div><p class="att-status" id="reservation-sync"></p>`;
    $('reservation-calendar-grid').onclick = event => { const value = event.target.closest('[data-reservation-date]')?.dataset.reservationDate; if (value) selectDate(value); };
    $('reservation-date').onchange = () => selectDate($('reservation-date').value);
    $('reservation-prev').onclick = () => shiftMonth(-1); $('reservation-next').onclick = () => shiftMonth(1);
    $('reservation-today').onclick = () => { today = U.date(Date.now()); selectDate(today); };
    $('reservation-refresh').onclick = refresh;
    $('reservation-add').onclick = () => window.AttendanceBookingForm.open({ date: date < today ? today : date,
      menuOptions: data?.menuOptions, scope: 'admin', save: input => api('admin.booking.create', input),
      onSaved: async result => { if (!initialized) return; $('reservation-saved').textContent = `${result.useDate} 예약을 등록했습니다.`; const oldMonth = month; selectDate(result.useDate); if (oldMonth === month) loadMonth(); } });
    renderCalendar(); renderDay(); loadDay(); loadMonth();
    timer = setInterval(refresh, 5 * 60000);
    document.addEventListener('visibilitychange', refresh); window.addEventListener('online', refresh);
  }
  function dispose() {
    initialized = false; daySequence++; monthSequence++; clearInterval(timer); data = null; calendar = null;
    document.removeEventListener('visibilitychange', refresh); window.removeEventListener('online', refresh);
    const root = $('reservations-root'); if (root) root.innerHTML = ''; window.AttendanceBookingForm?.clear();
  }
  window.AttendanceReservations = { init, dispose };
})();
