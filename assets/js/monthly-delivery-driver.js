(function () {
  'use strict';
  const root = document.getElementById('monthly-driver');
  const token = new URLSearchParams(location.hash.slice(1)).get('token') || '';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  const weekday = ds => ['일','월','화','수','목','금','토'][new Date(`${ds}T00:00:00Z`).getUTCDay()];
  const dayLabel = ds => `${Number(ds.slice(5,7))}/${Number(ds.slice(8,10))}(${weekday(ds)})`;
  const quantity = row => [row.lunchCount ? `도시락 ${row.lunchCount}개` : '', row.saladCount ? `샐러드 ${row.saladCount}개` : '', row.eventLunchCount ? `일회용 ${row.eventLunchCount}개` : '', row.cateringLabel || ''].filter(Boolean).join(' · ');
  let data = null, busy = false, loading = false, failure = '', message = '', timer = null, blocked = false, picked = '';
  // The course a driver last chose stays chosen on the next day's all-courses link.
  try { picked = localStorage.getItem('md-course') || ''; } catch (_) { /* Private mode: every course stays listed. */ }
  // A course link carries one course; the all-courses link carries every course of the date.
  const courses = () => data.courses || [{ lane:data.lane, rows:data.rows, pickups:data.pickups || [] }];
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
    const list = courses(), chosen = data.all && list.some(course => course.lane.id === picked) ? picked : '';
    const filter = data.all && list.length > 1 ? `<nav class="md-courses" aria-label="코스 선택"><button type="button" data-course="" aria-pressed="${!chosen}">전체</button>${list.map(course => `<button type="button" data-course="${esc(course.lane.id)}" aria-pressed="${course.lane.id === chosen}">${esc(course.lane.name)} <b>${course.rows.length}</b></button>`).join('')}</nav>` : '';
    root.innerHTML = `${header}<div class="md-date">${esc(data.date)} · ${weekday(data.date)}요일${data.all ? ' · 전체 코스' : ''}</div>${filter}
      <div class="md-status${failure ? ' error' : ''}" role="status" aria-live="polite">${esc(failure || (busy ? '완료 상태 저장 중…' : message))}</div>
      ${!data.canComplete && list.some(course => course.rows.length) ? '<div class="mb-empty">오늘 배송만 완료 체크할 수 있습니다. 이 날짜는 조회만 가능합니다.</div>' : ''}
      ${list.filter(course => !chosen || course.lane.id === chosen).map(section).join('') || `<div class="mb-empty">${data.noDelivery ? '배송 없는 날입니다.' : '배정된 배송이 없습니다.'}</div>`}
      <p class="md-note">방문 순서는 관리자가 정합니다. 주문·휴무 변경은 자동 반영되며, 완료 체크는 관리자 배송기록·정산에 반영됩니다.</p>`;
  }
  function section(course) {
    const done = course.rows.filter(row => row.delivered).length;
    const sum = course.rows.reduce((a, row) => ({ lunch:a.lunch+row.lunchCount, salad:a.salad+row.saladCount, event:a.event+row.eventLunchCount, party:a.party+(row.eventQty || 0) }), { lunch:0, salad:0, event:0, party:0 });
    const meta = [course.lane.driver, `${course.rows.length}곳`, `완료 ${done}/${course.rows.length}`, course.pickups.length ? `수거 ${course.pickups.length}곳` : ''].filter(Boolean);
    return `<section class="md-course"><h2>${esc(course.lane.name)}</h2><p class="md-meta">${meta.map(esc).join(' · ')}</p>
      <div class="mb-summary"><span>도시락 <b>${sum.lunch}개</b></span><span>샐러드 <b>${sum.salad}개</b></span>${sum.event ? `<span>일회용 <b>${sum.event}개</b></span>` : ''}${sum.party ? `<span>행사 <b>${sum.party}개</b></span>` : ''}</div>
      ${course.rows.map((row, index) => card(row, index)).join('') || `<div class="mb-empty">${data.noDelivery ? '배송 없는 날입니다.' : '배정된 배송이 없습니다. 취소·휴무 업체는 목록에서 빠집니다.'}</div>`}
      ${course.pickups.length ? `<h3 class="md-pickup-title">수거 ${course.pickups.length}곳</h3><p class="md-pickup-note">${esc(dayLabel(data.pickupDate))}에 배송했고 이날은 배송이 없는 곳입니다. 들러서 수거해주세요.</p>${course.pickups.map(pickup).join('')}` : ''}</section>`;
  }
  function contact(row) {
    const phone = String(row.phone || '').replace(/[^0-9+]/g, '');
    const map = row.address ? `https://map.kakao.com/link/search/${encodeURIComponent(row.address)}` : '';
    return `${row.address ? `<div class="md-info">${esc(row.address)} ${esc(row.addressDetail)}</div>` : ''}${row.note ? `<div class="md-info">메모: ${esc(row.note)}</div>` : ''}<div class="md-links">${map ? `<a href="${esc(map)}" target="_blank" rel="noopener noreferrer">길찾기</a>` : ''}${phone ? `<a href="tel:${esc(phone)}">전화</a>` : ''}</div>`;
  }
  function card(row, index) {
    const event = row.kind === 'event';
    // A public event order is completed by the administrator once it is confirmed.
    const check = event && row.received ? '<span class="md-received">접수 주문<br>관리자 완료</span>'
      : `<label class="md-check"><input type="checkbox" data-complete="${esc(row.uid)}" aria-label="${esc(row.businessName)} 배송완료"${row.delivered ? ' checked' : ''}${busy || loading || failure || !data.canComplete ? ' disabled' : ''}>완료</label>`;
    return `<article class="md-stop${row.delivered ? ' done' : ''}${event ? ' md-event' : ''}" data-uid="${esc(row.uid)}"><div><div class="md-name">${index+1}. ${event ? '<span class="md-event-tag">행사</span> ' : ''}${esc(row.businessName)}</div><div class="md-info">${esc(quantity(row))}</div><div class="mb-time md-time${row.mealTime ? '' : ' unset'}">${row.mealTime ? `배송 ${esc(row.mealTime)}` : '시간 미입력'}</div>${contact(row)}</div>${check}</article>`;
  }
  function pickup(row) {
    return `<article class="md-stop md-pickup"><div><div class="md-name">${esc(row.businessName)}</div><div class="md-info">${esc(dayLabel(data.pickupDate))} 배송 · ${esc(quantity(row))}</div>${contact(row)}</div><span class="md-pickup-tag">수거</span></article>`;
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
  root.addEventListener('click', event => {
    if (event.target.closest('[data-refresh]')) { refresh(); return; }
    const course = event.target.closest('[data-course]');
    if (!course) return;
    picked = course.dataset.course;
    try { localStorage.setItem('md-course', picked); } catch (_) { /* The choice lasts until the page closes. */ }
    render();
  });
  root.addEventListener('change', async event => {
    const check = event.target.closest('[data-complete]');
    if (!check || !data || busy || loading || failure || !data.canComplete) { render(); return; }
    const row = courses().flatMap(course => course.rows).find(item => item.uid === check.dataset.complete);
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
