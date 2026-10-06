// ════════════════════════════════════════
// 배송 로직
// ════════════════════════════════════════
function todayStr(){
  const n=new Date();
  return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}-${String(n.getDate()).padStart(2,'0')}`;
}
function dow(ds){
  const [y,m,d]=ds.split('-').map(Number);
  return new Date(y,m-1,d).getDay();
}
function wasDeliveredOn(c,ds){
  return Array.isArray(c.deliveredDates) && c.deliveredDates.includes(ds);
}
// 해당 날짜에 배송 대상인지 (재개 예정일이 지난 정지 고객은 그날부터 배송 대상)
// status만 보면 재개일이 와도 관리자가 페이지를 열기 전까지 목록에서 빠진다.
function isActiveOn(c,ds){
  if(!c) return false;
  if(c.status==='active') return true;
  if(c.status==='pause' && c.resumeDate && ds >= c.resumeDate) return true;
  return false;
}
function isDelivSub(c,ds){
  if(c.orderType!=='sub') return false;
  // 배송완료 처리된 날짜는 잔여 0회/종료 상태여도 회색 완료 행으로 남겨야 함
  if(wasDeliveredOn(c,ds)) return true;
  if(!isActiveOn(c,ds)||Number(c.remain||0)<=0) return false;
  if(c.startDate && ds < c.startDate) return false;  // 첫 배송일 이전 차단
  if(typeof isManualDeliverySchedule === 'function' && isManualDeliverySchedule(c)){
    return typeof manualScheduleIncludes === 'function' && manualScheduleIncludes(c, ds);
  }
  const d=dow(ds);
  // cookDays가 저장된 경우: 조리일 기준으로 표시 (오늘 조리=오늘 출고)
  if(c.cookDays&&c.cookDays.length>0){
    return c.cookDays.includes(d);
  }
  // cookDays가 없는 기존 데이터 폴백:
  // arriveDays에서 하루 전날(조리일)을 역산 → 그게 오늘이면 표시
  // arriveDays = 도착요일, 조리일 = 도착일 - 1 (일요일 이전이면 토=6)
  const cookFromArrive=(c.arriveDays||[]).map(a=>a===0?6:a-1);
  return cookFromArrive.includes(d);
}
function isDelivOnce(c,ds){
  if(c.orderType!=='once') return false;
  // 1회성 주문은 완료 후 remain=0/status=end가 되므로 완료 이력을 우선 인정
  if(wasDeliveredOn(c,ds)) return true;
  if(!isActiveOn(c,ds)||Number(c.remain||0)<=0) return false;
  if(c.startDate && ds < c.startDate) return false;  // 첫 배송일 이전 차단
  if(c.isDirect){
    // 직배송: onceDate 당일 배송
    return c.onceDate===ds;
  }
  // 일반 택배: onceDate 당일 (기존 동일)
  return c.onceDate===ds;
}
function isDeliv(c,ds){ return isDelivSub(c,ds)||isDelivOnce(c,ds); }
function listFor(ds){ return custs.filter(c=>isDeliv(c,ds)); }
function todayList(){ return listFor(todayStr()); }

// ════════════════════════════════════════
// 날짜 유틸 - timezone 문제 없는 방식
// ════════════════════════════════════════
function addDays(dateStr, d){
  // "2026-03-16" 형식에서 timezone 오류 없이 날짜 이동
  const [y,m,day] = dateStr.split('-').map(Number);
  const dt = new Date(y, m-1, day+d);
  return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;
}
function dateLabel(dateStr){
  const [y,m,d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m-1, d);
  return `${y}.${String(m).padStart(2,'0')}.${String(d).padStart(2,'0')} (${DAYS[dt.getDay()]})`;
}

// ════════════════════════════════════════
// 대시보드 날짜 네비
// ════════════════════════════════════════
function moveDashDate(d){
  const inp = document.getElementById('dashDate');
  const cur = inp.value || todayStr();
  inp.value = addDays(cur, d);
  updateDashDisp(); renderDash();
}
function resetDashDate(){
  document.getElementById('dashDate').value = todayStr();
  updateDashDisp(); renderDash();
}
function updateDashDisp(){
  const v = document.getElementById('dashDate').value;
  if(!v) return;
  const isToday = v === todayStr();
  document.getElementById('dashDateDisp').textContent =
    dateLabel(v) + (isToday ? ' ← 오늘' : '');
  const [,m,d] = v.split('-').map(Number);
  document.getElementById('dash-date-lbl').textContent  = isToday ? '오늘 배송'  : `${m}/${d} 배송`;
  document.getElementById('dash-list-title').textContent = isToday ? '오늘 배송'  : `${m}월 ${d}일 배송`;
}

// ════════════════════════════════════════
// 배송관리 날짜 네비
// ════════════════════════════════════════
function moveTodayDate(d){
  const inp = document.getElementById('todayDate');
  const cur = inp.value || todayStr();
  inp.value = addDays(cur, d);
  updateTodayDisp(); renderToday();
}
function resetTodayDate(){
  document.getElementById('todayDate').value = todayStr();
  updateTodayDisp(); renderToday();
}
function updateTodayDisp(){
  const v = document.getElementById('todayDate').value;
  if(!v) return;
  const isToday = v === todayStr();
  document.getElementById('todayDateDisp').textContent =
    dateLabel(v) + (isToday ? ' ← 오늘' : '');
}

// ════════════════════════════════════════
// 주간·월간 리포트
// ════════════════════════════════════════
function initReport(){ reportOffset=0; renderReport(); }

function setView(v){
  reportView=v; reportOffset=0;
  document.getElementById('vt-week').classList.toggle('on',v==='week');
  document.getElementById('vt-month').classList.toggle('on',v==='month');
  renderReport();
}

function moveReport(d){ reportOffset+=d; renderReport(); }
function resetReport(){ reportOffset=0; renderReport(); }

function getWeekRange(offset){
  const now=new Date(); now.setHours(0,0,0,0);
  const day=now.getDay(); // 0=일
  const monday=new Date(now); monday.setDate(now.getDate()-((day+6)%7)+offset*7);
  const sunday=new Date(monday); sunday.setDate(monday.getDate()+6);
  return {start:monday, end:sunday};
}

function getMonthRange(offset){
  const now=new Date();
  const y=now.getFullYear(), m=now.getMonth()+offset;
  const start=new Date(y, m, 1);
  const end=new Date(y, m+1, 0);
  return {start, end};
}

function dateToStr(d){ return d.toISOString().split('T')[0]; }

function renderReport(){
  if(reportView==='week') renderWeek();
  else renderMonth();
}

function renderWeek(){
  const {start,end}=getWeekRange(reportOffset);
  const s=dateToStr(start), e=dateToStr(end);
  document.getElementById('reportDisp').textContent=
    `${start.getFullYear()}.${String(start.getMonth()+1).padStart(2,'0')}.${String(start.getDate()).padStart(2,'0')} ~ ${end.getFullYear()}.${String(end.getMonth()+1).padStart(2,'0')}.${String(end.getDate()).padStart(2,'0')} (주간)`;

  // 7일 날짜 배열
  const days=[];
  for(let i=0;i<7;i++){
    const d=new Date(start); d.setDate(start.getDate()+i);
    days.push(dateToStr(d));
  }

  // 요약 수치
  const total7=days.reduce((acc,ds)=>acc+listFor(ds).length,0);
  const done7=custs.filter(c=>(c.deliveredDates||[]).some(d=>d>=s&&d<=e)).length;
  const newCusts=custs.filter(c=>c.startDate&&c.startDate>=s&&c.startDate<=e).length;
  const endCusts=custs.filter(c=>c.status==='end'&&(c.deliveredDates||[]).some(d=>d>=s&&d<=e)).length;

  document.getElementById('reportSummary').innerHTML=`
    <div class="sum-card"><div class="sum-label">이번 주 배송</div><div class="sum-val" style="color:var(--accent);">${total7}</div><div class="sum-sub">건 예정</div></div>
    <div class="sum-card"><div class="sum-label">배송 완료</div><div class="sum-val" style="color:var(--info);">${done7}</div><div class="sum-sub">고객 기준</div></div>
    <div class="sum-card"><div class="sum-label">신규 등록</div><div class="sum-val" style="color:var(--accent-l);">${newCusts}</div><div class="sum-sub">고객</div></div>
    <div class="sum-card"><div class="sum-label">구독 종료</div><div class="sum-val" style="color:var(--danger);">${endCusts}</div><div class="sum-sub">고객</div></div>`;

  // 주간 달력
  const html=`<div class="week-grid">
    ${days.map(ds=>{
      const d=new Date(ds+'T00:00:00');
      const cnt=listFor(ds).length;
      const isToday=ds===todayStr();
      return `<div class="day-cell${isToday?' today':''}${cnt>0?' has-deliv':''}" onclick="jumpToDate('${ds}')">
        <div class="dc-name">${DAYS[d.getDay()]}</div>
        <div class="dc-date">${d.getDate()}</div>
        <div class="dc-cnt">${cnt||'—'}</div>
        <div class="dc-sub">${cnt?'건':'없음'}</div>
      </div>`;
    }).join('')}
  </div>`;
  document.getElementById('reportCalendar').innerHTML=html;

  // 배송 목록
  renderReportList(days);
  document.getElementById('reportListTitle').textContent='주간 배송 완료 이력';
}

function renderMonth(){
  const {start,end}=getMonthRange(reportOffset);
  const y=start.getFullYear(), m=start.getMonth();
  document.getElementById('reportDisp').textContent=`${y}년 ${m+1}월`;

  // 요약
  const s=dateToStr(start), e=dateToStr(end);
  const days=[];
  let cur=new Date(start);
  while(cur<=end){ days.push(dateToStr(new Date(cur))); cur.setDate(cur.getDate()+1); }

  const total=days.reduce((acc,ds)=>acc+listFor(ds).length,0);
  const done=custs.filter(c=>(c.deliveredDates||[]).some(d=>d>=s&&d<=e)).length;
  const newCusts=custs.filter(c=>c.startDate&&c.startDate>=s&&c.startDate<=e).length;
  const endCusts=custs.filter(c=>c.status==='end'&&(c.deliveredDates||[]).some(d=>d>=s&&d<=e)).length;

  document.getElementById('reportSummary').innerHTML=`
    <div class="sum-card"><div class="sum-label">${m+1}월 배송 예정</div><div class="sum-val" style="color:var(--accent);">${total}</div><div class="sum-sub">건</div></div>
    <div class="sum-card"><div class="sum-label">배송 완료</div><div class="sum-val" style="color:var(--info);">${done}</div><div class="sum-sub">고객 기준</div></div>
    <div class="sum-card"><div class="sum-label">신규 등록</div><div class="sum-val" style="color:var(--accent-l);">${newCusts}</div><div class="sum-sub">고객</div></div>
    <div class="sum-card"><div class="sum-label">구독 종료</div><div class="sum-val" style="color:var(--danger);">${endCusts}</div><div class="sum-sub">고객</div></div>`;

  // 월간 달력
  const firstDow=(new Date(y,m,1).getDay()+6)%7; // 월요일=0
  const totalDays=new Date(y,m+1,0).getDate();
  let cal=`<div class="month-grid">`;
  ['월','화','수','목','금','토','일'].forEach(d=>{ cal+=`<div class="month-head">${d}</div>`; });
  for(let i=0;i<firstDow;i++) cal+=`<div class="mc other-month"></div>`;
  for(let d=1;d<=totalDays;d++){
    const ds=`${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const cnt=listFor(ds).length;
    const isToday=ds===todayStr();
    cal+=`<div class="mc${isToday?' today':''}${cnt>0?' has-d':''}" onclick="jumpToDate('${ds}')">
      <div class="mc-d">${d}</div>
      ${cnt?`<div class="mc-n">${cnt}</div>`:''}
    </div>`;
  }
  cal+='</div>';
  document.getElementById('reportCalendar').innerHTML=cal;

  renderReportList(days);
  document.getElementById('reportListTitle').textContent=`${m+1}월 배송 완료 이력`;
}

