(function () {
  'use strict';
  // 매장 관리 → 돌담명가 예약: 직원 공용 예약장 링크와 구글 시트 가져오기.
  const API = 'https://asia-northeast3-gjsuragan-60505.cloudfunctions.net/reservationBoardApi';
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const status = { booked: '예약', changed: '변경', cancelled: '취소' };
  let active = false, link = null, preview = null, busy = false;

  async function api(action, body = {}) {
    const token = await window.AttendanceSession.getToken();
    const abort = new AbortController(), timer = setTimeout(() => abort.abort(), 30000);
    try {
      const response = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action, ...body }), cache: 'no-store', signal: abort.signal });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) throw new Error(result.error || '요청을 처리하지 못했습니다.');
      return result;
    } catch (err) {
      if (err.name === 'AbortError' || err instanceof TypeError) throw new Error('응답을 확인하지 못했습니다. 인터넷 연결을 확인한 뒤 다시 눌러 주세요.');
      throw err;
    } finally { clearTimeout(timer); }
  }
  function boardUrl(token) { return new URL(`./reservations.html#token=${token}`, location.href).href; }
  async function copy(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch (_) {
      const field = document.createElement('textarea');
      field.value = text; field.setAttribute('readonly', ''); field.style.position = 'fixed'; field.style.left = '-9999px';
      document.body.appendChild(field); field.select();
      const ok = document.execCommand('copy'); field.remove(); return ok;
    }
  }
  function render() {
    const el = $('reservation-board-admin-root');
    if (!el || !active) return;
    const hasLink = Boolean(link?.token);
    el.innerHTML = `<section class="rba-card" aria-label="직원 공용 예약장">
      <div class="rba-head"><div><p class="att-eyebrow">STAFF BOARD</p><h3>직원 공용 예약장</h3>
        <p class="att-subtitle">직원이 휴대폰으로 예약을 보고 등록·수정·삭제하는 화면입니다. 네이버 예약은 「네이버예약」 표시로 자동으로 함께 보이고, 네이버 예약이 취소되면 취소된 그날 경고 창이 뜹니다.</p></div></div>
      <div class="rba-link">${link === null ? '<p class="att-meta">링크 상태를 확인하는 중…</p>' : hasLink
        ? `<p class="rba-url"><span>공유 링크${link.createdAt ? ` · ${esc(new Date(link.createdAt).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' }))} 만듦` : ''}</span><code>${esc(boardUrl(link.token).replace(/#token=.*/, '#token=…'))}</code></p>
          <div class="rba-actions"><button class="att-button att-primary" type="button" data-rba="copy">링크 복사</button><a class="att-button" href="${esc(boardUrl(link.token))}" target="_blank" rel="noopener">예약장 열기 ↗</a><button class="att-button att-danger" type="button" data-rba="rotate">새 링크 만들기</button></div>`
        : '<p class="att-meta">아직 공유 링크가 없습니다.</p><div class="rba-actions"><button class="att-button att-primary" type="button" data-rba="rotate">공유 링크 만들기</button></div>'}
        <p class="att-meta rba-note">링크를 가진 사람은 로그인 없이 누구나 예약을 보고 고칠 수 있습니다. 직원 단톡방에만 올려 주세요. 링크를 바꿔야 하면 「새 링크 만들기」를 누르세요 — 이전 링크는 30초 안에 막히고, 직원에게 새 링크를 다시 보내야 합니다.</p></div>
      <details class="rba-import"${preview ? ' open' : ''}><summary>구글 시트에서 지금까지의 예약 가져오기</summary>
        <p class="att-meta">「직원 공용 예약장」 시트(첫 줄: 날짜 · 낮/밤 · 예약시간 · 예약자명 · 연락처 · 인원 · 메뉴 · 예약경로 · 비고 · 예약상태 · 룸 · 예약자)를 그대로 옮깁니다. 시트 공유를 「링크가 있는 모든 사용자 · 뷰어」로 바꾼 뒤 주소를 붙여 넣으세요. 이미 가져온 줄은 건너뛰고, 가져온 뒤 예약장에서 고친 내용도 덮어쓰지 않으니 여러 번 눌러도 됩니다.</p>
        <div class="rba-import-row"><input class="att-input" id="rba-sheet" type="url" inputmode="url" placeholder="https://docs.google.com/spreadsheets/d/…" value="${esc(preview?.url || '')}"><button class="att-button" type="button" data-rba="preview">미리보기</button></div>
        ${preview ? previewHtml() : ''}
      </details>
      <p class="att-error" id="rba-error" role="alert"></p><p class="att-meta" id="rba-message" role="status"></p></section>`;
  }
  function previewHtml() {
    const p = preview.result;
    return `<div class="rba-preview"><p><b>${p.total}건</b> 읽음 · 새로 들어올 예약 <b>${p.newCount}건</b> · 이미 가져옴 ${p.existing}건${p.skipped.length ? ` · 건너뜀 ${p.skipped.length}줄` : ''}</p>
      ${[...p.skipped, ...p.warnings].length ? `<ul class="rba-issues">${[...p.skipped, ...p.warnings].map(line => `<li>${esc(line)}</li>`).join('')}</ul>` : ''}
      <div class="rba-table-wrap"><table class="rba-table"><thead><tr><th>날짜</th><th>시간</th><th>예약자명</th><th>인원</th><th>메뉴</th><th>경로</th><th>상태</th><th></th></tr></thead><tbody>
      ${p.rows.map(row => `<tr class="${row.exists ? 'is-old' : ''}"><td>${esc(row.date.slice(5).replace('-', '/'))}</td><td>${esc(row.time || '—')}</td><td>${esc(row.name)}</td><td>${row.people ?? '?'}</td><td>${esc(row.menu)}</td><td>${esc(row.route)}</td><td>${status[row.status]}</td><td>${row.exists ? '이미 있음' : '새로'}</td></tr>`).join('')}
      </tbody></table></div>
      ${p.newCount ? `<button class="att-button att-primary" type="button" data-rba="import">${p.newCount}건 가져오기</button>` : '<p class="att-meta">새로 가져올 예약이 없습니다.</p>'}</div>`;
  }
  async function loadLink() {
    try { link = await api('adminShare'); } catch (err) { link = { token: '' }; render(); $('rba-error').textContent = err.message; return; }
    render();
  }
  async function act(kind) {
    if (busy) return;
    const error = $('rba-error'), message = $('rba-message');
    error.textContent = ''; message.textContent = '';
    if (kind === 'copy') { message.textContent = await copy(boardUrl(link.token)) ? '링크를 복사했습니다. 직원 단톡방에 붙여 넣으세요.' : '복사하지 못했습니다. 「예약장 열기」 후 주소창의 주소를 복사해 주세요.'; return; }
    if (kind === 'rotate' && link?.token && !window.confirm('새 링크를 만들면 지금 직원들이 쓰는 링크는 30초 안에 막힙니다. 새 링크를 다시 보내야 합니다. 계속할까요?')) return;
    busy = true;
    document.querySelectorAll('[data-rba]').forEach(button => { button.disabled = true; });
    try {
      if (kind === 'rotate') {
        link = await api('adminShareRotate'); render();
        $('rba-message').textContent = '새 링크를 만들었습니다. 「링크 복사」로 직원에게 보내 주세요.';
      } else if (kind === 'preview') {
        const url = $('rba-sheet').value.trim();
        preview = { url, result: await api('adminImport', { url, dryRun: true }) }; render();
      } else if (kind === 'import') {
        const result = await api('adminImport', { url: preview.url });
        preview = { url: preview.url, result: { ...result, newCount: 0 } }; render();
        $('rba-message').textContent = `${result.created}건을 가져왔습니다. 예약장에서 바로 볼 수 있습니다.`;
      }
    } catch (err) {
      render(); $('rba-error').textContent = err.message;
    } finally {
      busy = false;
      document.querySelectorAll('[data-rba]').forEach(button => { button.disabled = false; });
    }
  }
  function onClick(event) {
    const target = event.target.closest('[data-rba]');
    if (target) act(target.dataset.rba);
  }
  function init() {
    const el = $('reservation-board-admin-root');
    if (!el) return;
    if (!active) { active = true; el.addEventListener('click', onClick); }
    render(); loadLink();
  }
  function dispose() {
    const el = $('reservation-board-admin-root');
    if (el) { el.removeEventListener('click', onClick); el.innerHTML = ''; }
    active = false; link = null; preview = null; busy = false;
  }
  window.ReservationBoardAdmin = { init, dispose };
})();
