// ════════════════════════════════════════
// 렌더링 통합
// ════════════════════════════════════════
function refreshAll(){ renderDash(); renderToday(); renderCust(); renderReport(); if(typeof renderOrderSettlement==='function') renderOrderSettlement(); renderCancelLogs(); if(typeof renderRouteMap==='function') renderRouteMap(false, true); checkRiskOrderAlert(); }

// 화면 크기 변경 시 재렌더링 (모바일↔PC 전환)
let _resizeTimer;
window.addEventListener('resize', ()=>{
  clearTimeout(_resizeTimer);
  _resizeTimer = setTimeout(()=>{ renderToday(); renderCust(); if(typeof renderRouteMap==='function') renderRouteMap(false, true); }, 200);
});

function dashDeliveryRow(c, showGauge = true){
  const productBadges = `${deliveryProductBadgeHtml(c)}${deliveryFirstOrderBadge(c)}${lastBoxDeliveryBadge(c)}`;
  return `<tr>
    <td><strong style="cursor:pointer;color:var(--accent);text-decoration:underline dotted;" onclick="openEdit('${customerJsArg(c.id)}')">${escHtml(c.name)}</strong></td>
    <td><div style="display:flex;gap:4px;flex-wrap:wrap;align-items:center;">${productBadges}</div></td>
    <td><span class="badge ${c.orderType==='once'?'b-once':'b-sub'}">${c.orderType==='once'?'선택':'정기'}</span></td>
    <td>${escHtml(c.phone||'-')}</td>
    ${showGauge ? `<td>${gauge(c)}</td>` : ''}
  </tr>`;
}
function dashEmptyRow(colspan, icon, text){
  return `<tr><td colspan="${colspan}"><div class="empty"><div class="ei">${icon}</div><div>${text}</div></div></td></tr>`;
}

function deliveryProductBadgeHtml(c){
  const key = c?.productId || c?.set;
  return `<span class="badge ${productBadgeClass(key)}">${escHtml(productLabel(key))}</span>`;
}

function isLastBoxDelivery(c){
  if(!c?.isDirect) return false;
  if(c.status !== 'active') return false;
  return Number(c.remain || 0) === 1;
}

function lastBoxDeliveryBadge(c){
  return isLastBoxDelivery(c)
    ? '<span class="badge" title="마지막 직배송은 보냉가방 대신 박스로 발송" style="background:#fef3c7;color:#92400e;border-color:#f59e0b;font-weight:900;">박스</span>'
    : '';
}

function customerDeliveredCount(c){
  return Array.isArray(c?.deliveredDates) ? c.deliveredDates.filter(Boolean).length : 0;
}

function customerIsFirstOrder(c){
  if(!c || c.status === 'end') return false;
  const key = customerGroupKey(c);
  if(!key) return false;
  const sameCustomerOrders = (custs || []).filter(item => customerGroupKey(item) === key);
  if(sameCustomerOrders.length !== 1) return false;
  return customerDeliveredCount(c) === 0;
}

function deliveryFirstOrderBadge(c){
  return customerIsFirstOrder(c) ? firstOrderBadgeHtml() : '';
}

const SINGLE_PRODUCT_IDS = ['pork_rib','beef_la','beef_soup'];

function productFilterKey(c){
  const raw = String(c?.productId || c?.set || '').trim();
  if(['A','B','C'].includes(raw)) return raw;
  const compact = raw.replace(/\s/g, '').toUpperCase();
  if(compact.startsWith('A세트') || compact === 'ASET' || compact === 'A-SET') return 'A';
  if(compact.startsWith('B세트') || compact === 'BSET' || compact === 'B-SET') return 'B';
  if(compact.startsWith('C세트') || compact === 'CSET' || compact === 'C-SET') return 'C';
  if(SINGLE_PRODUCT_IDS.includes(raw)) return 'single';
  return raw ? 'single' : '';
}

function filterDeliveryByProduct(list, selector){
  const checks = Array.from(document.querySelectorAll(selector));
  const checkedVals = checks.filter(el => el.checked).map(el => el.value);
  if(!checks.length || checkedVals.length === 0 || checkedVals.length === checks.length) return list;
  return list.filter(c => checkedVals.includes(productFilterKey(c)));
}

function cancelLogTime(log){
  const raw = log.createdAt || '';
  const d = raw ? new Date(raw) : null;
  if(!d || Number.isNaN(d.getTime())) return escHtml(raw);
  return d.toLocaleString('ko-KR', {month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit'});
}

function cancelReasonText(log){
  const parts = [
    log.cancelReasonText,
    [log.cancelReason, log.cancelReasonDetail].filter(Boolean).join(' / ')
  ].filter(Boolean);
  return parts[0] || '';
}

function ensureCancelInlineNotice(){
  let el = document.getElementById('cancelInlineNotice');
  if(el) return el;
  const stats = document.querySelector('#page-dash .stat-grid');
  if(!stats || !stats.parentNode) return null;
  el = document.createElement('div');
  el.id = 'cancelInlineNotice';
  el.className = 'cancel-inline-notice';
  stats.parentNode.insertBefore(el, stats.nextSibling);
  return el;
}

function renderCancelInlineNotice(unread){
  const el = ensureCancelInlineNotice();
  if(!el) return;

  if(cancelLogsError){
    el.style.display = 'flex';
    el.innerHTML = `<div><div class="cancel-inline-title">아임웹 취소삭제 로그 읽기 오류</div><div class="cancel-inline-meta">${escHtml(cancelLogsError)}</div></div>`;
    return;
  }

  if(!unread.length){
    el.style.display = 'none';
    el.innerHTML = '';
    return;
  }

  const log = unread[0];
  const names = Array.isArray(log.customerNames) ? log.customerNames.filter(Boolean).join(', ') : '';
  const reason = cancelReasonText(log);
  const extra = unread.length > 1 ? ` 외 ${unread.length - 1}건` : '';
  el.style.display = 'flex';
  el.innerHTML = `
    <div style="min-width:0;">
      <div class="cancel-inline-title">아임웹 취소삭제 ${unread.length}건</div>
      <div class="cancel-inline-meta">
        <b>${escHtml(names || '이름 없음')}${extra}</b>
        <span>#${escHtml(log.orderNo || '')}</span>
        <span>${Number(log.deletedCount || 0)}건 삭제</span>
        <span>${cancelLogTime(log)}</span>
        <span>사유: ${escHtml(reason || '-')}</span>
      </div>
    </div>
    <button class="btn btn-g sm" onclick="ackCancelLogs()">확인 완료</button>
  `;
}

function renderCancelPopover(unread){
  const list = document.getElementById('cancelPopoverList');
  if(!list) return;

  if(cancelLogsError){
    list.innerHTML = `<div class="cancel-pop-item">
      <div class="cancel-pop-main"><span class="cancel-pop-name">읽기 오류</span><span class="cancel-pop-status">확인필요</span></div>
      <div class="cancel-pop-meta">${escHtml(cancelLogsError)}</div>
    </div>`;
    return;
  }

  if(!unread.length){
    list.innerHTML = `<div class="cancel-pop-item">
      <div class="cancel-pop-meta">확인할 취소삭제 내역이 없습니다.</div>
    </div>`;
    return;
  }

  list.innerHTML = unread.slice(0,6).map(log => {
    const names = Array.isArray(log.customerNames) ? log.customerNames.filter(Boolean).join(', ') : '';
    const orderNo = log.orderNo ? '#' + log.orderNo : '주문번호 없음';
    const deletedCount = Number(log.deletedCount || 0);
    const reason = cancelReasonText(log);
    return `<div class="cancel-pop-item">
      <div class="cancel-pop-main">
        <span class="cancel-pop-name">${escHtml(names || '이름 없음')}</span>
        <span class="cancel-pop-status">${escHtml(log.cancelStatus || '취소')}</span>
      </div>
      <div class="cancel-pop-meta">${escHtml(orderNo)} · ${deletedCount}건 삭제 · ${cancelLogTime(log)}</div>
      ${reason ? `<div class="cancel-pop-meta"><b>사유:</b> ${escHtml(reason)}</div>` : ''}
    </div>`;
  }).join('');
}

function toggleCancelPopover(event){
  if(event) event.stopPropagation();
  document.getElementById('cancelPopover')?.classList.toggle('on');
}

function closeCancelPopover(){
  document.getElementById('cancelPopover')?.classList.remove('on');
}

function renderCancelLogs(){
  const wrap = document.getElementById('cancelNotice');
  const body = document.getElementById('cancelLogBody');
  const cards = document.getElementById('cancelLogCards');
  const summary = document.getElementById('cancelNoticeSummary');
  const count = document.getElementById('cancelNoticeCount');
  const pillWrap = document.getElementById('cancelPillWrap');
  const pillCount = document.getElementById('cancelPillCount');
  if(!wrap || !body || !count) return;
  const tableWrap = wrap.querySelector('.tw');
  if(tableWrap && cards) tableWrap.style.display = 'none';

  const unread = (cancelLogs || []).filter(log => !log.acknowledged);
  renderCancelInlineNotice(unread);
  renderCancelPopover(unread);
  if(pillWrap && pillCount){
    pillWrap.style.display = unread.length || cancelLogsError ? 'flex' : 'none';
    pillCount.textContent = cancelLogsError ? '!' : unread.length;
  }

  if(cancelLogsError){
    count.textContent = '!';
    wrap.style.display = 'block';
    wrap.classList.add('is-visible');
    body.innerHTML = `<tr><td colspan="6" style="color:var(--danger);">
      취소삭제 로그를 읽을 수 없습니다. Firestore rules에 imwebCancelLogs 읽기 권한을 배포해야 합니다.
    </td></tr>`;
    if(cards){
      cards.innerHTML = '';
    }
    if(summary) summary.innerHTML = `<span><b>읽기 오류:</b> ${escHtml(cancelLogsError)}</span>`;
    return;
  }

  count.textContent = unread.length;
  wrap.style.display = unread.length ? 'block' : 'none';
  wrap.classList.toggle('is-visible', !!unread.length);
  if(!unread.length){
    body.innerHTML = '';
    if(cards) cards.innerHTML = '';
    if(summary) summary.innerHTML = '';
    return;
  }

  const rows = unread.slice(0,8).map(log => {
    const names = Array.isArray(log.customerNames) ? log.customerNames.filter(Boolean).join(', ') : '';
    const reason = cancelReasonText(log);
    return {log, names, reason};
  });

  body.innerHTML = rows.map(({log, names, reason}) => `<tr>
      <td style="white-space:nowrap;">${cancelLogTime(log)}</td>
      <td style="font-family:monospace;font-size:12px;">${escHtml(log.orderNo || '')}</td>
      <td>${escHtml(names || '이름 없음')}</td>
      <td><span class="badge b-end">${escHtml(log.cancelStatus || '취소')}</span></td>
      <td style="max-width:260px;white-space:normal;">${escHtml(reason || '-')}</td>
      <td>${Number(log.deletedCount || 0)}건</td>
    </tr>`).join('');

  if(cards) cards.innerHTML = '';
  if(summary){
    const first = rows[0];
    const extra = rows.length > 1 ? ` 외 ${rows.length - 1}건` : '';
    summary.innerHTML = `
      <span><b>${escHtml(first.names || '이름 없음')}${extra}</b></span>
      <span>#${escHtml(first.log.orderNo || '')}</span>
      <span>${Number(first.log.deletedCount || 0)}건 삭제</span>
      <span>${cancelLogTime(first.log)}</span>
      <span>사유: ${escHtml(first.reason || '-')}</span>
    `;
  }
}

async function ackCancelLogs(){
  const unread = (cancelLogs || []).filter(log => !log.acknowledged && log.id);
  if(!unread.length) return;
  try{
    const batch = window.__DB.batch();
    unread.forEach(log => {
      batch.update(window.__DB.collection('imwebCancelLogs').doc(log.id), {
        acknowledged:true,
        acknowledgedAt:new Date().toISOString(),
      });
    });
    await batch.commit();
    toast('취소삭제 알림 확인 완료', 'ok');
  } catch(e){
    toast('알림 확인 처리 오류: ' + e.message, 'er');
  }
}

window.renderCancelLogs = renderCancelLogs;
window.toggleCancelPopover = toggleCancelPopover;
window.closeCancelPopover = closeCancelPopover;
document.addEventListener('click', closeCancelPopover);
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('cancelPopover')?.addEventListener('click', event => event.stopPropagation());
});