function renderReportList(days){
  const rows=[];
  days.forEach(ds=>{
    custs.forEach(c=>{
      if((c.deliveredDates||[]).includes(ds)){
        rows.push({ds,c});
      }
    });
  });
  rows.sort((a,b)=>a.ds.localeCompare(b.ds));
  const tb=document.getElementById('reportList');
  if(!rows.length){
    tb.innerHTML=`<tr><td colspan="6"><div class="empty"><div class="ei">📭</div><div>배송 완료 이력 없음</div></div></td></tr>`;
    return;
  }
  tb.innerHTML=rows.map(({ds,c})=>{
    const d=new Date(ds+'T00:00:00');
    return `<tr>
      <td style="white-space:nowrap;font-weight:600;color:var(--text2);">${ds} (${DAYS[d.getDay()]})</td>
      <td><strong>${c.name}</strong></td>
      <td><span class="badge ${productBadgeClass(c.productId||c.set)}">${productLabel(c.productId||c.set)}</span></td>
      <td><span class="badge ${c.orderType==='once'?'b-once':'b-sub'}">${c.orderType==='once'?'선택':'정기'}</span></td>
      <td>${c.phone}</td>
      <td style="font-size:12px;color:var(--text2);">${c.addr}</td>
    </tr>`;
  }).join('');
}

