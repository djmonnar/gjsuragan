(function () {
  'use strict';
  const U = window.AttendanceUI;
  const $ = id => document.getElementById(id);
  const labels = { requested: '예약 신청', confirmed: '확정', completed: '이용 완료', cancelled: '취소', cancelled_by_change: '변경 취소', noshowed: '노쇼', unknown: '상태 확인' };
  let initialized = false, data = null, sequence = 0, timer, date = U.date(Date.now());
  async function api(action, input) {
    if (!auth.currentUser || !ADMIN_EMAILS.includes(auth.currentUser.email)) throw new Error('관리자 로그인이 필요합니다.');
    return U.request(action, input, { token: await auth.currentUser.getIdToken() });
  }
  async function load() {
    const version = ++sequence;
    $('reservation-error').textContent = '';
    try {
      const result = await api('admin.bookings', { date });
      if (!initialized || version !== sequence) return;
      data = result; render();
    } catch (error) {
      if (!initialized || version !== sequence) return;
      if (error.status === 401 || error.status === 403) { data = null; render(); }
      $('reservation-error').textContent = `${error.message}${data ? ' 마지막으로 확인한 예약입니다.' : ''}`;
    }
  }
  function render() {
    const rows = data?.bookings || [], active = rows.filter(row => row.active);
    $('reservation-add').disabled = !data || data.state === 'unconfigured';
    $('reservation-title').textContent = `${data?.storeName || '돌담명가'} 예약 관리${data?.demo ? ' · 미리보기' : ''}`;
    $('reservation-count').textContent = data?.state === 'unconfigured' ? '예약 연결 설정 필요' : data ? `${date} · ${active.length}건 · ${active.reduce((sum, row) => sum + row.adults + row.children, 0)}명${data.state === 'waiting' ? ' · 직접 등록 기준 (네이버 수집 대기)' : ''}` : '예약 정보를 불러오는 중…';
    $('reservation-content').innerHTML = rows.length ? `<div class="att-table-scroll"><table class="att-table"><thead><tr><th>시간</th><th>이름</th><th>인원</th><th>메뉴</th><th>좌석</th><th>등록 경로</th><th>상태</th></tr></thead><tbody>${rows.map(row => `<tr><td>${U.esc(row.time || '미정')}</td><td class="att-name">${U.esc(row.name || '이름 확인 필요')}</td><td>${row.adults + row.children}명</td><td>${U.esc(row.menuItems.length ? row.menuItems.map(item => `${item.name} ${item.count}`).join(' · ') : row.itemName)}</td><td>${U.esc(row.seat || '미지정')}</td><td>${row.origin === 'manual' ? '직접 등록' : '네이버'}</td><td><span class="att-pill ${row.active ? 'green' : ''}">${labels[row.status] || '확인 필요'}</span></td></tr>`).join('')}</tbody></table></div>`
      : `<div class="att-empty">${!data ? '예약 정보를 불러오는 중…' : data.state === 'unconfigured' ? '오너비스타 연결을 설정하면 예약이 표시됩니다.' : data.state === 'waiting' ? '네이버 예약 수집을 기다리고 있습니다.' : '이 날짜의 예약이 없습니다.'}</div>`;
    $('reservation-sync').textContent = data?.sourceUpdatedAt ? `네이버 수집 ${U.date(data.sourceUpdatedAt)} ${U.time(data.sourceUpdatedAt)} · 화면 확인 ${U.time(data.fetchedAt)} · 5분마다 갱신` : '';
    if (data?.syncFailed || (data?.state === 'ready' && Date.now() - data.sourceUpdatedAt > 15 * 60000)) $('reservation-error').textContent = '최근 네이버 변경 사항이 아직 반영되지 않았을 수 있습니다. 수집 시각을 확인해 주세요.';
  }
  function init() {
    if (initialized) { load(); return; }
    initialized = true;
    $('reservations-root').innerHTML = `<div class="att-topline"><div><p class="att-eyebrow">RESERVATIONS</p><h2 id="reservation-title">돌담명가 예약 관리</h2><p class="att-subtitle">네이버예약과 직접 등록한 예약을 날짜별로 확인하세요.</p></div><button class="att-button att-primary" id="reservation-add" disabled>＋ 예약 등록</button></div><div class="att-toolbar"><div class="att-filters"><input class="att-input" type="date" id="reservation-date" aria-label="예약 조회 날짜" value="${date}"><button class="att-button" id="reservation-today">오늘</button><button class="att-button" id="reservation-refresh">새로고침</button></div><strong id="reservation-count"></strong></div><p class="att-error" id="reservation-error" role="alert"></p><p class="att-booking-saved" id="reservation-saved" role="status"></p><section class="att-panel" id="reservation-content"></section><p class="att-status" id="reservation-sync"></p>`;
    const change = value => { if (!value) return; date = value; $('reservation-date').value = date; data = null; render(); load(); };
    $('reservation-date').onchange = () => change($('reservation-date').value);
    $('reservation-today').onclick = () => change(U.date(Date.now()));
    $('reservation-refresh').onclick = load;
    $('reservation-add').onclick = () => window.AttendanceBookingForm.open({ date: date < U.date(Date.now()) ? U.date(Date.now()) : date,
      menuOptions: data?.menuOptions, scope: 'admin', save: input => api('admin.booking.create', input),
      onSaved: async result => { $('reservation-saved').textContent = `${result.useDate} 예약을 등록했습니다.`; change(result.useDate); } });
    timer = setInterval(() => { if (!document.hidden && activeAdminTab === 'reservations') load(); }, 5 * 60000);
    load();
  }
  function dispose() { initialized = false; sequence++; clearInterval(timer); data = null; const root = $('reservations-root'); if (root) root.innerHTML = ''; window.AttendanceBookingForm?.clear(); }
  window.AttendanceReservations = { init, dispose };
})();