function renderDash(){
  const ds=document.getElementById('dashDate').value||todayStr();
  updateDashDisp();
  const tl=listFor(ds);
  let wk=0; for(let i=0;i<7;i++){const t=todayStr();wk+=listFor(addDays(t,i)).length;}
  // 내일 배송 목록
  const tmrStr = addDays(todayStr(), 1);
  const tmrList = listFor(tmrStr);
  const tmrDirectList = tmrList.filter(c=>c.isDirect);
  const tmrCourierList = tmrList.filter(c=>!c.isDirect);
  const customerGroups = customerBuildGroups(custs);
  s('s0',customerGroups.length);
  s('s6',custs.length);
  s('s1',customerGroups.filter(g=>g.orders.some(c=>c.orderType==='sub'&&c.status==='active')).length);
  s('s2',tl.length); s('s3',wk); s('s4',tmrList.length);
  const pausedList = custs.filter(c=>c.status==='pause');
  s('s5', pausedList.length);
  const nextResume = pausedList.map(c=>c.resumeDate).filter(Boolean).sort()[0];
  s('s5sub', nextResume ? `명 · ${shortDate(nextResume)} 재개 예정 있음` : '명 정지 중');
  s('sA',tl.filter(c=>(c.productId||c.set)==='A').length);
  s('sB',tl.filter(c=>(c.productId||c.set)==='B').length);
  s('sC',tl.filter(c=>(c.productId||c.set)==='C').length);
  s('nBadge',listFor(todayStr()).length);

  // 직배송/택배 분리
  const directList  = tl.filter(c=>c.isDirect);
  const courierList = tl.filter(c=>!c.isDirect);

  // 직배송 섹션
  const dDirectWrap  = document.getElementById('dash-direct-wrap');
  const dTodayDirect = document.getElementById('dTodayDirect');
  if(dDirectWrap && dTodayDirect){
    dDirectWrap.style.display = directList.length ? '' : 'none';
    dTodayDirect.innerHTML = directList.map(c=>`<tr>
      <td><strong style="cursor:pointer;color:var(--accent);text-decoration:underline dotted;" onclick="openEdit('${customerJsArg(c.id)}')">${escHtml(c.name)}</strong></td>
      <td><div style="display:flex;gap:4px;flex-wrap:wrap;align-items:center;">${deliveryProductBadgeHtml(c)}${deliveryFirstOrderBadge(c)}${lastBoxDeliveryBadge(c)}</div></td>
      <td><span class="badge ${c.orderType==='once'?'b-once':'b-sub'}">${c.orderType==='once'?'선택':'정기'}</span></td>
      <td>${escHtml(c.phone||'—')}</td>
      <td>${gauge(c)}</td>
    </tr>`).join('');
  }

  // 택배 섹션 라벨
  const courierLabel = document.getElementById('dash-courier-label');
  if(courierLabel) courierLabel.style.display = (directList.length || courierList.length) ? '' : 'none';

  const dt=document.getElementById('dToday');
  dt.innerHTML=!courierList.length
    ? dashEmptyRow(5, '택', '택배 없음')
    : courierList.map(c=>dashDeliveryRow(c)).join('');

  const tmrDirectWrap = document.getElementById('dash-tomorrow-direct-wrap');
  const dTomorrowDirect = document.getElementById('dTomorrowDirect');
  if(tmrDirectWrap && dTomorrowDirect){
    tmrDirectWrap.style.display = tmrDirectList.length ? '' : 'none';
    dTomorrowDirect.innerHTML = tmrDirectList.slice(0,8).map(c=>dashDeliveryRow(c)).join('');
  }
  const tmrCourierLabel = document.getElementById('dash-tomorrow-courier-label');
  if(tmrCourierLabel) tmrCourierLabel.style.display = (tmrDirectList.length || tmrCourierList.length) ? '' : 'none';
  const dl=document.getElementById('dLow');
  dl.innerHTML=!tmrList.length
    ? dashEmptyRow(5, '-', '내일 배송 없음')
    : !tmrCourierList.length
    ? dashEmptyRow(5, '택', '내일 택배 없음')
    : tmrCourierList.slice(0,8).map(c=>dashDeliveryRow(c)).join('');
}

function renderToday(){
  const ds = document.getElementById('todayDate').value || todayStr();
  updateTodayDisp();
  const allList    = listFor(ds);
  const directList = allList.filter(c => c.isDirect);
  const courierList= allList.filter(c => !c.isDirect);

  s('todayCnt', allList.length + '건');

  // 직배송 섹션 표시/숨김
  const dirSec = document.getElementById('today-direct-section');
  if(dirSec) dirSec.style.display = directList.length ? '' : 'none';

  // ── 직배송 필터 적용 ──
  const filteredDirect = filterDeliveryByProduct(directList, '.direct-filter-ck');

  s('direct-cnt', filteredDirect.length + '건');

  // ── 직배송 테이블/카드 ──
  const dtb = document.getElementById('directList');
  if(dtb){
    if(!filteredDirect.length){
      dtb.innerHTML = `<tr><td colspan="11"><div class="empty"><div class="ei empty-mark">직</div><div>직배송 없음</div></div></td></tr>`;
    } else {
      const isMobile = window.innerWidth <= 768;
      if(isMobile){
        // 모바일: 테이블 대신 카드 뷰
        dtb.closest('table').style.minWidth = '0';
        dtb.innerHTML = filteredDirect.map(c => {
          const done = (c.deliveredDates||[]).includes(ds);
          return `<tr class="${done?'trd':''}">
            <td colspan="11" style="padding:0;border:none;">
              <div style="background:var(--surface);border:1px solid rgba(192,32,176,.2);border-radius:10px;margin:4px 0;padding:12px 14px;">
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
                  <div style="display:flex;align-items:center;gap:8px;">
                    <input type="checkbox" class="ck-direct" data-id="${escHtml(c.id)}">
                    <strong style="font-size:15px;cursor:pointer;color:var(--accent);" onclick="openEdit('${customerJsArg(c.id)}')">${escHtml(c.name)}</strong>
                    ${deliveryProductBadgeHtml(c)}${deliveryFirstOrderBadge(c)}${lastBoxDeliveryBadge(c)}
                  </div>
                  ${done
                    ? '<span class="badge b-ok">완료</span>'
                    : `<button class="btn btn-s sm" style="padding:6px 16px;" onclick="markDone('${customerJsArg(c.id)}','${customerJsArg(ds)}')">완료</button>`
                  }
                </div>
                <div style="font-size:12px;color:var(--text2);margin-bottom:4px;">연락처 ${escHtml(c.phone)}</div>
                <div class="delivery-address-card" onclick="showAddrModal('${customerJsArg(c.id)}')"><span class="delivery-address-label">배송지</span>${escHtml(c.addr||'주소 미입력')}</div>
                ${c.door ? `<div style="font-size:12px;color:var(--text3);">현관: ${escHtml(c.door)}</div>` : ''}
                ${c.request ? `<div style="font-size:12px;color:var(--text3);margin-top:2px;">요청: ${escHtml(c.request)}</div>` : ''}
                <div style="font-size:11px;color:var(--text3);margin-top:4px;">${escHtml(scheduleDisp(c))}</div>
                <div style="margin-top:6px;">${gauge(c)}</div>
              </div>
            </td>
          </tr>`;
        }).join('');
      } else {
        dtb.closest('table').style.minWidth = '';
        dtb.innerHTML = filteredDirect.map(c => {
          const done = (c.deliveredDates||[]).includes(ds);
          return `<tr class="${done?'trd':''}">
            <td><input type="checkbox" class="ck-direct" data-id="${escHtml(c.id)}"></td>
            <td><strong style="cursor:pointer;color:var(--accent);text-decoration:underline dotted;" onclick="openEdit('${customerJsArg(c.id)}')">${escHtml(c.name)}</strong></td>
            <td style="white-space:nowrap;">${escHtml(c.phone)}</td>
            <td class="delivery-address-cell" title="${escHtml(c.addr)}" onclick="showAddrModal('${customerJsArg(c.id)}')">${escHtml(c.addr||'주소 미입력')}</td>
            <td><div style="display:flex;gap:4px;flex-wrap:wrap;align-items:center;">${deliveryProductBadgeHtml(c)}${deliveryFirstOrderBadge(c)}${lastBoxDeliveryBadge(c)}</div></td>
            <td style="font-size:11px;color:var(--text3);white-space:nowrap;">${escHtml(scheduleDisp(c)||'—')}</td>
            <td style="font-size:12px;">${escHtml(c.door||'—')}</td>
            <td style="max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;color:var(--text2);" title="${escHtml(c.request||'')}">${escHtml(c.request||'—')}</td>
            <td>${gauge(c)}</td>
            <td>${done?'<span class="badge b-ok">완료</span>':'<span class="badge b-wait">대기</span>'}</td>
            <td>${done?'':` <button class="btn btn-s sm" onclick="markDone('${customerJsArg(c.id)}','${customerJsArg(ds)}')">완료</button>`}</td>
          </tr>`;
        }).join('');
      }
    }
  }

  // ── 택배 필터 체크박스 적용 ──
  const filteredCourier = filterDeliveryByProduct(courierList, '.today-filter-ck');
  s('courier-cnt', filteredCourier.length + '건');
  const logenSummary = document.getElementById('logen-courier-summary');
  if(logenSummary){
    logenSummary.style.display = filteredCourier.length ? '' : 'none';
    logenSummary.innerHTML = (typeof logenCourierSummaryHtml === 'function')
      ? logenCourierSummaryHtml(filteredCourier, ds)
      : '';
  }

  // ── 택배 테이블 ──
  const ctb = document.getElementById('courierList');
  if(ctb){
    ctb.innerHTML = !filteredCourier.length
      ? `<tr><td colspan="15"><div class="empty"><div class="ei empty-mark">택</div><div>${courierList.length ? '필터에 맞는 택배 없음' : '택배 없음'}</div></div></td></tr>`
      : (window.innerWidth <= 768
          ? filteredCourier.map(c => {
              const done = (c.deliveredDates||[]).includes(ds);
              return `<tr class="${done?'trd':''}">
                <td colspan="15" style="padding:0;border:none;">
                  <div style="background:var(--surface);border:1px solid rgba(3,102,214,.15);border-radius:10px;margin:4px 0;padding:12px 14px;">
                    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
                      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                        <input type="checkbox" class="ck-courier" data-id="${escHtml(c.id)}">
                        <strong style="font-size:15px;cursor:pointer;color:var(--accent);" onclick="openEdit('${customerJsArg(c.id)}')">${escHtml(c.name)}</strong>
                        <span class="badge ${productBadgeClass(c.productId||c.set)}">${escHtml(productLabel(c.productId||c.set))}</span>
                        ${deliveryFirstOrderBadge(c)}
                        <span class="badge ${c.orderType==='once'?'b-once':'b-sub'}">${c.orderType==='once'?'선택':'정기'}</span>
                      </div>
                      ${done
                        ? `<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;justify-content:flex-end;">
                            <span class="badge b-ok">완료</span>
                            <button class="btn btn-d sm" style="padding:6px 10px;" onclick="undoMarkDone('${customerJsArg(c.id)}','${customerJsArg(ds)}')">완료취소</button>
                          </div>`
                        : `<button class="btn btn-s sm" style="padding:6px 16px;" onclick="markDone('${customerJsArg(c.id)}','${customerJsArg(ds)}')">완료</button>`
                      }
                    </div>
                    <div style="font-size:12px;color:var(--text2);margin-bottom:4px;">연락처 ${escHtml(c.phone)}</div>
                    <div class="delivery-address-card" onclick="showAddrModal('${customerJsArg(c.id)}')"><span class="delivery-address-label">배송지</span>${escHtml(c.addr||'주소 미입력')}</div>
                    ${c.door ? `<div style="font-size:12px;color:var(--text3);">현관: ${escHtml(c.door)}</div>` : ''}
                    ${c.request ? `<div style="font-size:12px;color:var(--text3);margin-top:2px;">요청: ${escHtml(c.request)}</div>` : ''}
                    <div style="display:flex;align-items:center;justify-content:space-between;margin-top:6px;">
                      <div style="font-size:11px;color:var(--text3);">${escHtml(c.scheduleName||'')}</div>
                      <div>${gauge(c)}</div>
                    </div>
                    <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:8px;">
                      ${typeof logenStatusBadgeHtml==='function'?logenStatusBadgeHtml(c, ds):''}
                      ${typeof logenSlipNoHtml==='function'?logenSlipNoHtml(c, ds):''}
                    </div>
                    ${typeof logenActionHtml==='function'
                      ? `<div style="margin-top:8px;">${logenActionHtml(c, ds)}</div>`
                      : ''
                    }
                  </div>
                </td>
              </tr>`;
            }).join('')
          : filteredCourier.map(c => {
              const done = (c.deliveredDates||[]).includes(ds);
              return `<tr class="${done?'trd':''}">
                <td><input type="checkbox" class="ck-courier" data-id="${escHtml(c.id)}"></td>
                <td><strong style="cursor:pointer;color:var(--accent);text-decoration:underline dotted;" onclick="openEdit('${customerJsArg(c.id)}')">${escHtml(c.name)}</strong></td>
                <td style="white-space:nowrap;">${escHtml(c.phone)}</td>
                <td class="delivery-address-cell" title="${escHtml(c.addr)}" onclick="showAddrModal('${customerJsArg(c.id)}')">${escHtml(c.addr||'주소 미입력')}</td>
                <td><div style="display:flex;gap:4px;flex-wrap:wrap;align-items:center;"><span class="badge ${productBadgeClass(c.productId||c.set)}">${escHtml(productLabel(c.productId||c.set))}</span>${deliveryFirstOrderBadge(c)}</div></td>
                <td><span class="badge ${c.orderType==='once'?'b-once':'b-sub'}">${c.orderType==='once'?'선택':'정기'}</span></td>
                <td style="font-size:11px;color:var(--text3);white-space:nowrap;">${escHtml(c.scheduleName||'')}</td>
                <td style="font-size:12px;">${escHtml(c.door||'—')}</td>
                <td style="max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;color:var(--text2);" title="${escHtml(c.request||'')}">${escHtml(c.request||'—')}</td>
                <td style="font-size:12px;font-weight:700;">${c.qty || c.total || 1}</td>
                <td>${gauge(c)}</td>
                <td>${typeof logenStatusBadgeHtml==='function'?logenStatusBadgeHtml(c, ds):'—'}</td>
                <td>${typeof logenSlipNoHtml==='function'?logenSlipNoHtml(c, ds):'—'}</td>
                <td>${done?'<span class="badge b-ok">완료</span>':'<span class="badge b-wait">대기</span>'}</td>
                <td>
                  <div style="display:flex;gap:4px;flex-wrap:wrap;justify-content:center;">
                    ${done
                      ? `<button class="btn btn-d sm" onclick="undoMarkDone('${customerJsArg(c.id)}','${customerJsArg(ds)}')">완료취소</button>`
                      : `<button class="btn btn-s sm" onclick="markDone('${customerJsArg(c.id)}','${customerJsArg(ds)}')">완료</button>`}
                    ${typeof logenActionHtml==='function'?logenActionHtml(c, ds):''}
                  </div>
                </td>
              </tr>`;
            }).join('')
        );
  }
}

