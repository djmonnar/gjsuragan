(function () {
  'use strict';
  const root = document.getElementById('monthly-driver');
  const token = new URLSearchParams(location.hash.slice(1)).get('token') || '';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  let data = null, busy = false, loading = false, failure = '', message = '', timer = null, blocked = false;
  async function request(action, body = {}) {
    const abort = new AbortController(), timeout = setTimeout(() => abort.abort(), 30000);
    try {
      const response = await fetch(root.dataset.api, { method:'POST', headers:{ 'Content-Type':'application/json' },
        body:JSON.stringify({ action, token, ...body }), signal:abort.signal, cache:'no-store', referrerPolicy:'no-referrer' });
      const result = await response.json();
      if (!response.ok || !result.ok) throw Object.assign(new Error(result.error || '배송 정보를 불러오지 못했습니다.'), { status:response.status });
      return result;
    } catch (e) {
      if (e.name === 'AbortError') throw new Error('연결이 늦어지고 있습니다. 새로고침 후 다시 시도해주세요.');
      throw e;
    } finally { clearTimeout(timeout); }
  }
  function render() {
    const header = `<header class="md-header"><div class="md-brand">궁중수라간 배송</div><button type="button" data-refresh${busy || loading || blocked ? ' disabled' : ''}>새로고침</button></header>`;
    if (!data) { root.innerHTML = `${header}<div class="mb-empty" role="${failure ? 'alert' : 'status'}">${esc(failure || '배송코스를 불러오는 중…')}</div>`; return; }
    const done = data.rows.filter(row => row.delivered).length;
    const sum = data.rows.reduce((a, row) => ({ lunch:a.lunch+row.lunchCount, salad:a.salad+row.saladCount, event:a.event+row.eventLunchCount }), { lunch:0, salad:0, event:0 });
    root.innerHTML = `${header}<div class="md-date">${esc(data.date)} · ${['일','월','화','수','목','금','토'][new Date(`${data.date}T00:00:00Z`).getUTCDay()]}요일</div><h2>${esc(data.lane.name)}</h2><p class="md-meta">${esc(data.lane.driver)} · ${data.rows.length}곳 · 완료 ${done}/${data.rows.length}</p>
      <div class="mb-summary"><span>도시락 <b>${sum.lunch}개</b></span><span>샐러드 <b>${sum.salad}개</b></span>${sum.event ? `<span>일회용 <b>${sum.event}개</b></span>` : ''}</div>
      <div class="md-status${failure ? ' error' : ''}" role="status" aria-live="polite">${esc(failure || (busy ? '완료 상태 저장 중…' : message))}</div>
      ${!data.canComplete ? '<div class="mb-empty">오늘 배송만 완료 체크할 수 있습니다. 이 날짜는 조회만 가능합니다.</div>' : ''}
      ${data.rows.map((row, index) => card(row, index)).join('') || `<div class="mb-empty">${data.noDelivery ? '배송 없는 날입니다.' : '배정된 배송이 없습니다. 취소·휴무 업체는 목록에서 빠집니다.'}</div>`}
      <p class="md-note">방문 순서는 관리자가 정합니다. 주문·휴무 변경은 자동 반영되며, 완료 체크는 관리자 배송기록·정산에 반영됩니다.</p>`;
  }
  function card(row, index) {
    const quantities = [row.lunchCount ? `도시락 ${row.lunchCount}개` : '', row.saladCount ? `샐러드 ${row.saladCount}개` : '', row.eventLunchCount ? `일회용 ${row.eventLunchCount}개` : '', row.cateringLabel || ''].filter(Boolean).join(' · ');
    const phone = String(row.phone || '').replace(/[^0-9+]/g, '');
    const map = row.address ? `https://map.kakao.com/link/search/${encodeURIComponent(row.address)}` : '';
    return `<article class="md-stop${row.delivered ? ' done' : ''}" data-uid="${esc(row.uid)}"><div><div class="md-name">${index+1}. ${esc(row.businessName)}</div><div class="md-info">${esc(quantities)}</div>${row.mealTime ? `<div class="md-info">식사 ${esc(row.mealTime)}</div>` : ''}${row.address ? `<div class="md-info">${esc(row.address)} ${esc(row.addressDetail)}</div>` : ''}${row.note ? `<div class="md-info">메모: ${esc(row.note)}</div>` : ''}<div class="md-links">${map ? `<a href="${esc(map)}" target="_blank" rel="noopener noreferrer">길찾기</a>` : ''}${phone ? `<a href="tel:${esc(phone)}">전화</a>` : ''}</div></div><label class="md-check"><input type="checkbox" data-complete="${esc(row.uid)}" aria-label="${esc(row.businessName)} 배송완료"${row.delivered ? ' checked' : ''}${busy || loading || failure || !data.canComplete ? ' disabled' : ''}>완료</label></article>`;
  }
  function handleError(e) {
    failure = e.message;
    if (e.status === 403) { data = null; blocked = true; clearInterval(timer); }
  }
  async function refresh() {
    if (busy || loading || blocked || document.hidden) return;
    loading = true;
    if (!data) render();
    try { data = await request('driverRead'); failure = ''; message = `최신 배송 · ${new Date().toLocaleTimeString('ko-KR', { hour:'2-digit', minute:'2-digit' })}`; }
    catch (e) { handleError(e); }
    finally { loading = false; render(); }
  }
  root.addEventListener('click', event => { if (event.target.closest('[data-refresh]')) refresh(); });
  root.addEventListener('change', async event => {
    const check = event.target.closest('[data-complete]');
    if (!check || !data || busy || loading || failure || !data.canComplete) { render(); return; }
    const row = data.rows.find(item => item.uid === check.dataset.complete);
    if (!row) return;
    const delivered = check.checked;
    busy = true; render();
    try {
      await request('driverComplete', { uid:row.uid, signature:row.signature, delivered });
      row.delivered = delivered; failure = ''; message = delivered ? '배송완료를 저장했습니다.' : '배송완료를 취소했습니다.';
    } catch (e) { handleError(e); }
    finally { busy = false; render(); if (!blocked) await refresh(); }
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  window.addEventListener('online', refresh);
  window.addEventListener('offline', () => { failure = '인터넷 연결이 끊겼습니다. 연결 후 새로고침해주세요.'; render(); });
  window.addEventListener('pagehide', () => { clearInterval(timer); });
  window.addEventListener('pageshow', event => { if (event.persisted && !blocked) { timer = setInterval(refresh, 20000); refresh(); } });
  if (!/^[a-f0-9]{64}$/.test(token)) { failure = '기사님 코스 링크로 접속해주세요. 관리자에게 링크를 요청해주세요.'; blocked = true; render(); }
  else { refresh(); timer = setInterval(refresh, 20000); }
})();
