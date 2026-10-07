(function () {
  'use strict';
  let config, root, data, date, active = false, busy = false, loading = false;
  let generation = 0, mutation = 0, timer = null, refreshTimer = null, subscriptions = [], history = [], drag = null;
  let status = '', failure = '', deferredRefresh = false, editingLane = '', editingRevision = 0, shareLane = '';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  const byUid = () => new Map((data?.rows || []).map(row => [row.uid, row]));
  const laneRows = id => (data?.plan.order[id] || []).map(uid => byUid().get(uid)).filter(Boolean);
  const clone = value => JSON.parse(JSON.stringify(value));
  function timeMinutes(value) {
    const match = String(value || '').trim().match(/^(\d{1,2}):(\d{2})$/);
    if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return Infinity;
    return Number(match[1]) * 60 + Number(match[2]);
  }
  function sortPlanByTime(plan, rows, laneId = '') {
    const next = clone(plan), times = new Map(rows.map(row => [row.uid,timeMinutes(row.mealTime)]));
    for (const lane of next.lanes) {
      if (lane.id === 'unassigned' || (laneId && lane.id !== laneId)) continue;
      const ids = next.order[lane.id], ranked = ids.filter(uid=>times.has(uid)).sort((a,b)=>{
        const first = times.get(a), second = times.get(b);
        return first === second ? 0 : first < second ? -1 : 1;
      });
      let index = 0;
      next.order[lane.id] = ids.map(uid=>times.has(uid) ? ranked[index++] : uid);
    }
    return next;
  }
  const weekdayLabel = ds => ['일','월','화','수','목','금','토'][new Date(`${ds}T00:00:00Z`).getUTCDay()];
  const qty = row => [row.lunchCount ? `도시락 ${row.lunchCount}개` : '', row.saladCount ? `샐러드 ${row.saladCount}개` : '', row.eventLunchCount ? `일회용 ${row.eventLunchCount}개` : '', row.cateringLabel || ''].filter(Boolean).join(' · ');
  const totals = rows => rows.reduce((a, row) => ({ lunch:a.lunch+row.lunchCount, salad:a.salad+row.saladCount, event:a.event+row.eventLunchCount }), { lunch:0, salad:0, event:0 });

  async function request(action, body = {}) {
    if (!config.auth.currentUser) throw new Error('관리자로 다시 로그인해주세요.');
    const token = await config.auth.currentUser.getIdToken();
    const abort = new AbortController(), timeout = setTimeout(() => abort.abort(), 30000);
    try {
      const response = await fetch(config.apiUrl, { method:'POST', headers:{ 'Content-Type':'application/json', Authorization:`Bearer ${token}` }, body:JSON.stringify({ action, ...body }), signal:abort.signal, cache:'no-store' });
      const result = await response.json();
      if (!response.ok || !result.ok) throw Object.assign(new Error(result.error || '배송 정보를 불러오지 못했습니다.'), { status:response.status });
      return result;
    } catch (e) {
      if (e.name === 'AbortError') throw new Error('연결이 늦어지고 있습니다. 새로고침 후 다시 시도해주세요.');
      throw e;
    } finally { clearTimeout(timeout); }
  }
  function init() {
    root.classList.add('mb-root');
    root.innerHTML = `<div class="mb-toolbar"><div><h2>월식 배송 보드</h2><div class="mb-date-controls"><button type="button" data-date-step="-1" aria-label="이전 날짜">◀</button><input type="date" data-date aria-label="월식 배송 날짜"><button type="button" data-date-step="1" aria-label="다음 날짜">▶</button><button type="button" data-today>오늘</button><span data-weekday></span></div></div><div class="mb-actions"><button type="button" data-refresh>새로고침</button><button type="button" data-sort-time="">전체 코스 시간순 배치</button><button type="button" data-add-lane>+ 코스 카테고리 추가</button><button type="button" class="mb-primary" data-template>요일 기본 코스로 저장</button></div></div><div data-body></div><dialog data-lane-dialog><form method="dialog"><h3 data-lane-title>코스 카테고리 추가</h3><label>코스명 · 동네명<input name="laneName" required maxlength="60" placeholder="예: 평거 A코스"></label><label>기사님 · 차량 표시<input name="driver" maxlength="60" placeholder="예: 김기사님 · 1호차"></label><div class="mb-category-order" data-category-order><span>보드 표시 순서</span><button type="button" data-lane-step="-1">↑ 위로</button><button type="button" data-lane-step="1">↓ 아래로</button></div><p class="mb-dialog-note" data-category-note></p><div class="mb-dialog-actions"><button type="button" class="mb-danger" data-delete-lane>카테고리 삭제</button><button type="button" data-dialog-close>취소</button><button type="submit" class="mb-primary">저장</button></div></form></dialog><dialog data-share-dialog><h3>기사님 코스 링크</h3><div data-share-content></div><div class="mb-dialog-actions"><button type="button" class="mb-danger" data-revoke>링크 해제</button><button type="button" data-copy-share>링크 복사</button><button type="button" data-share-close>닫기</button></div></dialog>`;
    root.addEventListener('click', onClick);
    root.addEventListener('change', onChange);
    root.querySelector('[data-lane-dialog] form').addEventListener('submit', saveLaneForm);
    root.addEventListener('pointerdown', dragStart);
    root.addEventListener('pointermove', dragMove);
    root.addEventListener('pointerup', event => dragEnd(event));
    root.addEventListener('pointercancel', event => dragEnd(event, true));
    root.addEventListener('lostpointercapture', event => { if (drag) dragEnd(event, true); });
    document.addEventListener('visibilitychange', () => { if (active && !document.hidden) refresh(); });
  }
  function render() {
    root.querySelector('[data-date]').value = date;
    root.querySelector('[data-weekday]').textContent = `${weekdayLabel(date)}요일`;
    root.querySelectorAll('.mb-toolbar button,.mb-toolbar input').forEach(el => { el.disabled = busy || (!data && !el.hasAttribute('data-refresh') && !el.hasAttribute('data-date-step') && !el.hasAttribute('data-date') && !el.hasAttribute('data-today')); });
    if (!data) {
      root.querySelector('[data-body]').innerHTML = `<div class="mb-empty" role="status">${loading ? '배송 대상과 코스를 불러오는 중…' : esc(failure || '배송 보드를 불러와주세요.')}</div>`;
      return;
    }
    const sum = totals(data.rows), unassigned = laneRows('unassigned').length;
    const source = data.routeSource;
    root.querySelector('[data-template]').textContent = `${weekdayLabel(date)}요일 기본 코스로 저장`;
    root.querySelector('[data-template]').disabled = busy || data.noDelivery;
    root.querySelector('.mb-toolbar [data-sort-time]').disabled = busy || data.noDelivery;
    root.querySelector('[data-body]').innerHTML = `${failure ? `<div class="mb-error" role="alert">${esc(failure)}</div>` : ''}
      <div class="mb-summary"><span>배송 <b>${data.rows.length}곳</b></span><span>도시락 <b>${sum.lunch}개</b></span><span>샐러드 <b>${sum.salad}개</b></span>${sum.event ? `<span>일회용 <b>${sum.event}개</b></span>` : ''}<span>미배정 <b>${unassigned}곳</b></span><span class="mb-status${failure ? ' error' : ''}" role="status" aria-live="polite">${esc(busy ? '저장 중…' : status)}</span></div>
      ${source?.warning ? `<div class="mb-error" role="alert">${esc(source.warning)} 저장한 코스는 유지됩니다. 미배정 업체를 확인해주세요.</div>` : ''}
      ${source?.tab ? `<details class="mb-source"><summary>${source.weekReady ? '월~금 기본 배정 저장됨 · ' : ''}배달동선 시트 · ${esc(source.tab)}요일 기준 · 직접 편집한 배정 우선</summary><p>전체 고객의 기본 코스를 미리 저장하고, 선택한 날짜의 실제 배송 업체만 표시합니다. 취소·휴무 업체는 제외하고 복귀하면 원래 순서로 표시합니다. 새 업체는 시트 이름이 연결되면 자동 배정되며, 연결되지 않으면 미배정에 표시됩니다. <a href="${esc(source.url)}" target="_blank" rel="noopener">원본 시트 보기</a></p>${source.ambiguous.length || source.unmatched.length ? `<p>시트에서 고객을 찾지 못했거나 이름이 모호한 항목: ${[...source.unmatched,...source.ambiguous].map(esc).join(' · ')}. 미등록·중지 업체가 포함될 수 있습니다.</p>` : ''}</details>` : ''}
      ${data.noDelivery ? '<div class="mb-empty">공휴일·휴무일 또는 주말입니다. 오늘 월식 배송은 없습니다.</div>' : `<nav class="mb-course-nav" aria-label="배송코스 바로가기">${data.plan.lanes.map(lane=>`<button type="button" data-jump-lane="${esc(lane.id)}">${esc(lane.name)} <b>${laneRows(lane.id).length}</b></button>`).join('')}</nav><div class="mb-board">${data.plan.lanes.map(lane => laneHtml(lane)).join('')}</div>`}
      <details class="mb-excluded"><summary>자체 휴무 ${data.excluded.length}곳</summary><div class="mb-excluded-items">${data.excluded.map(row => `<button type="button" data-customer="${esc(row.uid)}">${esc(row.businessName)} · 휴무 수정</button>`).join('')}</div></details>
      <div class="mb-footer"><span>⠿ 손잡이로 순서 변경·코스 이동 · 변경 후 자동 저장 · 취소·휴무는 자동 제외</span><button type="button" data-undo${!history.length || busy ? ' disabled' : ''}>이전 편집 되돌리기</button></div>`;
  }
  function laneHtml(lane) {
    const rows = laneRows(lane.id), sum = totals(rows);
    return `<section id="mb-lane-${esc(lane.id)}" class="mb-lane${lane.id === 'unassigned' ? ' unassigned' : ''}" aria-label="${esc(lane.name)} 배송코스"><div class="mb-lane-header"><div><div class="mb-lane-title">${esc(lane.name)}</div><div class="mb-lane-meta">${esc(lane.driver || (lane.id === 'unassigned' ? '코스 지정 필요' : '담당 미입력'))} · ${rows.length}곳 · 도시락 ${sum.lunch}${sum.salad ? ` · 샐러드 ${sum.salad}` : ''}${sum.event ? ` · 일회용 ${sum.event}` : ''}</div></div><div class="mb-lane-actions">${lane.id !== 'unassigned' ? `<button type="button" data-sort-time="${esc(lane.id)}" aria-label="${esc(lane.name)} 시간순 배치"${busy || rows.length < 2 ? ' disabled' : ''}>시간순 배치</button><button type="button" data-share="${esc(lane.id)}"${busy ? ' disabled' : ''}>기사님 링크</button><button type="button" data-edit-lane="${esc(lane.id)}"${busy ? ' disabled' : ''}>코스 설정</button>` : ''}</div></div><div class="mb-stops" data-drop-lane="${esc(lane.id)}" role="list">${rows.length ? rows.map((row, index) => cardHtml(row, index, lane, rows.length)).join('') : '<div class="mb-empty">업체를 이곳으로 옮기기</div>'}</div></section>`;
  }
  function cardHtml(row, index, lane, length) {
    return `<article class="mb-stop${row.delivered ? ' done' : ''}" data-stop-id="${esc(row.uid)}" role="listitem"><button type="button" class="mb-handle" data-drag-id="${esc(row.uid)}" aria-label="${esc(row.businessName)} 순서 드래그"${busy ? ' disabled' : ''}>⠿</button><div><div class="mb-num">${index+1}번째${row.delivered ? ' · <span class="mb-completed">배송완료</span>' : ''}</div><div class="mb-stop-name">${esc(row.businessName)}</div><div class="mb-qty">${esc(qty(row))}</div><div class="mb-time${row.mealTime ? '' : ' unset'}">${row.mealTime ? `배송 ${esc(row.mealTime)}` : '시간 미입력'}</div></div><details class="mb-menu"><summary aria-label="${esc(row.businessName)} 메뉴">⋯</summary><div class="mb-menu-content"><label>배송코스<select data-move-id="${esc(row.uid)}"${busy ? ' disabled' : ''}>${data.plan.lanes.map(l => `<option value="${esc(l.id)}"${l.id === lane.id ? ' selected' : ''}>${esc(l.name)}</option>`).join('')}</select></label><div class="mb-move-buttons"><button type="button" data-step-id="${esc(row.uid)}" data-step="-1"${index === 0 || busy ? ' disabled' : ''}>앞으로</button><button type="button" data-step-id="${esc(row.uid)}" data-step="1"${index === length-1 || busy ? ' disabled' : ''}>뒤로</button></div><button type="button" data-customer="${esc(row.uid)}">고객정보 · 휴무 수정</button><button type="button" class="mb-danger" data-pause="${esc(row.uid)}"${row.delivered || busy ? ' disabled' : ''}>오늘 휴무로 변경</button></div></details></article>`;
  }
  async function refresh(quiet = false) {
    if (!active || document.hidden) return;
    if (busy || drag || loading) { deferredRefresh = true; return; }
    const current = ++generation, requestedDate = date;
    loading = true; if (!data || !quiet) render();
    try {
      const result = await request('read', { date:requestedDate });
      if (!active || current !== generation || requestedDate !== date) return;
      if (drag || busy) { deferredRefresh = true; return; }
      if (data && result.revision !== data.revision) history = [];
      data = result; failure = ''; status = `최신 배송 · ${new Date().toLocaleTimeString('ko-KR', { hour:'2-digit', minute:'2-digit' })}`;
    } catch (e) { if (current === generation && active) failure = `갱신 실패: ${e.message}`; }
    finally {
      if (current === generation) { loading = false; if (!drag) render(); if (deferredRefresh && !busy && !drag) { deferredRefresh = false; scheduleRefresh(); } }
    }
  }
  function scheduleRefresh() {
    clearTimeout(refreshTimer);
    if (active) refreshTimer = setTimeout(() => refresh(true), 650);
  }
  function watch() {
    subscriptions.forEach(unsub => unsub()); subscriptions = [];
    const refs = [config.db.collection('users'), config.db.collection('userPrivate'), config.db.collection('config').doc('holidays'), config.db.collection('config').doc('settings'),
      config.db.collection('orders').doc(date).collection('items'), config.db.collection('orderLocks').doc(date), config.db.collection('orderDefaultSnapshots').doc(date).collection('items'),
      config.db.collection('deliveryRecords').doc(date), config.db.collection('deliveryRecordArchive').doc(date), config.db.collection('monthlyDeliveryBoards').doc(date),
      config.db.collection('monthlyDeliveryTemplates').doc(['sun','mon','tue','wed','thu','fri','sat'][new Date(`${date}T00:00:00Z`).getUTCDay()])];
    refs.forEach(ref => { let first = true; subscriptions.push(ref.onSnapshot(() => { if (first) { first = false; return; } scheduleRefresh(); }, () => { /* Periodic API refresh remains available if a listener fails. */ })); });
  }
  async function persist(plan, message, addHistory = true) {
    if (busy || !data) return;
    const previous = clone(data.plan), expected = data.revision, requestedDate = date, op = ++mutation;
    busy = true; failure = ''; data.plan = plan; render();
    try {
      const result = await request('save', { date:requestedDate, revision:expected, plan });
      if (!active || op !== mutation || date !== requestedDate) return;
      data.revision = result.revision;
      if (addHistory) { history.push(previous); if (history.length > 15) history.shift(); }
      status = message;
    } catch (e) { if (op === mutation && active) { data.plan = previous; failure = e.message; deferredRefresh = true; } }
    finally { if (op === mutation && active) { busy = false; render(); if (deferredRefresh) { deferredRefresh = false; scheduleRefresh(); } } }
  }
  async function mutate(action, body, onSuccess, reload = false) {
    if (busy || !data) return;
    const requestedDate = date, op = ++mutation;
    busy = true; failure = ''; render();
    try {
      const result = await request(action, { date:requestedDate, ...body });
      if (!active || op !== mutation || requestedDate !== date) return;
      onSuccess(result);
    } catch (e) { if (op === mutation && active) { failure = e.message; deferredRefresh = true; } }
    finally { if (op === mutation && active) { busy = false; render(); if (reload) await refresh(true); else if (deferredRefresh) { deferredRefresh = false; scheduleRefresh(); } } }
  }
  function move(uid, laneId, targetId = '', after = false) {
    if (!data || busy || uid === targetId || !data.plan.order[laneId]) return;
    const plan = clone(data.plan);
    Object.keys(plan.order).forEach(key => { plan.order[key] = plan.order[key].filter(id => id !== uid); });
    let index = targetId ? plan.order[laneId].indexOf(targetId) : -1;
    if (index < 0) index = plan.order[laneId].length; else if (after) index++;
    plan.order[laneId].splice(index, 0, uid);
    persist(plan, '코스·방문 순서 저장 완료');
  }
  function setDate(next) {
    if (busy || !/^\d{4}-\d{2}-\d{2}$/.test(next)) return;
    generation++; loading = false; date = next; data = null; history = []; failure = ''; status = ''; deferredRefresh = false;
    config.onDate?.(date); watch(); refresh();
  }
  function editLane(id = '') {
    editingLane = id; editingRevision = data.revision;
    const lane = data.plan.lanes.find(l => l.id === id), dialog = root.querySelector('[data-lane-dialog]');
    dialog.querySelector('[name=laneName]').value = lane?.name || '';
    dialog.querySelector('[name=driver]').value = lane?.driver || '';
    dialog.querySelector('[data-lane-title]').textContent = id ? '코스 카테고리 수정' : '코스 카테고리 추가';
    dialog.querySelector('[data-delete-lane]').hidden = !id;
    dialog.querySelector('[data-category-order]').hidden = !id;
    const index = data.plan.lanes.findIndex(l => l.id === id);
    dialog.querySelector('[data-lane-step="-1"]').disabled = index <= 0;
    dialog.querySelector('[data-lane-step="1"]').disabled = index >= data.plan.lanes.length-2;
    dialog.querySelector('[data-category-note]').textContent = id ? '이름·차량을 바꿔도 배정된 업체와 기사님 링크는 유지됩니다. 삭제하면 업체는 미배정으로 이동하고 링크는 해제됩니다.' : '필요한 동네·차량별 코스를 만들고 업체 카드를 옮겨주세요.';
    dialog.showModal();
  }
  function checkLaneEdit() {
    if (data?.revision === editingRevision) return true;
    root.querySelector('[data-lane-dialog]').close(); failure = '다른 화면에서 코스가 바뀌었습니다. 최신 카테고리를 다시 열어 수정해주세요.'; render(); return false;
  }
  function saveLaneForm(event) {
    event.preventDefault();
    if (busy || !checkLaneEdit()) return;
    const dialog = root.querySelector('[data-lane-dialog]'), plan = clone(data.plan);
    const name = dialog.querySelector('[name=laneName]').value.trim(), driver = dialog.querySelector('[name=driver]').value.trim();
    if (!name) return;
    if (editingLane) Object.assign(plan.lanes.find(l => l.id === editingLane), { name, driver });
    else {
      if (plan.lanes.length >= 15) { alert('코스는 미배정을 포함해 최대 15개까지 만들 수 있습니다.'); return; }
      const id = `course_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,6)}`;
      plan.lanes.splice(plan.lanes.length-1, 0, { id, name, driver }); plan.order[id] = [];
    }
    dialog.close(); persist(plan, '배송코스 저장 완료');
  }
  async function showShare(id) {
    await mutate('share', { laneId:id, revision:data.revision }, result => {
      data.revision = result.revision; shareLane = id;
      const link = new URL('monthly-delivery.html', location.href); link.hash = `token=${result.token}`;
      const lane = data.plan.lanes.find(l => l.id === id), dialog = root.querySelector('[data-share-dialog]');
      dialog.querySelector('[data-share-content]').innerHTML = `<div>${esc(lane.name)} · ${esc(lane.driver)}</div><label>기사님께 전달할 링크<input type="text" readonly data-share-url value="${esc(link.href)}"></label><a class="mb-share-open" href="${esc(link.href)}" target="_blank" rel="noopener noreferrer">기사님 화면 열기</a><div class="mb-dialog-note">${esc(date)} 담당 코스 조회·완료 체크용입니다.<br>유효기간: ${esc(new Date(result.expiresAt).toLocaleString('ko-KR', { timeZone:'Asia/Seoul' }))}</div><div data-share-status role="status"></div>`;
      dialog.showModal(); status = '기사님 링크 준비 완료';
    });
  }
  async function onClick(event) {
    const button = event.target.closest('button'); if (!button || button.disabled) return;
    if (button.hasAttribute('data-refresh')) { refresh(); return; }
    if (button.hasAttribute('data-jump-lane')) { document.getElementById(`mb-lane-${button.dataset.jumpLane}`)?.scrollIntoView({ behavior:'smooth',block:'start' }); return; }
    if (button.hasAttribute('data-sort-time')) {
      if (busy || !data || data.noDelivery) return;
      const plan = sortPlanByTime(data.plan,data.rows,button.dataset.sortTime);
      if (JSON.stringify(plan.order) === JSON.stringify(data.plan.order)) { status = '이미 배송시간 순서입니다. 시간 미입력 업체는 뒤에 표시합니다.'; render(); return; }
      await persist(plan,'배송시간 순서로 배치했습니다. 같은 시간은 기존 순서를 유지합니다.'); return;
    }
    if (button.hasAttribute('data-date-step')) { const d = new Date(`${date}T00:00:00Z`); d.setUTCDate(d.getUTCDate()+Number(button.dataset.dateStep)); setDate(d.toISOString().slice(0,10)); return; }
    if (button.hasAttribute('data-today')) { setDate(new Date(Date.now()+9*3600000).toISOString().slice(0,10)); return; }
    if (button.hasAttribute('data-edit-lane')) { editLane(button.dataset.editLane); return; }
    if (button.hasAttribute('data-add-lane')) { editLane(); return; }
    if (button.hasAttribute('data-dialog-close')) { root.querySelector('[data-lane-dialog]').close(); return; }
    if (button.hasAttribute('data-share-close')) { root.querySelector('[data-share-dialog]').close(); return; }
    if (button.hasAttribute('data-share')) { await showShare(button.dataset.share); return; }
    if (button.hasAttribute('data-customer')) { config.openCustomer?.(button.dataset.customer, date); return; }
    if (button.hasAttribute('data-step-id')) {
      const uid = button.dataset.stepId, lane = data.plan.lanes.find(l => data.plan.order[l.id].includes(uid)), rows = laneRows(lane.id);
      const index = rows.findIndex(row => row.uid === uid), step = Number(button.dataset.step);
      if (rows[index+step]) move(uid, lane.id, rows[index+step].uid, step > 0); return;
    }
    if (button.hasAttribute('data-delete-lane')) {
      if (busy || !checkLaneEdit()) return;
      if (!confirm('이 코스를 삭제하고 배정 업체를 미배정으로 옮길까요? 기사님 링크도 더 이상 사용할 수 없습니다.')) return;
      const plan = clone(data.plan); plan.order.unassigned.push(...plan.order[editingLane]); delete plan.order[editingLane]; plan.lanes = plan.lanes.filter(l => l.id !== editingLane);
      root.querySelector('[data-lane-dialog]').close(); persist(plan, '코스 삭제 · 업체는 미배정으로 이동'); return;
    }
    if (button.hasAttribute('data-lane-step')) {
      if (busy || !checkLaneEdit()) return;
      const plan = clone(data.plan), index = plan.lanes.findIndex(l => l.id === editingLane), next = index+Number(button.dataset.laneStep);
      if (index < 0 || next < 0 || next >= plan.lanes.length-1) return;
      [plan.lanes[index], plan.lanes[next]] = [plan.lanes[next], plan.lanes[index]];
      const dialog = root.querySelector('[data-lane-dialog]');
      const lane = plan.lanes.find(l => l.id === editingLane);
      const name = dialog.querySelector('[name=laneName]').value.trim();
      if (!name) { dialog.querySelector('[name=laneName]').reportValidity(); return; }
      lane.name = name; lane.driver = dialog.querySelector('[name=driver]').value.trim();
      dialog.close(); await persist(plan, '카테고리 표시 순서 저장 완료'); return;
    }
    if (button.hasAttribute('data-undo')) { const plan = history.pop(); if (plan) await persist(plan, '이전 편집으로 되돌렸습니다.', false); return; }
    if (button.hasAttribute('data-copy-share')) {
      const input = root.querySelector('[data-share-url]'), message = root.querySelector('[data-share-status]');
      try { await navigator.clipboard.writeText(input.value); message.textContent = '링크를 복사했습니다.'; }
      catch (_) { input.select(); message.textContent = '위 링크를 길게 눌러 복사해주세요.'; } return;
    }
    if (button.hasAttribute('data-revoke')) {
      if (!confirm('이 코스의 기사님 링크를 해제할까요? 새로 링크를 만들면 다시 공유할 수 있습니다.')) return;
      await mutate('revoke', { laneId:shareLane }, () => { root.querySelector('[data-share-dialog]').close(); status = '기사님 링크를 해제했습니다.'; });
      if (failure) root.querySelector('[data-share-status]').textContent = failure;
      return;
    }
    if (button.hasAttribute('data-template')) {
      await mutate('template', { templateRevision:data.templateRevision, plan:data.plan }, result => { data.templateRevision = result.templateRevision; status = `${weekdayLabel(date)}요일 기본 코스를 저장했습니다.`; }); return;
    }
    if (button.hasAttribute('data-pause')) {
      const row = byUid().get(button.dataset.pause);
      if (!row || !confirm(`${row.businessName}의 ${date} 월식을 휴무로 변경할까요?`)) return;
      await mutate('pause', { uid:row.uid, signature:row.signature }, () => { status = '오늘 휴무로 변경했습니다.'; }, true);
    }
  }
  function onChange(event) {
    if (event.target.hasAttribute('data-date')) setDate(event.target.value);
    if (event.target.hasAttribute('data-move-id')) move(event.target.dataset.moveId, event.target.value);
  }
  function clearDrag() { root.querySelectorAll('.mb-drop-active,.mb-before,.mb-after').forEach(el => el.classList.remove('mb-drop-active','mb-before','mb-after')); }
  function dragStart(event) {
    const handle = event.target.closest('[data-drag-id]'); if (!handle || event.button !== 0 || busy || failure) return;
    drag = { uid:handle.dataset.dragId, pointerId:event.pointerId, card:handle.closest('.mb-stop'), x:event.clientX, y:event.clientY, moving:false, target:null };
    root.setPointerCapture(event.pointerId);
  }
  function dragMove(event) {
    if (!drag || drag.pointerId !== event.pointerId || (!drag.moving && Math.hypot(event.clientX-drag.x,event.clientY-drag.y)<6)) return;
    event.preventDefault();
    if (!drag.moving) { drag.moving = true; drag.card.classList.add('mb-dragging'); const ghost = drag.card.cloneNode(true); ghost.removeAttribute('data-stop-id'); ghost.classList.add('mb-ghost'); ghost.classList.remove('mb-dragging'); ghost.style.width = `${drag.card.getBoundingClientRect().width}px`; ghost.querySelector('details')?.remove(); root.append(ghost); drag.ghost = ghost; }
    const bounds = root.getBoundingClientRect(); drag.ghost.style.left = `${event.clientX-bounds.left+10}px`; drag.ghost.style.top = `${event.clientY-bounds.top+10}px`; clearDrag();
    const under = document.elementFromPoint(event.clientX,event.clientY), zone = under?.closest('[data-drop-lane]'); drag.target = null;
    if (!zone || !root.contains(zone)) return;
    zone.classList.add('mb-drop-active'); const target = under.closest('[data-stop-id]');
    if (target && target.dataset.stopId !== drag.uid) { const rect = target.getBoundingClientRect(), vertical = zone.getBoundingClientRect().width < rect.width*1.5, after = vertical ? event.clientY > rect.top+rect.height/2 : event.clientX > rect.left+rect.width/2; target.classList.add(after ? 'mb-after' : 'mb-before'); drag.target = { lane:zone.dataset.dropLane, uid:target.dataset.stopId, after }; }
    else if (!target) drag.target = { lane:zone.dataset.dropLane, uid:'', after:false };
    const viewportY = event.clientY;
    if (viewportY > innerHeight-80) window.scrollBy(0,14); else if (viewportY < 100) window.scrollBy(0,-14);
  }
  function dragEnd(event, cancelled = false) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const old = drag; drag = null; old.ghost?.remove(); old.card.classList.remove('mb-dragging'); clearDrag();
    if (root.hasPointerCapture(old.pointerId)) root.releasePointerCapture(old.pointerId);
    if (!cancelled && old.moving && old.target) move(old.uid, old.target.lane, old.target.uid, old.target.after);
    else if (deferredRefresh) { deferredRefresh = false; scheduleRefresh(); }
  }
  function close() {
    active = false; generation++; mutation++; loading = false; busy = false; deferredRefresh = false; clearInterval(timer); clearTimeout(refreshTimer);
    subscriptions.forEach(unsub => unsub()); subscriptions = [];
    if (drag) dragEnd({ pointerId:drag.pointerId }, true);
    root?.querySelectorAll('dialog[open]').forEach(dialog => dialog.close());
  }
  function open(options) {
    if (!config) { config = options; root = options.root; init(); } else config = options;
    close(); active = true;
    if (date !== options.date) { data = null; history = []; } date = options.date;
    watch(); refresh(); timer = setInterval(() => refresh(true), 20000);
  }
  if (typeof module === 'object' && module.exports) module.exports = { timeMinutes,sortPlanByTime };
  else window.MonthlyDeliveryBoard = { open, close };
})();