// 택배 목록 인쇄
function printCourierList(){
  const ds = document.getElementById('todayDate').value || todayStr();
  const list = listFor(ds).filter(c=>!c.isDirect);
  const filtered = filterDeliveryByProduct(list, '.today-filter-ck');
  if(!filtered.length){ toast('출력할 내용 없음','er'); return; }

  const rows = filtered.map((c,i)=>`
    <tr>
      <td>${i+1}</td>
      <td><strong>${escHtml(c.name)}</strong></td>
      <td>${escHtml(c.phone)}</td>
      <td>${escHtml(c.addr||'')}</td>
      <td>${escHtml(c.door||'')}</td>
      <td>${escHtml(productLabel(c.productId||c.set))}</td>
      <td>${escHtml(scheduleDisp(c))}</td>
      <td>${escHtml(c.request||'')}</td>
    </tr>`).join('');

  const win = window.open('','_blank');
  win.document.write(`
    <html><head><title>배송목록 ${ds}</title>
    <style>
      body{font-family:sans-serif;font-size:12px;padding:20px;}
      h2{margin-bottom:12px;}
      table{border-collapse:collapse;width:100%;}
      th,td{border:1px solid #ccc;padding:6px 8px;text-align:left;}
      th{background:#f0f0f0;font-weight:700;}
      @media print{button{display:none;}}
    </style></head>
    <body>
    <h2>택배 배송목록 · ${ds}</h2>
    <button onclick="window.print()" style="margin-bottom:12px;padding:6px 16px;background:#1a6b3c;color:#fff;border:none;border-radius:6px;cursor:pointer;">🖨 인쇄</button>
    <table>
      <thead><tr><th>#</th><th>이름</th><th>연락처</th><th>주소</th><th>현관번호</th><th>세트</th><th>배송일정</th><th>요청사항</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    </body></html>`);
  win.document.close();
}

// 직배송 목록 인쇄
function printDirectList(){
  const ds = document.getElementById('todayDate').value || todayStr();
  const list = listFor(ds).filter(c=>c.isDirect);
  const filtered = filterDeliveryByProduct(list, '.direct-filter-ck');
  if(!filtered.length){ toast('출력할 내용 없음','er'); return; }

  const rows = filtered.map((c,i)=>`
    <tr>
      <td>${i+1}</td>
      <td><strong>${escHtml(c.name)}</strong></td>
      <td>${escHtml(c.phone)}</td>
      <td>${escHtml(c.addr||'')}</td>
      <td>${escHtml(c.door||'')}</td>
      <td>${escHtml(productLabel(c.productId||c.set))}</td>
      <td>${escHtml(scheduleDisp(c))}</td>
      <td>${escHtml(c.request||'')}</td>
    </tr>`).join('');

  const win = window.open('','_blank');
  win.document.write(`
    <html><head><title>직배송목록 ${ds}</title>
    <style>
      body{font-family:sans-serif;font-size:12px;padding:20px;}
      h2{margin-bottom:12px;}
      table{border-collapse:collapse;width:100%;}
      th,td{border:1px solid #ccc;padding:6px 8px;text-align:left;}
      th{background:#f0f0f0;font-weight:700;}
      @media print{button{display:none;}}
    </style></head>
    <body>
    <h2>🚗 직배송 목록 · ${ds}</h2>
    <button onclick="window.print()" style="margin-bottom:12px;padding:6px 16px;background:#c020b0;color:#fff;border:none;border-radius:6px;cursor:pointer;">🖨 인쇄</button>
    <table>
      <thead><tr><th>#</th><th>이름</th><th>연락처</th><th>주소</th><th>현관번호</th><th>세트</th><th>배송일정</th><th>요청사항</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    </body></html>`);
  win.document.close();
}

// 직배송 전체 완료
function filteredDirectPrintList(ds){
  const list = listFor(ds).filter(c=>c.isDirect);
  return filterDeliveryByProduct(list, '.direct-filter-ck');
}

function filteredCourierPrintList(ds){
  const list = listFor(ds).filter(c=>!c.isDirect);
  return filterDeliveryByProduct(list, '.today-filter-ck');
}

function deliveryPrintRows(list){
  return list.map((c,i)=>`
    <tr>
      <td>${i+1}</td>
      <td><strong>${escHtml(c.name)}</strong></td>
      <td>${escHtml(c.phone||'')}</td>
      <td>${escHtml(c.addr||'')}</td>
      <td>${escHtml(c.door||'')}</td>
      <td>${escHtml(productLabel(c.productId||c.set))}</td>
      <td>${c.orderType==='once'?'선택':'정기'}</td>
      <td>${escHtml(scheduleDisp(c))}</td>
      <td>${escHtml(c.request||'')}</td>
    </tr>`).join('');
}

function deliveryPrintSection(title, list){
  const empty = `<tr><td colspan="9" style="text-align:center;color:#777;padding:14px;">없음</td></tr>`;
  return `
    <h3>${title} (${list.length}건)</h3>
    <table>
      <thead><tr><th>#</th><th>이름</th><th>연락처</th><th>주소</th><th>현관번호</th><th>상품</th><th>유형</th><th>배송일정</th><th>요청사항</th></tr></thead>
      <tbody>${list.length ? deliveryPrintRows(list) : empty}</tbody>
    </table>`;
}

function printAllDeliveryList(){
  const ds = document.getElementById('todayDate').value || todayStr();
  const directList = filteredDirectPrintList(ds);
  const courierList = filteredCourierPrintList(ds);
  if(!directList.length && !courierList.length){ toast('출력할 내용 없음','er'); return; }

  const win = window.open('','_blank');
  win.document.write(`
    <html><head><title>배송목록 ${ds}</title>
    <style>
      body{font-family:sans-serif;font-size:12px;padding:20px;color:#111;}
      h2{margin:0 0 6px;}
      .meta{margin-bottom:16px;color:#555;}
      h3{margin:20px 0 8px;font-size:15px;}
      table{border-collapse:collapse;width:100%;margin-bottom:18px;page-break-inside:auto;}
      th,td{border:1px solid #ccc;padding:6px 8px;text-align:left;vertical-align:top;}
      th{background:#f0f0f0;font-weight:700;}
      tr{page-break-inside:avoid;page-break-after:auto;}
      @media print{button{display:none;} h3{page-break-after:avoid;}}
    </style></head>
    <body>
    <h2>배송목록 · ${ds}</h2>
    <div class="meta">직배송 ${directList.length}건 / 택배 ${courierList.length}건 / 총 ${directList.length + courierList.length}건</div>
    <button onclick="window.print()" style="margin-bottom:12px;padding:6px 16px;background:#1a6b3c;color:#fff;border:none;border-radius:6px;cursor:pointer;">인쇄</button>
    ${deliveryPrintSection('직배송', directList)}
    ${deliveryPrintSection('택배', courierList)}
    </body></html>`);
  win.document.close();
}

async function markAllDirect(){
  const ds = document.getElementById('todayDate').value || todayStr();
  const list = listFor(ds).filter(c=>c.isDirect);
  if(!list.length){ toast('직배송 없음','er'); return; }
  if(!confirm(list.length+'건 직배송 전체 완료?')) return;
  await Promise.all(list.map(c=>runDeliveryTransaction(window.__DB,c.id,ds,'complete')));
  toast('직배송 전체 완료!','ok');
}

