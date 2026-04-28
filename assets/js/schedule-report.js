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
function isDelivSub(c,ds){
  if(c.status!=='active'||c.remain<=0||c.orderType!=='sub') return false;
  if(c.startDate && ds < c.startDate) return false;  // 첫 배송일 이전 차단
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
  if(c.status!=='active'||c.remain<=0||c.orderType!=='once') return false;
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
