(function () {
  'use strict';
  const U = window.AttendanceUI;
  const $ = id => document.getElementById(id);
  const labels = { requested: '예약 신청', confirmed: '확정', completed: '이용 완료', cancelled: '취소', cancelled_by_change: '변경 취소', noshowed: '노쇼', unknown: '상태 확인' };
  let device = '', data = null, busy = false, failed = false, getNow = Date.now, shownDay = '';
  function render() {
    const now = getNow();
    const current = data?.date === U.date(now) ? data : null;
    const ready = current?.state === 'ready';
    const rows = ready ? current.bookings : [];
    const active = rows.filter(row => row.active);
    const excluded = rows.filter(row => !row.active);
    const next = active.find(row => row.status !== 'completed' && row.time && row.time >= U.time(now));
    $('bookings-store').textContent = `${current?.storeName || '돌담명가'} · 네이버예약${current?.demo ? ' · 미리보기' : ''}`;
    $('bookings-summary').innerHTML = ready
      ? `<strong>${active.length}<small>건</small></strong><span class="att-bookings-divider"></span><strong>${active.reduce((n, row) => n + row.adults + row.children, 0)}<small>명</small></strong><span class="att-meta">오늘 방문 기준</span>`
      : current?.state === 'unconfigured' ? '오너비스타 연결 준비 중' : current?.state === 'waiting' ? '오늘 예약 수집 대기 중' : '오늘 예약 확인 중';
    const stale = ready && now - current.sourceUpdatedAt > 15 * 60000;
    $('bookings-status').textContent = failed ? (ready ? '갱신하지 못해 마지막으로 확인한 예약을 표시합니다.' : '예약을 불러오지 못했습니다. 자동으로 다시 확인합니다.')
      : current?.state === 'unconfigured' ? '관리자가 예약 연동을 설정하면 여기에 바로 표시됩니다.'
        : current?.state === 'waiting' ? '오너비스타에서 오늘 예약을 수집하면 표시됩니다.'
          : current?.syncFailed ? '최근 네이버 수집에 실패했습니다. 마지막 수집 기준입니다.'
            : stale ? '네이버 수집 후 15분이 지났습니다. 최근 변경은 아직 반영되지 않았을 수 있어요.' : '';
    $('bookings-status').hidden = !$('bookings-status').textContent;
    const rowHtml = row => `<article class="att-booking-row ${row === next ? 'next' : ''} ${!row.active ? 'cancelled' : ''}"><div class="att-booking-time">${U.esc(row.time || '시간 미정')}${row === next ? '<small>다음 예약</small>' : ''}</div><div class="att-booking-info"><div class="att-booking-name"><strong>${U.esc(row.name || '이름 확인 필요')}</strong><span>${row.adults + row.children}명${row.children ? ` <small>(어린이 ${row.children})</small>` : ''}</span></div><p>${U.esc(row.menuItems.length ? row.menuItems.map(item => `${item.name} ${item.count}`).join(' · ') : row.itemName || '메뉴 정보 없음')}</p><span class="att-booking-state">${labels[row.status] || '상태 확인'}</span></div></article>`;
    $('bookings-list').innerHTML = active.map(rowHtml).join('')
      + (ready && !active.length ? '<div class="att-bookings-empty">오늘 방문 예정인 네이버예약이 없습니다.</div>' : '')
      + (excluded.length ? `<details class="att-bookings-excluded"><summary>취소·노쇼·상태 확인 ${excluded.length}건</summary>${excluded.map(rowHtml).join('')}</details>` : '');
    const source = current?.sourceUpdatedAt;
    $('bookings-sync').textContent = source
      ? `네이버 수집 ${U.date(source) === U.date(now) ? '' : `${U.date(source).slice(5)} `}${U.time(source)} · 화면 확인 ${U.time(current.fetchedAt)}${current.demo ? ' · 미리보기 가상 예약' : ''}`
      : '1분마다 자동으로 확인합니다.';
  }
  async function sync() {
    if (!device || busy || document.hidden) return;
    busy = true;
    const credential = device;
    try {
      const result = await U.request('kiosk.bookings', {}, { device: credential });
      if (device !== credential) return;
      if (result.date !== U.date(getNow())) throw new Error('Date changed');
      data = result; failed = false;
    } catch (error) {
      if (device !== credential) return;
      failed = true;
      if (error.status === 401 || error.status === 403) data = null;
    } finally { busy = false; render(); }
  }
  window.AttendanceBookings = {
    connect(token, clock) {
      getNow = clock;
      if (device === token) return;
      device = token; data = null; failed = false; shownDay = U.date(getNow()); render(); sync();
    },
    clear() { device = ''; data = null; failed = false; render(); }
  };
  window.addEventListener('online', sync);
  window.addEventListener('offline', () => { failed = true; render(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { render(); sync(); } });
  setInterval(sync, 60000);
  setInterval(() => {
    const day = U.date(getNow());
    if (device && day !== shownDay) { shownDay = day; data = null; render(); sync(); }
  }, 1000);
})();