// 택배 전체 완료
async function markAllCourier(){
  const ds = document.getElementById('todayDate').value || todayStr();
  const list = listFor(ds).filter(c=>!c.isDirect);
  if(!list.length){ toast('택배 없음','er'); return; }
  if(!confirm(list.length+'건 택배 전체 완료?')) return;
  await Promise.all(list.map(c=>runDeliveryTransaction(window.__DB,c.id,ds,'complete')));
  toast('택배 전체 완료!','ok');
}

function toggleDirect(el){ document.querySelectorAll('.ck-direct').forEach(c=>c.checked=el.checked); }
function toggleCourier(el){ document.querySelectorAll('.ck-courier').forEach(c=>c.checked=el.checked); }

function renderCust(){
  const q=(document.getElementById('srchQ')?.value||'').toLowerCase();
  const fs=document.getElementById('srchSet')?.value||'';
  const ft=document.getElementById('srchType')?.value||'';
  const fst=document.getElementById('srchSt')?.value||'';
  const fd=document.getElementById('srchDirect')?.value||'';
  const fr=document.getElementById('srchRemain')?.value||'';
  const list=custs.filter(c=>{
    if(q&&!c.name.includes(q)&&!c.phone.includes(q)&&!(c.addr||'').includes(q)&&!(c.orderNum||'').includes(q)) return false;
    if(fs&&(c.productId||c.set)!==fs) return false;
    if(ft&&c.orderType!==ft) return false;
    if(fst&&c.status!==fst) return false;
    if(fd&&(fd==='1'?!c.isDirect:c.isDirect)) return false;
    if(fr==='remain'&&!(c.remain>0)) return false;
    if(fr==='done'&&c.remain>0) return false;
    return true;
  });

  // 정렬
  const sortBy = document.getElementById('srchSort')?.value || 'recent';
  list.sort(function(a,b){
    if(sortBy==='name')   return (a.name||'').localeCompare(b.name||'','ko');
    if(sortBy==='remain') return (b.remain||0)-(a.remain||0);
    // recent: createdAt 내림차순
    return (b.createdAt||'').localeCompare(a.createdAt||'');
  });
  const tb=document.getElementById('custList');
  if(!list.length){
    tb.innerHTML=`<tr><td colspan="8"><div class="empty"><div class="ei">👤</div><div>검색 결과 없음</div></div></td></tr>`;
    return;
  }
  if(window.innerWidth <= 768){
    // 모바일: 카드형 리스트
    tb.closest('table').style.minWidth = '0';
    tb.innerHTML = list.map(c=>`<tr>
      <td colspan="9" style="padding:0;border:none;">
        <div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;margin:4px 0;padding:12px 14px;cursor:pointer;"
             onclick="openEdit('${customerJsArg(c.id)}')">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
            <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
              <strong style="font-size:14px;">${customerText(c.name)}</strong>
              <span class="badge ${productBadgeClass(c.productId||c.set)}">${customerText(productLabel(c.productId||c.set))}</span>
              <span class="badge ${c.orderType==='once'?'b-once':'b-sub'}">${c.orderType==='once'?'선택':'정기'}</span>
              ${c.isDirect?'<span class="badge b-direct">직배</span>':''}
            </div>
            <span class="badge b-${c.status}">${statusLabel(c)}</span>
          </div>
          <div style="font-size:12px;color:var(--text2);margin-bottom:3px;">연락처 ${customerText(c.phone)}</div>
          <div style="font-size:11px;color:var(--text3);margin-bottom:6px;">${customerText(scheduleDisp(c))}</div>
          <div style="display:flex;align-items:center;justify-content:space-between;">
            <div>${gauge(c)}</div>
            <div style="display:flex;gap:6px;" onclick="event.stopPropagation()">
              ${c.orderType==='sub'?`<button class="btn sm" style="background:rgba(3,102,214,.1);color:#0366d6;border:1px solid rgba(3,102,214,.3);font-size:11px;" onclick="chargeRemain('${customerJsArg(c.id)}')">충전</button>`:''}
              <button class="btn btn-d sm" style="font-size:11px;" onclick="quickDelete('${customerJsArg(c.id)}','${customerJsArg(c.name)}')">삭제</button>
            </div>
          </div>
        </div>
      </td>
    </tr>`).join('');
  } else {
    tb.closest('table').style.minWidth = '';
    tb.innerHTML=list.map(c=>`<tr class="trc" onclick="showDet('${customerJsArg(c.id)}')">
      <td>
        <strong>${customerText(c.name)}</strong>
        ${c.orderNum?`<div style="font-size:10px;color:var(--text3);margin-top:2px;">#${customerText(c.orderNum)}</div>`:''}
      </td>
      <td style="white-space:nowrap;">${customerText(c.phone)}</td>
      <td><span class="badge ${productBadgeClass(c.productId||c.set)}">${customerText(productLabel(c.productId||c.set))}</span></td>
      <td><span class="badge ${c.orderType==='once'?'b-once':'b-sub'}">${c.orderType==='once'?'선택':'정기'}</span></td>
      <td style="font-size:11px;color:var(--text3);max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${customerText(scheduleDisp(c))}</td>
      <td>${c.isDirect?'<span class="badge b-direct">직배송</span>':'<span style="font-size:11px;color:var(--text3);">택배</span>'}</td>
      <td>${gauge(c)}</td>
      <td><span class="badge b-${c.status}">${statusLabel(c)}</span></td>
      <td style="display:flex;gap:4px;flex-wrap:wrap;">
        <button class="btn btn-g sm" onclick="event.stopPropagation();openEdit('${customerJsArg(c.id)}')">수정</button>
        ${c.orderType==='sub'?`<button class="btn sm" style="background:rgba(3,102,214,.1);color:#0366d6;border:1px solid rgba(3,102,214,.3);" onclick="event.stopPropagation();chargeRemain('${customerJsArg(c.id)}')">충전</button>`:''}
        <button class="btn btn-d sm" onclick="event.stopPropagation();quickDelete('${customerJsArg(c.id)}','${customerJsArg(c.name)}')">삭제</button>
      </td>
    </tr>`).join('');
  }
}

// 선택주문 배송일 변경
async function editOnceDate(id, currentDate){
  const c=custs.find(x=>x.id===id); if(!c) return;
  const newDate=prompt(`${c.name}의 배송 예정일을 변경합니다.
현재: ${currentDate||'미설정'}

새 날짜를 입력하세요 (YYYY-MM-DD):`, currentDate||todayStr());
  if(!newDate) return;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(newDate)){ toast('날짜 형식이 올바르지 않습니다 (YYYY-MM-DD)','er'); return; }
  try{
    const prod = customerProductKey(c);
    const qty = parseInt(c.qty || c.total || 1) || 1;
    const updateData = {
      onceDate:newDate,
      startDate:newDate,
      needsReview:false,
      reviewReason:''
    };
    const oldLogen = c.logenShipments && c.logenShipments[currentDate];
    if(oldLogen && ['logen_registered','slip_pending','slip_ready','printed'].includes(oldLogen.status || '')){
      updateData[`logenShipments.${currentDate}.changeNeeded`] = true;
      updateData[`logenShipments.${currentDate}.changeReason`] = '배송일 변경';
      updateData[`logenShipments.${currentDate}.changedAt`] = new Date().toISOString();
    }
    if(prod){
      updateData.scheduleName = productLabel(prod) + (qty > 1 ? ' x' + qty + '개' : '');
    }
    await window.__DB.collection('customers').doc(id).update(updateData);
    toast(`${c.name} 배송일 → ${newDate} 변경 완료`,'ok');
  } catch(e){ toast('오류: '+e.message,'er'); }
}

function showDet(id){
  const c=custs.find(x=>x.id===id); if(!c) return;
  document.querySelectorAll('.trc').forEach(r=>r.classList.remove('sel'));
  event.currentTarget.classList.add('sel');
  const pct=c.total>0?Math.min(100,c.remain/c.total*100):0, isLow=c.remain<=3;
  document.getElementById('custDetail').innerHTML=`
    <div class="dp">
      <div class="dph">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
          <div style="font-size:16px;font-weight:700;">${customerText(c.name)}</div>
          <span class="badge b-${c.status}">${statusLabel(c)}</span>
        </div>
        <div style="display:flex;gap:6px;">
          <span class="badge ${productBadgeClass(c.productId||c.set)}">${customerText(productLabel(c.productId||c.set))}</span>
          <span class="badge ${c.orderType==='once'?'b-once':'b-sub'}">${c.orderType==='once'?'선택주문':'정기배송'}</span>
        </div>
      </div>
      <div class="dpb">
        <div class="dpr"><div class="dpl">연락처</div><div class="dpv">${customerText(c.phone)}</div></div>
        <div class="dpr"><div class="dpl">배송지</div><div class="dpv" style="font-size:12px;">${customerText(c.addr)}</div></div>
        <div class="dpr"><div class="dpl">현관번호</div><div class="dpv">${customerText(c.door||'—')}</div></div>
        <div class="dpr"><div class="dpl">요청사항</div><div class="dpv" style="font-size:12px;">${customerText(c.request||'—')}</div></div>
        <div class="dpr"><div class="dpl">배송일정</div><div class="dpv" style="font-size:12px;">${customerText(c.scheduleName||'—')}</div></div>
        <div class="dpr"><div class="dpl">배송 방식</div><div class="dpv">${c.isDirect?'<span class="badge b-direct">직배송</span>':'<span style="font-size:12px;">택배</span>'}</div></div>
        ${c.orderNum?`<div class="dpr"><div class="dpl">주문번호</div><div class="dpv" style="font-size:12px;font-family:monospace;">${customerText(c.orderNum)}</div></div>`:''}
        ${c.qty&&c.qty>1?`<div class="dpr"><div class="dpl">수량</div><div class="dpv" style="font-weight:700;color:var(--accent);">${c.qty}개</div></div>`:''}
        ${c.onceDate?`<div class="dpr"><div class="dpl">배송예정일</div><div class="dpv">${customerText(c.onceDate)}</div></div>`:''}
        ${c.orderType==='sub'?`
        <div class="dpr">
          <div class="dpl">잔여 횟수</div>
          <div style="margin-top:4px;">
            <div style="font-size:22px;font-weight:700;color:${isLow?'var(--danger)':'var(--accent)'};margin-bottom:6px;">${c.remain}<span style="font-size:13px;font-weight:400;color:var(--text3);"> / ${c.total}회</span></div>
            <div class="gt" style="height:6px;"><div class="gf ${isLow?'low':''}" style="width:${pct}%"></div></div>
          </div>
        </div>`:''}
        ${c.memo?`<div class="dpr"><div class="dpl">메모</div><div class="dpv" style="font-size:12px;background:var(--bg3);padding:8px;border-radius:4px;">${customerText(c.memo)}</div></div>`:''}
        <div class="dpr">
          <div class="dpl">배송 이력 <span style="font-size:9px;color:var(--text3);">(클릭 → 취소)</span></div>
          <div style="margin-top:4px;">
            ${(c.deliveredDates||[]).slice(-5).reverse().map(d=>`
              <div class="dhi" style="display:flex;align-items:center;justify-content:space-between;">
                <span>${customerText(d)}</span>
                <button onclick="undoMarkDone('${customerJsArg(c.id)}','${customerJsArg(d)}')" style="border:none;background:none;color:var(--danger);cursor:pointer;font-size:11px;padding:0 2px;" title="취소">↩</button>
              </div>`).join('')||'<div style="font-size:12px;color:var(--text3);">이력 없음</div>'}
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:8px;">
          <button class="btn btn-p" style="font-size:12px;" onclick="openEdit('${customerJsArg(c.id)}')">✏ 수정</button>
          <button class="btn btn-s" style="font-size:12px;" onclick="markDone('${customerJsArg(c.id)}')">배송완료</button>
          <button class="btn btn-g" style="font-size:12px;grid-column:1/-1;" onclick="copyLozen('${customerJsArg(c.id)}')">로젠택배 복사</button>
          ${c.orderType==='sub'?`
          <button class="btn btn-g" style="font-size:12px;" onclick="togglePause('${customerJsArg(c.id)}')">${c.status==='pause'?'▶ 재개':'⏸ 일시정지'}</button>
          <button class="btn" style="font-size:12px;background:rgba(3,102,214,.1);color:#0366d6;border-color:rgba(3,102,214,.3);" onclick="chargeRemain('${customerJsArg(c.id)}')">＋ 횟수 충전</button>
          `:`
          <button class="btn btn-g" style="font-size:12px;grid-column:1/-1;" onclick="editOnceDate('${customerJsArg(c.id)}','${customerJsArg(c.onceDate||'')}')">📅 배송일 변경</button>
          `}
          <button class="btn btn-d" style="font-size:12px;grid-column:1/-1;" onclick="quickDelete('${customerJsArg(c.id)}','${customerJsArg(c.name)}')">🗑 삭제</button>
        </div>
      </div>
    </div>`;
}

// Grouped customer management view.
// Firestore keeps one document per order, but the customer tab renders one row per name + normalized phone.
let __customerGroups = [];
let __selectedCustomerGroupKey = '';
let __expandedCustomerOrderId = '';
const CUSTOMER_PAGE_SIZE = 30;
let __customerQuickFilter = 'all';
let __customerVisibleLimit = CUSTOMER_PAGE_SIZE;
let __customerFilterSignature = '';

function customerGroupKey(c){
  const name = String(c?.name || '').trim();
  const phone = customerPhoneDigits(c?.phone);
  return `${name}|${phone || c?.id || ''}`;
}

function customerOrderTime(c){
  const raw = c?.createdAt || c?.updatedAt || '';
  const time = raw ? new Date(raw).getTime() : 0;
  if(time && !Number.isNaN(time)) return time;

  const orderNo = String(c?.orderNum || c?.syncKey || '');
  const m = orderNo.match(/^(\d{4})(\d{2})(\d{2})/);
  if(m){
    const byOrderNo = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00+09:00`).getTime();
    if(byOrderNo && !Number.isNaN(byOrderNo)) return byOrderNo;
  }
  return 0;
}