function jumpToDate(ds){
  // 배송관리 탭으로 이동 + 날짜 세팅
  document.getElementById('todayDate').value=ds;
  updateTodayDisp(); renderToday();
  goTab('today');
}

// ════════════════════════════════════════
// 배송완료 처리 안정화
// - 삭제 후 재등록된 주문도 deliveredDates/remain/status를 한 번에 맞춤
// - 다른 JS에 기존 markDone이 있어도 페이지 로드 후 이 함수로 덮어씀
// ════════════════════════════════════════
(function(){
  function deliveryToast(msg,type){
    if(typeof window.toast==='function') window.toast(msg,type||'');
    else console.log(msg);
  }
  function selectedDeliveryDate(){
    return document.getElementById('todayDate')?.value || todayStr();
  }
  function cleanDates(arr){
    return Array.isArray(arr) ? arr.map(String).filter(Boolean) : [];
  }
  function rerenderDeliveryScreens(){
    try{ if(typeof renderToday==='function') renderToday(); }catch(e){}
    try{ if(typeof renderDash==='function') renderDash(); }catch(e){}
    try{ if(typeof renderCust==='function') renderCust(); }catch(e){}
    try{ if(typeof renderReport==='function') renderReport(); }catch(e){}
  }
  function patchLocalCustomer(id, patch){
    if(!Array.isArray(window.custs)) return;
    const idx = window.custs.findIndex(c=>c.id===id);
    if(idx>=0) window.custs[idx] = {...window.custs[idx], ...patch};
  }
  // '10월 26일(월)'. 확인 창에서 날짜를 헷갈리지 않게 요일까지 적는다.
  function deliveryDateText(ds){
    const [,m,d] = String(ds).split('-').map(Number);
    return `${m}월 ${d}일(${['일','월','화','수','목','금','토'][dow(ds)]})`;
  }
  // 오지 않은 날짜는 완료 처리하지 않는다. 날짜 칸이 다른 날인 채로 전체 완료를 눌러
  // 주문 14건이 20일 뒤 날짜로 완료되고 5건이 종료된 적이 있다 (2026-10-06).
  function blockedFutureDate(ds){
    if(deliveryDateKind(ds, todayStr()) !== 'future') return false;
    deliveryToast(`${deliveryDateText(ds)}은 아직 오지 않은 날짜라 완료 처리할 수 없습니다. 날짜 칸을 확인해 주세요.`,'er');
    return true;
  }
  // 완료할 때 같이 적어 둔 값을 취소할 때 맞춰 되돌린다. 남은 완료 이력의 마지막 날짜가 최근 배송일이다.
  function cancelExtraPatch(current, patch){
    const last = patch.deliveredDates.length ? patch.deliveredDates[patch.deliveredDates.length-1] : '';
    return {
      lastDeliveredDate: last,
      deliveryState: last ? 'done' : '',
      updatedAt: new Date().toISOString(),
      ...(last ? {} : { deliveredAt: '' })
    };
  }
  async function stableMarkDone(id, ds){
    ds = ds || selectedDeliveryDate();
    if(!id){ deliveryToast('고객 ID가 없습니다.','er'); return; }
    if(!window.__DB){ deliveryToast('DB 연결을 확인해주세요.','er'); return; }
    if(blockedFutureDate(ds)) return;
    const doneAt = new Date().toISOString();
    try{
      const result = await runDeliveryTransaction(window.__DB,id,ds,'complete',{
        lastDeliveredDate: ds,
        deliveredAt: doneAt,
        updatedAt: doneAt,
        deliveryState: 'done'
      }, { completeAllForOnce:true });
      if(!result.changed){
        deliveryToast(result.reason==='already_completed'?'이미 완료 처리된 날짜입니다.':'이미 배송 완료된 주문입니다.','er');
        return;
      }
      const patch = result.patch;
      patchLocalCustomer(id, patch);
      rerenderDeliveryScreens();
      deliveryToast('배송완료 처리됨','ok');
    }catch(e){
      console.error('markDone failed', e);
      deliveryToast('배송완료 처리 실패: '+(e.message||e),'er');
    }
  }
  async function stableUndoMarkDone(id, ds){
    ds = ds || selectedDeliveryDate();
    const local = Array.isArray(window.custs) ? window.custs.find(c=>c.id===id) : null;
    if(!id){ deliveryToast('고객 ID가 없습니다.','er'); return; }
    if(!window.__DB){ deliveryToast('DB 연결을 확인해주세요.','er'); return; }
    if(!confirm(`${local?.name || '고객'}의 [${ds}] 배송완료를 취소하시겠습니까?`)) return;
    try{
      const result = await runDeliveryTransaction(window.__DB,id,ds,'cancel',null,{ cancelPatch:cancelExtraPatch });
      if(!result.changed){ deliveryToast('해당 날짜는 완료 기록이 없습니다.','er'); return; }
      patchLocalCustomer(id, result.patch);
      rerenderDeliveryScreens();
      deliveryToast((local?.name || '고객')+' 배송완료 취소됨','ok');
    }catch(e){
      console.error('undoMarkDone failed', e);
      deliveryToast('배송완료 취소 실패: '+(e.message||e),'er');
    }
  }
  async function markMany(list, ds, label){
    ds = ds || selectedDeliveryDate();
    if(blockedFutureDate(ds)) return;
    const targets = list.filter(c=>!wasDeliveredOn(c,ds));
    if(!targets.length){ deliveryToast(label+' 완료할 대기 건이 없습니다.','er'); return; }
    // 지난 날짜를 뒤늦게 처리하는 것은 정상이지만, 날짜 칸이 다른 날인 줄 모르고 누르는 일이 있었다.
    // 오늘이 아니면 어느 날짜 목록인지 한 번 더 알린다.
    const notToday = deliveryDateKind(ds, todayStr()) === 'past'
      ? `\n\n※ 오늘(${deliveryDateText(todayStr())})이 아닌 ${deliveryDateText(ds)} 목록입니다.` : '';
    if(!confirm(`${deliveryDateText(ds)} ${label} ${targets.length}건 배송완료 처리할까요?${notToday}`)) return;
    for(const c of targets){
      await stableMarkDone(c.id, ds);
    }
    deliveryToast(label+' 전체 완료 처리됨','ok');
  }
  // 선택한 날짜의 배송완료를 한꺼번에 되돌린다. 날짜를 잘못 골라 전체 완료를 눌렀을 때 쓴다.
  // 그날 목록에 뜨는 건만이 아니라 '그 날짜로 완료된 모든 주문'이 대상이다.
  // 잔여가 0이 되어 종료된 주문도 같이 되돌려야 다음 배송 목록에서 빠지지 않는다.
  async function cancelMany(ds){
    ds = ds || selectedDeliveryDate();
    if(!window.__DB){ deliveryToast('DB 연결을 확인해주세요.','er'); return; }
    const targets = (typeof custs !== 'undefined' && Array.isArray(custs) ? custs : []).filter(c=>wasDeliveredOn(c,ds));
    if(!targets.length){ deliveryToast(`${deliveryDateText(ds)}로 완료 처리된 건이 없습니다.`,'er'); return; }
    const names = targets.slice(0,5).map(c=>c.name).join(', ') + (targets.length>5 ? ` 외 ${targets.length-5}건` : '');
    if(!confirm(`${deliveryDateText(ds)} 배송완료 ${targets.length}건을 모두 취소할까요?\n\n${names}\n\n잔여 횟수가 돌아오고, 종료된 주문은 다시 진행 중이 됩니다.\n날짜를 잘못 골라 완료 처리했을 때만 쓰세요.`)) return;
    let cancelled = 0, failed = 0;
    for(const c of targets){
      try{
        const result = await runDeliveryTransaction(window.__DB,c.id,ds,'cancel',null,{ cancelPatch:cancelExtraPatch });
        if(result.changed){ patchLocalCustomer(c.id, result.patch); cancelled += 1; }
      }catch(e){
        failed += 1;
        console.error('cancelMany failed', c.id, e);
      }
    }
    rerenderDeliveryScreens();
    if(failed) deliveryToast(`${cancelled}건 취소, ${failed}건 실패. 새로고침한 뒤 다시 눌러 주세요.`,'er');
    else deliveryToast(`${deliveryDateText(ds)} 배송완료 ${cancelled}건 취소됨`,'ok');
  }
  function installStableDeliveryHandlers(){
    window.markDone = stableMarkDone;
    window.undoMarkDone = stableUndoMarkDone;
    window.markAll = function(){
      const ds = selectedDeliveryDate();
      return markMany(listFor(ds), ds, '전체');
    };
    window.markAllDirect = function(){
      const ds = selectedDeliveryDate();
      return markMany(listFor(ds).filter(c=>c.isDirect), ds, '직배송');
    };
    window.markAllCourier = function(){
      const ds = selectedDeliveryDate();
      return markMany(listFor(ds).filter(c=>!c.isDirect), ds, '택배');
    };
    window.cancelAllDeliveries = function(){
      return cancelMany(selectedDeliveryDate());
    };
  }
  installStableDeliveryHandlers();
  document.addEventListener('DOMContentLoaded', installStableDeliveryHandlers);
  window.addEventListener('load', installStableDeliveryHandlers);
  setTimeout(installStableDeliveryHandlers, 500);
})();