function customerSortOrders(orders){
  return (orders || []).slice().sort((a,b)=>{
    const byTime = customerOrderTime(b) - customerOrderTime(a);
    if(byTime) return byTime;
    return String(b.orderNum || b.syncKey || '').localeCompare(String(a.orderNum || a.syncKey || ''));
  });
}

function customerOrderDate(c){
  const savedOrderDate = typeof customerOrderDateInputValue === 'function'
    ? customerOrderDateInputValue(c)
    : '';
  if(savedOrderDate) return savedOrderDate;

  const raw = c?.createdAt || c?.updatedAt || '';
  const dt = raw ? new Date(raw) : null;
  if(dt && !Number.isNaN(dt.getTime())){
    return dt.getFullYear() + '-' + String(dt.getMonth()+1).padStart(2,'0') + '-' + String(dt.getDate()).padStart(2,'0');
  }

  const orderNo = String(c?.orderNum || c?.syncKey || '');
  const m = orderNo.match(/^(\d{4})(\d{2})(\d{2})/);
  if(m) return `${m[1]}-${m[2]}-${m[3]}`;
  return c?.onceDate || c?.startDate || '-';
}

const CUSTOMER_NEW_BADGE_MS = 24 * 60 * 60 * 1000;

function customerCreatedTime(c){
  return customerTimestampMs(c?.createdAt) || customerTimestampMs(c?.updatedAt);
}

function customerIsNewOrder(c){
  const created = customerCreatedTime(c);
  if(!created) return false;
  const age = Date.now() - created;
  return age >= 0 && age <= CUSTOMER_NEW_BADGE_MS;
}

function customerOrderNewBadge(c){
  return customerIsNewOrder(c) ? customerNewBadgeHtml() : '';
}

function customerGroupNewBadge(g){
  return (g?.orders || []).some(customerIsNewOrder) ? customerNewBadgeHtml() : '';
}

function customerOrderFirstBadge(c){
  return customerIsFirstOrder(c) ? firstOrderBadgeHtml() : '';
}

function customerGroupFirstBadge(g){
  return (g?.orders || []).some(customerIsFirstOrder) ? firstOrderBadgeHtml() : '';
}

const RISK_ORDER_DISMISS_KEY = 'gjs-risk-order-dismissed-v1';
let __riskOrderAlertOpen = false;
let __riskOrderSessionHidden = new Set();

function riskOrderStorageList(){
  try{
    const raw = localStorage.getItem(RISK_ORDER_DISMISS_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter(Boolean) : [];
  }catch(e){
    return [];
  }
}

function riskOrderSaveStorage(list){
  try{
    localStorage.setItem(RISK_ORDER_DISMISS_KEY, JSON.stringify(Array.from(new Set(list)).slice(-500)));
  }catch(e){}
}

function riskOrderKey(c){
  return String(c?.orderNum || c?.syncKey || c?.id || '').trim();
}

function riskOrderDateValid(dateStr){
  if(!dateStr) return false;
  const m = String(dateStr).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if(!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(y, mo - 1, d);
  return dt.getFullYear() === y && dt.getMonth() + 1 === mo && dt.getDate() === d;
}

function customerRiskReasons(c){
  const reasons = [];
  const schedule = String(c?.scheduleName || '');
  if(c?.needsReview) reasons.push(c.reviewReason || '주문 확인 필요');
  if(/확인\s*필요|미확인|확인필요/.test(schedule)) reasons.push(schedule || '배송일정 확인 필요');
  if(c?.orderType === 'once' && c?.status !== 'end'){
    if(!c.onceDate && !c.startDate) reasons.push('선택주문 배송일 없음');
    const ds = c.onceDate || c.startDate || '';
    if(ds && !riskOrderDateValid(ds)) reasons.push('배송일 날짜 형식 오류');
    if(c.isDirect && ds && riskOrderDateValid(ds) && customerOrderDate(c) === ds){
      reasons.push('직배송 주문일과 배송일이 같습니다');
    }
  }
  if(!customerProductKey(c)) reasons.push('상품/세트 확인 필요');
  return customerUniqueBy(reasons.map(reason => ({ reason })), item => item.reason).map(item => item.reason);
}

function customerIsRiskOrder(c){
  return customerRiskReasons(c).length > 0;
}

function customerRiskBadge(c){
  return customerIsRiskOrder(c)
    ? '<span class="badge" title="확인이 필요한 주문" style="background:#fff1f2;color:#be123c;border-color:#fecdd3;font-weight:900;">확인 필요</span>'
    : '';
}

function customerGroupRiskBadge(g){
  return (g?.orders || []).some(customerIsRiskOrder)
    ? '<span class="badge" title="확인이 필요한 주문 포함" style="background:#fff1f2;color:#be123c;border-color:#fecdd3;font-weight:900;">확인 필요</span>'
    : '';
}

function riskOrdersForAlert(){
  const dismissed = new Set(riskOrderStorageList());
  return customerSortOrders((custs || []).filter(c => {
    const key = riskOrderKey(c);
    return customerIsRiskOrder(c) && key && !dismissed.has(key) && !__riskOrderSessionHidden.has(key);
  })).slice(0, 12);
}

function ensureRiskOrderAlertShell(){
  let shell = document.getElementById('riskOrderAlert');
  if(shell) return shell;
  shell = document.createElement('div');
  shell.id = 'riskOrderAlert';
  shell.className = 'mbg';
  shell.innerHTML = `
    <div class="modal" style="width:min(680px,calc(100vw - 28px));">
      <div class="mh">
        <div class="mt">확인이 필요한 고객 주문</div>
        <div class="mx" onclick="closeRiskOrderAlert(false)">×</div>
      </div>
      <div class="mb">
        <div class="ibox" style="margin-bottom:12px;border-color:#fecdd3;background:#fff1f2;color:#881337;">
          배송일정이나 상품 정보가 이상하게 들어온 주문입니다. 고객에게 확인이 필요하면 행을 눌러 고객관리 상세로 이동하세요.
        </div>
        <div id="riskOrderList" style="display:flex;flex-direction:column;gap:8px;"></div>
      </div>
      <div class="mf">
        <button class="btn btn-g" onclick="closeRiskOrderAlert(false)">나중에 확인</button>
        <button class="btn btn-p" onclick="closeRiskOrderAlert(true)">체크한 주문 다시 안 보기</button>
      </div>
    </div>`;
  document.body.appendChild(shell);
  return shell;
}

function checkRiskOrderAlert(){
  if(__riskOrderAlertOpen) return;
  const risks = riskOrdersForAlert();
  if(!risks.length) return;
  const shell = ensureRiskOrderAlertShell();
  const list = document.getElementById('riskOrderList');
  if(!list) return;
  list.innerHTML = risks.map(c => {
    const key = riskOrderKey(c);
    const reasons = customerRiskReasons(c).join(' / ');
    const schedule = scheduleDisp(c) || c.scheduleName || c.onceDate || '-';
    const orderNo = c.orderNum || c.syncKey || '';
    return `
      <div class="risk-order-row" data-risk-key="${customerText(key)}" onclick="focusRiskOrder('${customerJsArg(c.id)}')" style="border:1px solid #fecdd3;border-radius:10px;background:#fff;padding:12px;cursor:pointer;">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;">
          <div style="min-width:0;">
            <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-weight:900;color:#111827;">
              ${customerText(c.name || '-')}
              ${customerRiskBadge(c)}
              ${customerOrderNewBadge(c)}
              ${customerOrderFirstBadge(c)}
            </div>
            <div style="font-size:12px;color:#6b7280;margin-top:4px;">${orderNo ? '#' + customerText(orderNo) + ' · ' : ''}${customerText(c.phone || '-')}</div>
          </div>
          <label onclick="event.stopPropagation()" style="display:flex;align-items:center;gap:5px;font-size:12px;color:#6b7280;white-space:nowrap;">
            <input type="checkbox" class="risk-order-dismiss" value="${customerText(key)}"> 다시 안 보기
          </label>
        </div>
        <div style="display:grid;grid-template-columns:76px 1fr;gap:5px 8px;font-size:12px;margin-top:10px;">
          <div style="color:#9ca3af;">배송일정</div><div>${customerText(schedule)}</div>
          <div style="color:#9ca3af;">사유</div><div style="color:#be123c;font-weight:700;">${customerText(reasons || '확인 필요')}</div>
          <div style="color:#9ca3af;">주소</div><div>${customerText(c.addr || '-')}</div>
        </div>
      </div>`;
  }).join('');
  shell.classList.add('on');
  __riskOrderAlertOpen = true;
}

function closeRiskOrderAlert(saveChecked){
  const shell = document.getElementById('riskOrderAlert');
  const visibleKeys = Array.from(document.querySelectorAll('#riskOrderAlert .risk-order-row'))
    .map(row => row.dataset.riskKey)
    .filter(Boolean);
  const checked = Array.from(document.querySelectorAll('#riskOrderAlert .risk-order-dismiss:checked'))
    .map(el => el.value)
    .filter(Boolean);
  visibleKeys.forEach(key => __riskOrderSessionHidden.add(key));
  if(saveChecked && checked.length){
    riskOrderSaveStorage(riskOrderStorageList().concat(checked));
    toast(`${checked.length}건은 이 기기에서 다시 알리지 않습니다`, 'ok');
  }
  if(shell) shell.classList.remove('on');
  __riskOrderAlertOpen = false;
}

function clearCustomerFilters(){
  ['srchQ','srchSet','srchType','srchSt','srchDirect','srchRemain'].forEach(id => {
    const el = document.getElementById(id);
    if(el) el.value = '';
  });
  const sort = document.getElementById('srchSort');
  if(sort) sort.value = 'recent';
  __customerQuickFilter = 'all';
  __customerVisibleLimit = CUSTOMER_PAGE_SIZE;
}

function resetCustomerFilters(){
  clearCustomerFilters();
  renderCust();
}

function setCustomerQuickFilter(mode){
  __customerQuickFilter = mode || 'all';
  __customerVisibleLimit = CUSTOMER_PAGE_SIZE;
  renderCust();
}

function showMoreCustomers(){
  __customerVisibleLimit += CUSTOMER_PAGE_SIZE;
  renderCust();
}

async function customerCopyText(value, label){
  const text = String(value || '').trim();
  if(!text || text === '-'){
    toast(`${label || '정보'}가 없습니다`, 'info');
    return;
  }
  try{
    await navigator.clipboard.writeText(text);
    toast(`${label || '정보'} 복사 완료`, 'ok');
  }catch(e){
    toast('복사하지 못했습니다', 'er');
  }
}

function closeCustomerDetail(){
  document.getElementById('custDetail')?.classList.remove('is-open');
  document.getElementById('custDetailBackdrop')?.classList.remove('is-open');
  document.body.classList.remove('customer-detail-open');
}

function focusRiskOrder(orderId){
  closeRiskOrderAlert(false);
  clearCustomerFilters();
  goTab('customers');
  __expandedCustomerOrderId = orderId;
  const idx = (__customerGroups || []).findIndex(g => (g.orders || []).some(c => c.id === orderId));
  if(idx === -1){
    toast('고객 목록에서 해당 주문을 찾지 못했습니다', 'er');
    return;
  }
  const group = __customerGroups[idx];
  __selectedCustomerGroupKey = group.key;
  showCustomerGroup(idx, true);
  setTimeout(() => {
    const row = document.querySelector(`.trc[data-group-idx="${idx}"]`);
    row?.scrollIntoView({ behavior:'smooth', block:'center' });
  }, 60);
}

function customerIsActiveOrder(c){
  return c && c.status === 'active' && Number(c.remain || 0) > 0;
}

function customerGroupStatus(g){
  const orders = g.orders || [];
  if(orders.some(c => c.orderType === 'sub' && customerIsActiveOrder(c))){
    return {label:'구독중', cls:'active'};
  }
  if(orders.some(c => c.orderType !== 'sub' && customerIsActiveOrder(c))){
    return {label:'진행중', cls:'active'};
  }
  if(orders.some(c => c.status === 'pause')){
    return {label:'보류', cls:'pause'};
  }
  return {label:'-', cls:'end'};
}

function customerUniqueBy(items, keyFn){
  const out = [];
  const seen = new Set();
  items.forEach(item => {
    const key = keyFn(item);
    if(!key || seen.has(key)) return;
    seen.add(key);
    out.push(item);
  });
  return out;
}

function customerProductChips(g){
  const active = g.orders.filter(customerIsActiveOrder);
  const source = active.length ? active : g.orders.slice(0, 1);
  const products = customerUniqueBy(source, customerProductKey);
  if(!products.length) return '-';
  return products.map(c => {
    const prod = customerProductKey(c);
    return `<span class="badge ${productBadgeClass(prod)}">${customerText(productLabel(prod))}</span>`;
  }).join(' ');
}

function customerTypeChips(g){
  const source = g.orders.filter(customerIsActiveOrder);
  const orders = source.length ? source : g.orders;
  const types = customerUniqueBy(orders, customerOrderTypeLabel);
  return types.map(c => `<span class="badge ${customerOrderTypeBadge(c)}">${customerText(customerOrderTypeLabel(c))}</span>`).join(' ');
}

function customerDeliveryChips(g){
  const hasDirect = g.orders.some(c => c.isDirect);
  const hasCourier = g.orders.some(c => !c.isDirect);
  return [
    hasDirect ? '<span class="badge b-direct">직배송</span>' : '',
    hasCourier ? '<span style="font-size:11px;color:var(--text3);">택배</span>' : ''
  ].filter(Boolean).join(' ');
}

function customerNextDelivery(c){
  if(!customerIsActiveOrder(c)) return '';
  if(c.orderType === 'once') return c.onceDate || c.startDate || '';
  if(typeof isDeliv !== 'function' || typeof addDays !== 'function' || typeof todayStr !== 'function') return c.startDate || '';
  const today = todayStr();
  for(let i=0; i<60; i++){
    const ds = addDays(today, i);
    if(isDeliv(c, ds) && !(c.deliveredDates || []).includes(ds)) return ds;
  }
  return c.startDate || '';
}

function customerGroupSchedule(g){
  const upcoming = g.orders
    .map(c => ({c, date:customerNextDelivery(c)}))
    .filter(x => x.date)
    .sort((a,b)=>String(a.date).localeCompare(String(b.date)));
  if(upcoming.length) return upcoming[0].date;
  const latest = g.orders[0];
  return scheduleDisp(latest) || latest?.scheduleName || latest?.onceDate || '-';
}

function customerGroupRemain(g){
  const activeSubs = g.orders.filter(c => c.orderType === 'sub' && customerIsActiveOrder(c));
  if(!activeSubs.length) return '-';
  const remain = activeSubs.reduce((sum,c)=>sum + Number(c.remain || 0), 0);
  return activeSubs.length > 1 ? `정기 ${activeSubs.length}건 / ${remain}회` : gauge(activeSubs[0]);
}

function customerBuildGroups(source){
  const map = new Map();
  (source || []).forEach(c => {
    const key = customerGroupKey(c);
    if(!map.has(key)){
      map.set(key, {
        key,
        name:String(c.name || '').trim(),
        phone:c.phone || '',
        phoneDigits:customerPhoneDigits(c.phone),
        orders:[]
      });
    }
    map.get(key).orders.push(c);
  });
  return Array.from(map.values()).map(g => {
    g.orders = customerSortOrders(g.orders);
    g.latest = g.orders[0] || {};
    g.latestAt = customerOrderTime(g.latest);
    g.activeRemain = g.orders.filter(customerIsActiveOrder).reduce((sum,c)=>sum + Number(c.remain || 0), 0);
    return g;
  });
}

function customerMatchesQuery(c, q){
  if(!q) return true;
  const hay = [
    c.name, c.phone, customerPhoneDigits(c.phone), c.addr, c.orderNum, c.syncKey,
    c.orderDate, customerOrderDate(c), c.memo, c.request
  ].map(v => String(v || '').toLowerCase());
  return hay.some(v => v.includes(q));
}

function customerMatchesFilters(c, filters){
  if(filters.q && !customerMatchesQuery(c, filters.q)) return false;
  if(filters.fs && customerProductKey(c) !== filters.fs) return false;
  if(filters.ft && c.orderType !== filters.ft) return false;
  if(filters.fst && c.status !== filters.fst) return false;
  if(filters.fd && (filters.fd === '1' ? !c.isDirect : c.isDirect)) return false;
  if(filters.fr === 'remain' && !(Number(c.remain || 0) > 0)) return false;
  if(filters.fr === 'done' && Number(c.remain || 0) > 0) return false;
  return true;
}

function customerGroupMatches(g, filters){
  return g.orders.some(c => customerMatchesFilters(c, filters));
}

function customerGroupQuickMatches(g, mode){
  if(!mode || mode === 'all') return true;
  const status = customerGroupStatus(g);
  const activeOrders = (g.orders || []).filter(customerIsActiveOrder);
  const currentOrders = activeOrders.length ? activeOrders : (g.orders || []);
  if(mode === 'active') return status.cls === 'active';
  if(mode === 'pause') return status.cls === 'pause';
  if(mode === 'risk') return (g.orders || []).some(customerIsRiskOrder);
  if(mode === 'new') return (g.orders || []).some(customerIsNewOrder);
  if(mode === 'direct') return currentOrders.some(c => c.isDirect);
  if(mode === 'courier') return currentOrders.some(c => !c.isDirect);
  return true;
}

function customerGroupCounts(groups){
  const counts = {all:groups.length, active:0, pause:0, risk:0, new:0, direct:0, courier:0};
  groups.forEach(g => {
    const status = customerGroupStatus(g);
    if(status.cls === 'active') counts.active++;
    if(status.cls === 'pause') counts.pause++;
    if((g.orders || []).some(customerIsRiskOrder)) counts.risk++;
    if((g.orders || []).some(customerIsNewOrder)) counts.new++;
    const activeOrders = (g.orders || []).filter(customerIsActiveOrder);
    const currentOrders = activeOrders.length ? activeOrders : (g.orders || []);
    if(currentOrders.some(c => c.isDirect)) counts.direct++;
    if(currentOrders.some(c => !c.isDirect)) counts.courier++;
  });
  return counts;
}

function updateCustomerOverview(allGroups, filteredCount, visibleCount){
  const counts = customerGroupCounts(allGroups);
  const summaryMap = {
    custSummaryTotal:counts.all,
    custSummaryActive:counts.active,
    custSummaryPause:counts.pause,
    custSummaryRisk:counts.risk
  };
  Object.entries(summaryMap).forEach(([id, value]) => {
    const el = document.getElementById(id);
    if(el) el.textContent = String(value);
  });
  document.querySelectorAll('[data-customer-count]').forEach(el => {
    const key = el.dataset.customerCount;
    el.textContent = String(counts[key] || 0);
  });
  document.querySelectorAll('[data-customer-filter]').forEach(el => {
    const active = el.dataset.customerFilter === __customerQuickFilter;
    el.classList.toggle('active', active);
    el.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
  const result = document.getElementById('custResultText');
  if(result){
    result.textContent = filteredCount > visibleCount
      ? `고객 ${filteredCount}명 중 ${visibleCount}명 표시`
      : `고객 ${filteredCount}명`;
  }
}

function customerGroupOrderSummary(c){
  const prod = customerProductKey(c);
  const dates = (c.deliveredDates || []).slice(-5).reverse();
  const orderNo = c.orderNum || c.syncKey || '';
  const status = statusLabel(c);
  const dateHtml = dates.length
    ? dates.map(d => `<div class="dhi" style="display:flex;align-items:center;justify-content:space-between;gap:8px;"><span>${customerText(d)}</span><button onclick="undoMarkDone('${customerJsArg(c.id)}','${customerJsArg(d)}')" style="border:none;background:none;color:var(--danger);cursor:pointer;font-size:11px;padding:0 2px;">취소</button></div>`).join('')
    : '<div style="font-size:12px;color:var(--text3);">이력 없음</div>';
  return `
    <div style="border:1px solid var(--border);border-radius:10px;padding:10px 12px;margin-top:10px;background:var(--surface);">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-bottom:8px;">
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
          <span class="badge ${productBadgeClass(prod)}">${customerText(productLabel(prod))}</span>
          <span class="badge ${customerOrderTypeBadge(c)}">${customerText(customerOrderTypeLabel(c))}</span>
          <span class="badge b-${c.status}">${customerText(status)}</span>
          ${customerOrderNewBadge(c)}
          ${customerOrderFirstBadge(c)}
        </div>
        <div style="font-size:11px;color:var(--text3);">${orderNo ? '#' + customerText(orderNo) : ''}</div>
      </div>
      <div style="display:grid;grid-template-columns:72px 1fr;gap:6px 8px;font-size:12px;">
        <div style="color:var(--text3);">배송일정</div><div>${customerText(scheduleDisp(c) || c.scheduleName || c.onceDate || '-')}</div>
        <div style="color:var(--text3);">배송방식</div><div>${c.isDirect ? '<span class="badge b-direct">직배송</span>' : '<span style="font-size:12px;color:var(--text3);">택배</span>'}</div>
        <div style="color:var(--text3);">${c.orderType === 'sub' ? '잔여' : '수량'}</div><div>${gauge(c)}</div>
        <div style="color:var(--text3);">완료이력</div><div>${dateHtml}</div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:10px;">
        <button class="btn btn-p sm" onclick="openEdit('${customerJsArg(c.id)}')">수정</button>
        <button class="btn btn-s sm" onclick="markDone('${customerJsArg(c.id)}')">배송완료</button>
        <button class="btn btn-g sm" style="grid-column:1/-1;" onclick="copyLozen('${customerJsArg(c.id)}')">택배 복사</button>
        ${c.orderType === 'sub'
          ? `<button class="btn btn-g sm" onclick="togglePause('${customerJsArg(c.id)}')">${c.status === 'pause' ? '재개' : '일시정지'}</button><button class="btn sm" style="background:rgba(3,102,214,.1);color:#0366d6;border-color:rgba(3,102,214,.3);" onclick="chargeRemain('${customerJsArg(c.id)}')">충전</button>`
          : `<button class="btn btn-g sm" style="grid-column:1/-1;" onclick="editOnceDate('${customerJsArg(c.id)}','${customerJsArg(c.onceDate || '')}')">배송일 변경</button>`
        }
        <button class="btn btn-d sm" style="grid-column:1/-1;" onclick="quickDelete('${customerJsArg(c.id)}','${customerJsArg(c.name)}')">삭제</button>
      </div>
    </div>`;
}

function showCustomerGroup(idx){
  const g = __customerGroups[idx];
  if(!g) return;
  document.querySelectorAll('.trc').forEach(r=>r.classList.remove('sel'));
  if(typeof event !== 'undefined' && event?.currentTarget) event.currentTarget.classList.add('sel');
  else document.querySelector(`.trc[data-group-idx="${idx}"]`)?.classList.add('sel');

  const latest = g.latest || {};
  const status = customerGroupStatus(g);
  document.getElementById('custDetail').innerHTML = `
    <div class="dp">
      <div class="dph">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;gap:8px;">
          <div>
            <div style="font-size:16px;font-weight:700;">${customerText(g.name || latest.name || '-')}</div>
            <div style="font-size:11px;color:var(--text3);margin-top:2px;">주문 ${g.orders.length}건</div>
          </div>
          <span class="badge b-${status.cls}">${customerText(status.label)}</span>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;">${customerProductChips(g)} ${customerTypeChips(g)}</div>
      </div>
      <div class="dpb">
        <div class="dpr"><div class="dpl">연락처</div><div class="dpv">${customerText(g.phone || latest.phone || '-')}</div></div>
        <div class="dpr"><div class="dpl">최근 주문일자</div><div class="dpv">${customerText(customerOrderDate(latest))}</div></div>
        <div class="dpr"><div class="dpl">배송지</div><div class="dpv" style="font-size:12px;">${customerText(latest.addr || '-')}</div></div>
        <div class="dpr"><div class="dpl">현관번호</div><div class="dpv">${customerText(latest.door || '-')}</div></div>
        <div class="dpr"><div class="dpl">요청사항</div><div class="dpv" style="font-size:12px;">${customerText(latest.request || '-')}</div></div>
        <div class="dpr"><div class="dpl">최근메모</div><div class="dpv" style="font-size:12px;">${customerText(latest.memo || '-')}</div></div>
        <div class="dpr">
          <div class="dpl">주문내역</div>
          <div style="margin-top:2px;">${g.orders.map(customerGroupOrderSummary).join('')}</div>
        </div>
      </div>
    </div>`;
}

function renderCust(){
  const filters = {
    q:(document.getElementById('srchQ')?.value || '').trim().toLowerCase(),
    fs:document.getElementById('srchSet')?.value || '',
    ft:document.getElementById('srchType')?.value || '',
    fst:document.getElementById('srchSt')?.value || '',
    fd:document.getElementById('srchDirect')?.value || '',
    fr:document.getElementById('srchRemain')?.value || ''
  };

  const groups = customerBuildGroups(custs).filter(g => customerGroupMatches(g, filters));
  const sortBy = document.getElementById('srchSort')?.value || 'recent';
  groups.sort((a,b)=>{
    if(sortBy === 'name') return (a.name || '').localeCompare(b.name || '', 'ko');
    if(sortBy === 'remain') return (b.activeRemain || 0) - (a.activeRemain || 0);
    return (b.latestAt || 0) - (a.latestAt || 0);
  });
  __customerGroups = groups;

  const tb = document.getElementById('custList');
  if(!tb) return;
  if(!groups.length){
    tb.innerHTML = `<tr><td colspan="9"><div class="empty"><div class="ei">-</div><div>검색 결과 없음</div></div></td></tr>`;
    document.getElementById('custDetail').innerHTML = `<div class="dp"><div style="text-align:center;padding:36px 16px;color:var(--text3);"><div style="font-size:28px;margin-bottom:8px;">-</div><div style="font-size:12px;">고객을 클릭하면<br>상세정보가 표시됩니다</div></div></div>`;
    return;
  }

  if(window.innerWidth <= 768){
    tb.closest('table').style.minWidth = '0';
    tb.innerHTML = groups.map((g, idx) => {
      const status = customerGroupStatus(g);
      return `<tr class="trc" data-group-idx="${idx}">
        <td colspan="9" style="padding:0;border:none;">
          <div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;margin:4px 0;padding:12px 14px;cursor:pointer;"
               onclick="showCustomerGroup(${idx})">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;gap:8px;">
              <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                <strong style="font-size:14px;">${customerText(g.name || '-')}</strong>
                ${customerProductChips(g)}
                ${customerTypeChips(g)}
              </div>
              <span class="badge b-${status.cls}">${customerText(status.label)}</span>
            </div>
            <div style="font-size:12px;color:var(--text2);margin-bottom:3px;">${customerText(g.phone || '-')} / 주문 ${g.orders.length}건</div>
            <div style="font-size:11px;color:var(--text3);margin-bottom:6px;">${customerText(customerGroupSchedule(g))}</div>
            <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
              <div>${customerGroupRemain(g)}</div>
              <div style="display:flex;gap:6px;flex-wrap:wrap;">${customerDeliveryChips(g)}</div>
            </div>
          </div>
        </td>
      </tr>`;
    }).join('');
  } else {
    tb.closest('table').style.minWidth = '';
    tb.innerHTML = groups.map((g, idx) => {
      const status = customerGroupStatus(g);
      return `<tr class="trc" data-group-idx="${idx}" onclick="showCustomerGroup(${idx})">
        <td>
          <strong>${customerText(g.name || '-')}</strong>
          <div style="font-size:10px;color:var(--text3);margin-top:2px;">주문 ${g.orders.length}건</div>
        </td>
        <td style="white-space:nowrap;">${customerText(g.phone || '-')}</td>
        <td>${customerProductChips(g)}</td>
        <td>${customerTypeChips(g)}</td>
        <td style="font-size:11px;color:var(--text3);max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${customerText(customerGroupSchedule(g))}${g.orders.some(c=>c.pendingSchedule) ? ' <span class="badge" style="background:#fef3c7;color:#92400e;border-color:#f59e0b;font-size:9px;">변경예약</span>' : ''}</td>
        <td>${customerDeliveryChips(g)}</td>
        <td>${customerGroupRemain(g)}</td>
        <td><span class="badge b-${status.cls}">${customerText(status.label)}</span></td>
        <td style="display:flex;gap:4px;flex-wrap:wrap;">
          <button class="btn btn-g sm" onclick="event.stopPropagation();showCustomerGroup(${idx})">상세</button>
          <button class="btn btn-g sm" onclick="event.stopPropagation();openEdit('${customerJsArg(g.latest.id)}')">최근수정</button>
        </td>
      </tr>`;
    }).join('');
  }
}

function customerOrderCountHtml(g){
  const count = g.orders.length;
  if(count > 1){
    return `<span class="badge b-direct" style="font-size:10px;margin-top:3px;">재주문 ${count}건</span>`;
  }
  return `<div style="font-size:10px;color:var(--text3);margin-top:2px;">주문 1건</div>`;
}

function customerOrderButtonLabel(c){
  const prod = productLabel(customerProductKey(c)) || customerProductKey(c) || '-';
  const orderNo = c.orderNum || c.syncKey || '';
  return [
    customerOrderDate(c),
    prod,
    customerOrderTypeLabel(c),
    orderNo ? '#' + orderNo : ''
  ].filter(Boolean).join(' · ');
}

function customerToggleOrder(groupIdx, orderId){
  const g = __customerGroups[groupIdx];
  if(!g) return;
  __selectedCustomerGroupKey = g.key;
  __expandedCustomerOrderId = __expandedCustomerOrderId === orderId ? '' : orderId;
  showCustomerGroup(groupIdx, true);
}

function customerGroupOrderSummary(c, idx){
  const prod = customerProductKey(c);
  const dates = (c.deliveredDates || []).slice(-5).reverse();
  const orderNo = c.orderNum || c.syncKey || '';
  const status = statusLabel(c);
  const isOpen = __expandedCustomerOrderId === c.id;
  const dateHtml = dates.length
    ? `<div class="customer-history-list">${dates.map(d => `<div class="dhi"><span>${customerText(d)}</span><button onclick="undoMarkDone('${customerJsArg(c.id)}','${customerJsArg(d)}')">취소</button></div>`).join('')}</div>`
    : '<span style="color:var(--text3);">이력 없음</span>';

  return `
    <div class="customer-order-accordion">
      <button class="customer-order-toggle" onclick="customerToggleOrder(${idx},'${customerJsArg(c.id)}')">
        <span class="customer-order-toggle-main">
          <span class="customer-order-toggle-title">${customerText(customerOrderButtonLabel(c))}</span>
          <span class="customer-order-toggle-badges">
            <span class="badge ${productBadgeClass(prod)}">${customerText(productLabel(prod))}</span>
            <span class="badge ${customerOrderTypeBadge(c)}">${customerText(customerOrderTypeLabel(c))}</span>
            ${customerRiskBadge(c)} ${customerOrderNewBadge(c)} ${customerOrderFirstBadge(c)}
          </span>
        </span>
        <span class="customer-order-toggle-state">${isOpen ? '접기' : '보기'} ${isOpen ? '⌃' : '⌄'}</span>
      </button>
      ${!isOpen ? '' : `<div class="customer-order-detail">
        <dl class="customer-order-info">
          <dt>상태</dt><dd><span class="badge b-${c.status}">${customerText(status)}</span></dd>
          <dt>주문번호</dt><dd>${orderNo ? '#' + customerText(orderNo) : '-'}</dd>
          <dt>주문일자</dt><dd>${customerText(customerOrderDate(c))}</dd>
          <dt>배송일정</dt><dd>${customerText(scheduleDisp(c) || c.scheduleName || c.onceDate || '-')}</dd>
          ${c.pendingSchedule ? `<dt>변경예약</dt><dd style="color:#b58900;font-weight:700;">${customerText(c.pendingSchedule.effectiveDate)}부터 ${customerText(c.pendingSchedule.scheduleName)} <button class="btn btn-g sm" onclick="event.stopPropagation();cancelPendingSchedule('${customerJsArg(c.id)}')">예약취소</button></dd>` : ''}
          <dt>배송방식</dt><dd>${c.isDirect ? '<span class="badge b-direct">직배송</span>' : '택배'}</dd>
          <dt>${c.orderType === 'sub' ? '잔여' : '수량'}</dt><dd>${gauge(c)}</dd>
          <dt>완료이력</dt><dd>${dateHtml}</dd>
        </dl>
        <div class="customer-order-actions">
          <button class="btn btn-p sm" onclick="openEdit('${customerJsArg(c.id)}')">수정</button>
          <button class="btn btn-g sm" onclick="copyOrder('${customerJsArg(c.id)}')">주문 복사</button>
          <button class="btn btn-s sm" onclick="markDone('${customerJsArg(c.id)}')">배송완료</button>
          <button class="btn btn-g sm" onclick="copyLozen('${customerJsArg(c.id)}')">택배 복사</button>
          ${c.orderType === 'sub'
            ? `<button class="btn btn-g sm" onclick="togglePause('${customerJsArg(c.id)}')">${c.status === 'pause' ? '재개' : '일시정지'}</button><button class="btn btn-g sm" onclick="chargeRemain('${customerJsArg(c.id)}')">횟수 충전</button>`
            : `<button class="btn btn-g sm" style="grid-column:1/-1;" onclick="editOnceDate('${customerJsArg(c.id)}','${customerJsArg(c.onceDate || '')}')">배송일 변경</button>`
          }
          <button class="btn btn-d sm" style="grid-column:1/-1;" onclick="quickDelete('${customerJsArg(c.id)}','${customerJsArg(c.name)}')">주문 삭제</button>
        </div>
      </div>`}
    </div>`;
}

function showCustomerGroup(idx, keepExpanded = false){
  const g = __customerGroups[idx];
  if(!g) return;
  document.querySelectorAll('.trc').forEach(r=>r.classList.remove('sel'));
  document.querySelector(`.trc[data-group-idx="${idx}"]`)?.classList.add('sel');

  if(!keepExpanded || __selectedCustomerGroupKey !== g.key){
    __selectedCustomerGroupKey = g.key;
    __expandedCustomerOrderId = (g.orders[0] && g.orders[0].id) || '';
  }

  const latest = g.latest || {};
  const status = customerGroupStatus(g);
  const phone = g.phone || latest.phone || '-';
  const phoneDigits = customerPhoneDigits(phone);
  const address = latest.addr || '-';
  const detail = document.getElementById('custDetail');
  if(!detail) return;
  detail.innerHTML = `
    <div class="customer-detail-panel">
      <div class="customer-detail-head">
        <div class="customer-detail-title-row">
          <div>
            <div class="customer-detail-title">${customerText(g.name || latest.name || '-')} ${customerGroupRiskBadge(g)} ${customerGroupNewBadge(g)} ${customerGroupFirstBadge(g)}</div>
            <div class="customer-detail-sub">${g.orders.length > 1 ? '재주문 ' + g.orders.length + '건' : '주문 1건'} · 최근 주문 ${customerText(customerOrderDate(latest))}</div>
          </div>
          <div style="display:flex;align-items:center;gap:7px;">
            <span class="badge b-${status.cls}">${customerText(status.label)}</span>
            <button type="button" class="customer-detail-close" onclick="closeCustomerDetail()" aria-label="고객 상세 닫기">×</button>
          </div>
        </div>
        <div class="customer-detail-tags">${customerProductChips(g)} ${customerTypeChips(g)} ${customerDeliveryChips(g)}</div>
      </div>
      <div class="customer-detail-body">
        <div class="customer-contact-actions">
          <a class="btn btn-g sm" href="tel:${customerText(phoneDigits)}">전화</a>
          <button class="btn btn-g sm" onclick="customerCopyText('${customerJsArg(address)}','주소')">주소 복사</button>
          <button class="btn btn-p sm" onclick="openEdit('${customerJsArg(latest.id)}')">최근 주문 수정</button>
        </div>
        <div class="customer-info-grid">
          <div class="customer-info-item"><span>연락처</span><strong>${customerText(phone)}</strong></div>
          <div class="customer-info-item"><span>최근 주문일</span><strong>${customerText(customerOrderDate(latest))}</strong></div>
          <div class="customer-info-item is-wide"><span>배송지</span><strong>${customerText(address)}</strong></div>
          <div class="customer-info-item"><span>현관번호</span><strong>${customerText(latest.door || '-')}</strong></div>
          <div class="customer-info-item"><span>다음 배송</span><strong>${customerText(customerGroupSchedule(g))}</strong></div>
          <div class="customer-info-item is-wide"><span>요청사항</span><strong>${customerText(latest.request || '-')}</strong></div>
          <div class="customer-info-item is-wide"><span>최근 메모</span><strong>${customerText(latest.memo || '-')}</strong></div>
        </div>
        <div class="customer-detail-section-head"><strong>주문내역</strong><span>총 ${g.orders.length}건</span></div>
        <div>${g.orders.map(c => customerGroupOrderSummary(c, idx)).join('')}</div>
      </div>
    </div>`;

  if(window.innerWidth <= 768){
    detail.classList.add('is-open');
    document.getElementById('custDetailBackdrop')?.classList.add('is-open');
    document.body.classList.add('customer-detail-open');
  }
}

function renderCust(){
  const filters = {
    q:(document.getElementById('srchQ')?.value || '').trim().toLowerCase(),
    fs:document.getElementById('srchSet')?.value || '',
    ft:document.getElementById('srchType')?.value || '',
    fst:document.getElementById('srchSt')?.value || '',
    fd:document.getElementById('srchDirect')?.value || '',
    fr:document.getElementById('srchRemain')?.value || ''
  };
  const sortBy = document.getElementById('srchSort')?.value || 'recent';
  const signature = JSON.stringify({...filters, sortBy, quick:__customerQuickFilter});
  if(signature !== __customerFilterSignature){
    __customerFilterSignature = signature;
    __customerVisibleLimit = CUSTOMER_PAGE_SIZE;
  }

  const allGroups = customerBuildGroups(custs);
  const groups = allGroups
    .filter(g => customerGroupMatches(g, filters))
    .filter(g => customerGroupQuickMatches(g, __customerQuickFilter));
  groups.sort((a,b)=>{
    if(sortBy === 'name') return (a.name || '').localeCompare(b.name || '', 'ko');
    if(sortBy === 'remain') return (b.activeRemain || 0) - (a.activeRemain || 0);
    return (b.latestAt || 0) - (a.latestAt || 0);
  });
  __customerGroups = groups;

  const visibleGroups = groups.slice(0, __customerVisibleLimit);
  updateCustomerOverview(allGroups, groups.length, visibleGroups.length);
  const tb = document.getElementById('custList');
  const more = document.getElementById('custListMore');
  const detail = document.getElementById('custDetail');
  if(!tb) return;

  if(!groups.length){
    tb.innerHTML = `<tr><td colspan="6"><div class="empty"><div class="empty-mark">CS</div><div>조건에 맞는 고객이 없습니다</div></div></td></tr>`;
    if(more) more.innerHTML = '';
    if(detail) detail.innerHTML = `<div class="customer-detail-empty"><div class="customer-detail-empty-icon">CS</div><strong>검색 결과가 없습니다</strong><span>검색어나 필터를 바꿔주세요.</span></div>`;
    closeCustomerDetail();
    return;
  }

  if(window.innerWidth <= 768){
    tb.closest('table').style.minWidth = '0';
    tb.innerHTML = visibleGroups.map((g, idx) => {
      const status = customerGroupStatus(g);
      const latest = g.latest || {};
      const phone = g.phone || latest.phone || '-';
      const phoneDigits = customerPhoneDigits(phone);
      const address = latest.addr || '-';
      return `<tr class="trc" data-group-idx="${idx}"><td colspan="6">
        <article class="customer-mobile-card" onclick="showCustomerGroup(${idx})">
          <div class="customer-mobile-head">
            <div>
              <div class="customer-mobile-name">${customerText(g.name || '-')} ${customerGroupRiskBadge(g)} ${customerGroupNewBadge(g)} ${customerGroupFirstBadge(g)}</div>
              <div class="customer-mobile-sub">${customerText(phone)} · ${g.orders.length > 1 ? '재주문 ' + g.orders.length + '건' : '주문 1건'}</div>
            </div>
            <span class="badge b-${status.cls}">${customerText(status.label)}</span>
          </div>
          <div class="customer-mobile-address">${customerText(address)}</div>
          <div class="customer-mobile-facts">
            <div class="customer-mobile-fact"><span>다음 배송</span><strong>${customerText(customerGroupSchedule(g))}</strong></div>
            <div class="customer-mobile-fact"><span>잔여</span><strong>${customerGroupRemain(g)}</strong></div>
          </div>
          <div class="customer-mobile-foot">
            <div class="customer-mobile-tags">${customerProductChips(g)} ${customerTypeChips(g)} ${customerDeliveryChips(g)}</div>
            <div class="customer-mobile-actions">
              <a class="btn btn-g sm" href="tel:${customerText(phoneDigits)}" onclick="event.stopPropagation()">전화</a>
              <button class="btn btn-g sm" onclick="event.stopPropagation();customerCopyText('${customerJsArg(address)}','주소')">주소</button>
            </div>
          </div>
        </article>
      </td></tr>`;
    }).join('');
  } else {
    tb.closest('table').style.minWidth = '';
    tb.innerHTML = visibleGroups.map((g, idx) => {
      const status = customerGroupStatus(g);
      const nextDate = customerGroupSchedule(g);
      return `<tr class="trc" data-group-idx="${idx}" onclick="showCustomerGroup(${idx})">
        <td class="customer-name-cell">
          <div class="customer-name-line"><strong>${customerText(g.name || '-')}</strong>${customerGroupRiskBadge(g)}${customerGroupNewBadge(g)}${customerGroupFirstBadge(g)}</div>
          <div class="customer-order-count">${g.orders.length > 1 ? '재주문 ' + g.orders.length + '건' : '주문 1건'}</div>
        </td>
        <td style="white-space:nowrap;">${customerText(g.phone || '-')}</td>
        <td><div class="customer-product-stack">${customerProductChips(g)} ${customerTypeChips(g)}</div></td>
        <td class="customer-schedule-cell"><div class="customer-next-date">${customerText(nextDate)}</div><div class="customer-delivery-line">${customerDeliveryChips(g)}${g.orders.some(c=>c.pendingSchedule) ? '<span class="badge" style="background:#fef3c7;color:#92400e;border-color:#f59e0b;font-size:9px;">변경예약</span>' : ''}</div></td>
        <td>${customerGroupRemain(g)}</td>
        <td class="customer-status-cell"><div class="customer-status-line"><span class="badge b-${status.cls}">${customerText(status.label)}</span><span class="customer-detail-arrow">›</span></div></td>
      </tr>`;
    }).join('');
  }

  if(more){
    const remaining = groups.length - visibleGroups.length;
    more.innerHTML = remaining > 0
      ? `<button class="btn btn-g sm" onclick="showMoreCustomers()">고객 더 보기 (${remaining}명)</button>`
      : '';
  }

  const selectedIdx = groups.findIndex(g => g.key === __selectedCustomerGroupKey);
  if(window.innerWidth > 768){
    showCustomerGroup(selectedIdx >= 0 ? selectedIdx : 0, true);
  }else if(selectedIdx < 0){
    closeCustomerDetail();
  }
}
