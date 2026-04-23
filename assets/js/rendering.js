// ════════════════════════════════════════
// 렌더링 통합
// ════════════════════════════════════════
function refreshAll(){ renderDash(); renderToday(); renderCust(); renderReport(); }
function scheduleText(c){
  if(!c) return '—';
  if(c.orderType === 'once') return c.onceDate || '—';
  const raw = (c.scheduleName || '').trim();
  if(!raw) return '—';
  const prod = productLabel(c.productId || c.set);
  if(raw === prod || raw.indexOf(prod + ' x') === 0) return '—';
  return raw;
}

// 화면 크기 변경 시 재렌더링 (모바일↔PC 전환)
let _resizeTimer;
window.addEventListener('resize', ()=>{
  clearTimeout(_resizeTimer);
  _resizeTimer = setTimeout(()=>{ renderToday(); renderCust(); }, 200);
});

function renderDash(){
  const ds=document.getElementById('dashDate').value||todayStr();
  updateDashDisp();
  const tl=listFor(ds);
  let wk=0; for(let i=0;i<7;i++){const t=todayStr();wk+=listFor(addDays(t,i)).length;}
  // 내일 배송 목록
  const tmrStr = addDays(todayStr(), 1);
  const tmrList = listFor(tmrStr);
  s('s0',custs.length); s('s1',custs.filter(c=>c.status==='active').length);
  s('s2',tl.length); s('s3',wk); s('s4',tmrList.length);
  s('sA',custs.filter(c=>c.set==='A'&&c.status==='active').length);
  s('sB',custs.filter(c=>c.set==='B'&&c.status==='active').length);
  s('sC',custs.filter(c=>c.set==='C'&&c.status==='active').length);
  s('nBadge',listFor(todayStr()).length);

  // 직배송/택배 분리
  const directList  = tl.filter(c=>c.isDirect);
  const courierList = tl.filter(c=>!c.isDirect);

  // 직배송 섹션
  const dDirectWrap  = document.getElementById('dash-direct-wrap');
  const dTodayDirect = document.getElementById('dTodayDirect');
  if(dDirectWrap && dTodayDirect){
    dDirectWrap.style.display = directList.length ? '' : 'none';
    dTodayDirect.innerHTML = directList.slice(0,5).map(c=>`<tr>
      <td><strong style="cursor:pointer;color:var(--accent);text-decoration:underline dotted;" onclick="openEdit('${c.id}')">${c.name}</strong></td>
      <td><span class="badge ${productBadgeClass(c.productId||c.set)}">${productLabel(c.productId||c.set)}</span></td>
      <td><span class="badge ${c.orderType==='once'?'b-once':'b-sub'}">${c.orderType==='once'?'선택':'정기'}</span></td>
      <td>${c.phone||'—'}</td>
      <td>${gauge(c)}</td>
    </tr>`).join('');
  }

  // 택배 섹션 라벨
  const courierLabel = document.getElementById('dash-courier-label');
  if(courierLabel) courierLabel.style.display = directList.length ? '' : 'none';

  const dt=document.getElementById('dToday');
  dt.innerHTML=!courierList.length
    ?`<tr><td colspan="5"><div class="empty"><div class="ei">📦</div><div>택배 없음</div></div></td></tr>`
    :courierList.slice(0,8).map(c=>`<tr>
      <td><strong style="cursor:pointer;color:var(--accent);text-decoration:underline dotted;" onclick="openEdit('${c.id}')">${c.name}</strong></td>
      <td><span class="badge ${productBadgeClass(c.productId||c.set)}">${productLabel(c.productId||c.set)}</span></td>
      <td><span class="badge ${c.orderType==='once'?'b-once':'b-sub'}">${c.orderType==='once'?'선택':'정기'}</span></td>
      <td>${c.phone}</td>
      <td>${gauge(c)}</td>
    </tr>`).join('');

  const dl=document.getElementById('dLow');
  dl.innerHTML=!tmrList.length
    ?`<tr><td colspan="4"><div class="empty"><div class="ei">📭</div><div>내일 배송 없음</div></div></td></tr>`
    :tmrList.map(c=>`<tr>
      <td><strong style="cursor:pointer;color:var(--accent);text-decoration:underline dotted;" onclick="openEdit('${c.id}')">${c.name}</strong></td>
      <td><span class="badge ${productBadgeClass(c.productId||c.set)}">${productLabel(c.productId||c.set)}</span></td>
      <td><span class="badge ${c.orderType==='once'?'b-once':'b-sub'}">${c.orderType==='once'?'선택':'정기'}</span></td>
      <td>${c.phone}</td>
    </tr>`).join('');
}

function renderToday(){
  const ds = document.getElementById('todayDate').value || todayStr();
  updateTodayDisp();
  const allList    = listFor(ds);
  const directList = allList.filter(c => c.isDirect);
  const courierList= allList.filter(c => !c.isDirect);

  s('todayCnt', allList.length + '건');
  s('courier-cnt', courierList.length + '건');

  // 직배송 섹션 표시/숨김
  const dirSec = document.getElementById('today-direct-section');
  if(dirSec) dirSec.style.display = directList.length ? '' : 'none';

  // ── 직배송 필터 적용 ──
  const allDirectCks = document.querySelectorAll('.direct-filter-ck');
  const checkedDirectVals = Array.from(allDirectCks).filter(el=>el.checked).map(el=>el.value);
  const filteredDirect = checkedDirectVals.length === allDirectCks.length
    ? directList
    : directList.filter(c=>{
        const prod = c.productId || c.set || '';
        const isSingle = ['pork_rib','beef_la','beef_soup'].indexOf(prod) !== -1;
        if(isSingle) return checkedDirectVals.indexOf('single') !== -1;
        return checkedDirectVals.indexOf(prod) !== -1;
      });

  s('direct-cnt', filteredDirect.length + '건');

  // ── 직배송 테이블/카드 ──
  const dtb = document.getElementById('directList');
  if(dtb){
    if(!filteredDirect.length){
      dtb.innerHTML = `<tr><td colspan="11"><div class="empty"><div class="ei">🚗</div><div>직배송 없음</div></div></td></tr>`;
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
                    <input type="checkbox" class="ck-direct" data-id="${c.id}">
                    <strong style="font-size:15px;cursor:pointer;color:var(--accent);" onclick="openEdit('${c.id}')">${c.name}</strong>
                    <span class="badge ${productBadgeClass(c.productId||c.set)}">${productLabel(c.productId||c.set)}</span>
                  </div>
                  ${done
                    ? '<span class="badge b-ok">완료</span>'
                    : `<button class="btn btn-s sm" style="padding:6px 16px;" onclick="markDone('${c.id}','${ds}')">✓ 완료</button>`
                  }
                </div>
                <div style="font-size:12px;color:var(--text2);margin-bottom:4px;">📞 ${c.phone}</div>
                <div style="font-size:12px;color:#c020b0;cursor:pointer;margin-bottom:4px;" onclick="showAddrModal('${c.id}')">📍 ${c.addr}</div>
                ${c.door ? `<div style="font-size:12px;color:var(--text3);">🔑 현관: ${c.door}</div>` : ''}
                ${c.request ? `<div style="font-size:12px;color:var(--text3);margin-top:2px;">💬 ${c.request}</div>` : ''}
                <div style="font-size:11px;color:var(--text3);margin-top:4px;">${scheduleText(c)}</div>
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
            <td><input type="checkbox" class="ck-direct" data-id="${c.id}"></td>
            <td><strong style="cursor:pointer;color:var(--accent);text-decoration:underline dotted;" onclick="openEdit('${c.id}')">${c.name}</strong></td>
            <td style="white-space:nowrap;">${c.phone}</td>
            <td style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;color:#c020b0;cursor:pointer;text-decoration:underline dotted;" title="${c.addr}" onclick="showAddrModal('${c.id}')">${c.addr}</td>
            <td><span class="badge ${productBadgeClass(c.productId||c.set)}">${productLabel(c.productId||c.set)}</span></td>
            <td style="font-size:11px;color:var(--text3);white-space:nowrap;">${scheduleText(c)}</td>
            <td style="font-size:12px;">${c.door||'—'}</td>
            <td style="max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;color:var(--text2);" title="${c.request||''}">${c.request||'—'}</td>
            <td>${gauge(c)}</td>
            <td>${done?'<span class="badge b-ok">완료</span>':'<span class="badge b-wait">대기</span>'}</td>
            <td>${done?'':` <button class="btn btn-s sm" onclick="markDone('${c.id}','${ds}')">✓</button>`}</td>
          </tr>`;
        }).join('');
      }
    }
  }

  // ── 택배 필터 체크박스 적용 ──
  const allFilterCks = document.querySelectorAll('.today-filter-ck');
  const checkedVals = Array.from(allFilterCks).filter(el=>el.checked).map(el=>el.value);
  const totalCks    = allFilterCks.length;
  const SINGLE_PRODS = ['pork_rib','beef_la','beef_soup'];
  const filteredCourier = checkedVals.length === totalCks
    ? courierList  // 전체 체크 → 필터 없음
    : courierList.filter(c=>{
        const prod = c.productId || c.set || '';
        const isSingle = SINGLE_PRODS.indexOf(prod) !== -1;
        if(isSingle) return checkedVals.indexOf('single') !== -1;
        // A,B,C 세트
        return checkedVals.indexOf(prod) !== -1;
      });

  // ── 택배 테이블 ──
  const ctb = document.getElementById('courierList');
  if(ctb){
    ctb.innerHTML = !filteredCourier.length
      ? `<tr><td colspan="13"><div class="empty"><div class="ei">📦</div><div>택배 없음</div></div></td></tr>`
      : (window.innerWidth <= 768
          ? filteredCourier.map(c => {
              const done = (c.deliveredDates||[]).includes(ds);
              return `<tr class="${done?'trd':''}">
                <td colspan="13" style="padding:0;border:none;">
                  <div style="background:var(--surface);border:1px solid rgba(3,102,214,.15);border-radius:10px;margin:4px 0;padding:12px 14px;">
                    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
                      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                        <input type="checkbox" class="ck-courier" data-id="${c.id}">
                        <strong style="font-size:15px;cursor:pointer;color:var(--accent);" onclick="openEdit('${c.id}')">${c.name}</strong>
                        <span class="badge ${productBadgeClass(c.productId||c.set)}">${productLabel(c.productId||c.set)}</span>
                        <span class="badge ${c.orderType==='once'?'b-once':'b-sub'}">${c.orderType==='once'?'선택':'정기'}</span>
                      </div>
                      ${done
                        ? '<span class="badge b-ok">완료</span>'
                        : `<button class="btn btn-s sm" style="padding:6px 16px;" onclick="markDone('${c.id}','${ds}')">✓ 완료</button>`
                      }
                    </div>
                    <div style="font-size:12px;color:var(--text2);margin-bottom:4px;">📞 ${c.phone}</div>
                    <div style="font-size:12px;color:var(--accent);cursor:pointer;margin-bottom:4px;" onclick="showAddrModal('${c.id}')">📍 ${c.addr}</div>
                    ${c.door ? `<div style="font-size:12px;color:var(--text3);">🔑 현관: ${c.door}</div>` : ''}
                    ${c.request ? `<div style="font-size:12px;color:var(--text3);margin-top:2px;">💬 ${c.request}</div>` : ''}
                    <div style="display:flex;align-items:center;justify-content:space-between;margin-top:6px;">
                      <div style="font-size:11px;color:var(--text3);">${scheduleText(c)}</div>
                      <div>${gauge(c)}</div>
                    </div>
                  </div>
                </td>
              </tr>`;
            }).join('')
          : filteredCourier.map(c => {
              const done = (c.deliveredDates||[]).includes(ds);
              return `<tr class="${done?'trd':''}">
                <td><input type="checkbox" class="ck-courier" data-id="${c.id}"></td>
                <td><strong style="cursor:pointer;color:var(--accent);text-decoration:underline dotted;" onclick="openEdit('${c.id}')">${c.name}</strong></td>
                <td style="white-space:nowrap;">${c.phone}</td>
                <td style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;color:var(--accent);cursor:pointer;text-decoration:underline dotted;" title="${c.addr}" onclick="showAddrModal('${c.id}')">${c.addr}</td>
                <td><span class="badge ${productBadgeClass(c.productId||c.set)}">${productLabel(c.productId||c.set)}</span></td>
                <td><span class="badge ${c.orderType==='once'?'b-once':'b-sub'}">${c.orderType==='once'?'선택':'정기'}</span></td>
                <td style="font-size:11px;color:var(--text3);white-space:nowrap;">${scheduleText(c)}</td>
                <td style="font-size:12px;">${c.door||'—'}</td>
                <td style="max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;color:var(--text2);" title="${c.request||''}">${c.request||'—'}</td>
                <td>${gauge(c)}</td>
                <td>${done?'<span class="badge b-ok">완료</span>':'<span class="badge b-wait">대기</span>'}</td>
                <td>${done?'':` <button class="btn btn-s sm" onclick="markDone('${c.id}','${ds}')">✓</button>`}</td>
              </tr>`;
            }).join('')
        );
  }
}

// 택배 목록 인쇄
function printCourierList(){
  const ds = document.getElementById('todayDate').value || todayStr();
  const list = listFor(ds).filter(c=>!c.isDirect);
  const SINGLE_PRODS = ['pork_rib','beef_la','beef_soup'];
  const checkedVals = Array.from(document.querySelectorAll('.today-filter-ck:checked')).map(el=>el.value);
  const filtered = list.filter(c=>{
    const prod = c.productId||c.set||'';
    return SINGLE_PRODS.indexOf(prod)!==-1 ? checkedVals.indexOf('single')!==-1 : checkedVals.indexOf(prod)!==-1;
  });
  if(!filtered.length){ toast('출력할 내용 없음','er'); return; }

  const rows = filtered.map((c,i)=>`
    <tr>
      <td>${i+1}</td>
      <td><strong>${c.name}</strong></td>
      <td>${c.phone}</td>
      <td>${c.addr||''}</td>
      <td>${c.door||''}</td>
      <td>${productLabel(c.productId||c.set)}</td>
      <td>${scheduleText(c)}</td>
      <td>${c.request||''}</td>
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
    <h2>📦 택배 배송목록 · ${ds}</h2>
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
  const checkedVals = Array.from(document.querySelectorAll('.direct-filter-ck:checked')).map(el=>el.value);
  const filtered = list.filter(c=>{
    const prod = c.productId||c.set||'';
    const isSingle = ['pork_rib','beef_la','beef_soup'].indexOf(prod)!==-1;
    return isSingle ? checkedVals.indexOf('single')!==-1 : checkedVals.indexOf(prod)!==-1;
  });
  if(!filtered.length){ toast('출력할 직배송 내용 없음','er'); return; }

  const rows = filtered.map((c,i)=>`
    <tr>
      <td>${i+1}</td>
      <td><strong>${c.name}</strong></td>
      <td>${c.phone||''}</td>
      <td>${c.addr||''}</td>
      <td>${c.door||''}</td>
      <td>${productLabel(c.productId||c.set)}</td>
      <td>${scheduleText(c)}</td>
      <td>${c.request||''}</td>
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
    <button onclick="window.print()" style="margin-bottom:12px;padding:6px 16px;background:#1a6b3c;color:#fff;border:none;border-radius:6px;cursor:pointer;">🖨 인쇄</button>
    <table>
      <thead><tr><th>#</th><th>이름</th><th>연락처</th><th>주소</th><th>현관번호</th><th>세트</th><th>배송일정</th><th>요청사항</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    </body></html>`);
  win.document.close();
}

// 직배송 전체 완료
async function markAllDirect(){
  const ds = document.getElementById('todayDate').value || todayStr();
  const list = listFor(ds).filter(c=>c.isDirect);
  if(!list.length){ toast('직배송 없음','er'); return; }
  if(!confirm(list.length+'건 직배송 전체 완료?')) return;
  await Promise.all(list.map(c=>{
    if((c.deliveredDates||[]).includes(ds)) return;
    const rem = c.remain-1;
    return window.__DB.collection('customers').doc(c.id).update({
      remain:rem, deliveredDates:[...(c.deliveredDates||[]),ds], status:rem===0?'end':c.status
    });
  }));
  toast('직배송 전체 완료!','ok');
}

// 택배 전체 완료
async function markAllCourier(){
  const ds = document.getElementById('todayDate').value || todayStr();
  const list = listFor(ds).filter(c=>!c.isDirect);
  if(!list.length){ toast('택배 없음','er'); return; }
  if(!confirm(list.length+'건 택배 전체 완료?')) return;
  await Promise.all(list.map(c=>{
    if((c.deliveredDates||[]).includes(ds)) return;
    const rem = c.remain-1;
    return window.__DB.collection('customers').doc(c.id).update({
      remain:rem, deliveredDates:[...(c.deliveredDates||[]),ds], status:rem===0?'end':c.status
    });
  }));
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
             onclick="openEdit('${c.id}')">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
            <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
              <strong style="font-size:14px;">${c.name}</strong>
              <span class="badge ${productBadgeClass(c.productId||c.set)}">${productLabel(c.productId||c.set)}</span>
              <span class="badge ${c.orderType==='once'?'b-once':'b-sub'}">${c.orderType==='once'?'선택':'정기'}</span>
              ${c.isDirect?'<span class="badge b-direct">직배</span>':''}
            </div>
            <span class="badge b-${c.status}">${SL[c.status]}</span>
          </div>
          <div style="font-size:12px;color:var(--text2);margin-bottom:3px;">📞 ${c.phone}</div>
          <div style="font-size:11px;color:var(--text3);margin-bottom:6px;">${scheduleText(c)}</div>
          <div style="display:flex;align-items:center;justify-content:space-between;">
            <div>${gauge(c)}</div>
            <div style="display:flex;gap:6px;" onclick="event.stopPropagation()">
              ${c.orderType==='sub'?`<button class="btn sm" style="background:rgba(3,102,214,.1);color:#0366d6;border:1px solid rgba(3,102,214,.3);font-size:11px;" onclick="chargeRemain('${c.id}')">충전</button>`:''}
              <button class="btn btn-d sm" style="font-size:11px;" onclick="quickDelete('${c.id}','${c.name}')">삭제</button>
            </div>
          </div>
        </div>
      </td>
    </tr>`).join('');
  } else {
    tb.closest('table').style.minWidth = '';
    tb.innerHTML=list.map(c=>`<tr class="trc" onclick="showDet('${c.id}')">
      <td>
        <strong>${c.name}</strong>
        ${c.orderNum?`<div style="font-size:10px;color:var(--text3);margin-top:2px;">#${c.orderNum}</div>`:''}
      </td>
      <td style="white-space:nowrap;">${c.phone}</td>
      <td><span class="badge ${productBadgeClass(c.productId||c.set)}">${productLabel(c.productId||c.set)}</span></td>
      <td><span class="badge ${c.orderType==='once'?'b-once':'b-sub'}">${c.orderType==='once'?'선택':'정기'}</span></td>
      <td style="font-size:11px;color:var(--text3);max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${scheduleText(c)}</td>
      <td>${c.isDirect?'<span class="badge b-direct">직배송</span>':'<span style="font-size:11px;color:var(--text3);">택배</span>'}</td>
      <td>${gauge(c)}</td>
      <td><span class="badge b-${c.status}">${SL[c.status]}</span></td>
      <td style="display:flex;gap:4px;flex-wrap:wrap;">
        <button class="btn btn-g sm" onclick="event.stopPropagation();openEdit('${c.id}')">수정</button>
        ${c.orderType==='sub'?`<button class="btn sm" style="background:rgba(3,102,214,.1);color:#0366d6;border:1px solid rgba(3,102,214,.3);" onclick="event.stopPropagation();chargeRemain('${c.id}')">충전</button>`:''}
        <button class="btn btn-d sm" onclick="event.stopPropagation();quickDelete('${c.id}','${c.name}')">삭제</button>
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
    await window.__DB.collection('customers').doc(id).update({onceDate:newDate, startDate:newDate});
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
          <div style="font-size:16px;font-weight:700;">${c.name}</div>
          <span class="badge b-${c.status}">${SL[c.status]}</span>
        </div>
        <div style="display:flex;gap:6px;">
          <span class="badge ${productBadgeClass(c.productId||c.set)}">${productLabel(c.productId||c.set)}</span>
          <span class="badge ${c.orderType==='once'?'b-once':'b-sub'}">${c.orderType==='once'?'선택주문':'정기배송'}</span>
        </div>
      </div>
      <div class="dpb">
        <div class="dpr"><div class="dpl">연락처</div><div class="dpv">${c.phone}</div></div>
        <div class="dpr"><div class="dpl">배송지</div><div class="dpv" style="font-size:12px;">${c.addr}</div></div>
        <div class="dpr"><div class="dpl">현관번호</div><div class="dpv">${c.door||'—'}</div></div>
        <div class="dpr"><div class="dpl">요청사항</div><div class="dpv" style="font-size:12px;">${c.request||'—'}</div></div>
        <div class="dpr"><div class="dpl">배송일정</div><div class="dpv" style="font-size:12px;">${scheduleText(c)}</div></div>
        <div class="dpr"><div class="dpl">배송 방식</div><div class="dpv">${c.isDirect?'<span class="badge b-direct">🚗 직배송</span>':'<span style="font-size:12px;">📦 택배</span>'}</div></div>
        ${c.orderNum?`<div class="dpr"><div class="dpl">주문번호</div><div class="dpv" style="font-size:12px;font-family:monospace;">${c.orderNum}</div></div>`:''}
        ${c.qty&&c.qty>1?`<div class="dpr"><div class="dpl">수량</div><div class="dpv" style="font-weight:700;color:var(--accent);">${c.qty}개</div></div>`:''}
        ${c.onceDate?`<div class="dpr"><div class="dpl">배송예정일</div><div class="dpv">${c.onceDate}</div></div>`:''}
        ${c.orderType==='sub'?`
        <div class="dpr">
          <div class="dpl">잔여 횟수</div>
          <div style="margin-top:4px;">
            <div style="font-size:22px;font-weight:700;color:${isLow?'var(--danger)':'var(--accent)'};margin-bottom:6px;">${c.remain}<span style="font-size:13px;font-weight:400;color:var(--text3);"> / ${c.total}회</span></div>
            <div class="gt" style="height:6px;"><div class="gf ${isLow?'low':''}" style="width:${pct}%"></div></div>
          </div>
        </div>`:''}
        ${c.memo?`<div class="dpr"><div class="dpl">메모</div><div class="dpv" style="font-size:12px;background:var(--bg3);padding:8px;border-radius:4px;">${c.memo}</div></div>`:''}
        <div class="dpr">
          <div class="dpl">배송 이력 <span style="font-size:9px;color:var(--text3);">(클릭 → 취소)</span></div>
          <div style="margin-top:4px;">
            ${(c.deliveredDates||[]).slice(-5).reverse().map(d=>`
              <div class="dhi" style="display:flex;align-items:center;justify-content:space-between;">
                <span>✓ ${d}</span>
                <button onclick="undoMarkDone('${c.id}','${d}')" style="border:none;background:none;color:var(--danger);cursor:pointer;font-size:11px;padding:0 2px;" title="취소">↩</button>
              </div>`).join('')||'<div style="font-size:12px;color:var(--text3);">이력 없음</div>'}
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:8px;">
          <button class="btn btn-p" style="font-size:12px;" onclick="openEdit('${c.id}')">✏ 수정</button>
          <button class="btn btn-s" style="font-size:12px;" onclick="markDone('${c.id}')">✓ 배송완료</button>
          ${c.orderType==='sub'?`
          <button class="btn btn-g" style="font-size:12px;" onclick="togglePause('${c.id}')">${c.status==='pause'?'▶ 재개':'⏸ 일시정지'}</button>
          <button class="btn" style="font-size:12px;background:rgba(3,102,214,.1);color:#0366d6;border-color:rgba(3,102,214,.3);" onclick="chargeRemain('${c.id}')">＋ 횟수 충전</button>
          `:`
          <button class="btn btn-g" style="font-size:12px;grid-column:1/-1;" onclick="editOnceDate('${c.id}','${c.onceDate||''}')">📅 배송일 변경</button>
          `}
          <button class="btn btn-d" style="font-size:12px;grid-column:1/-1;" onclick="quickDelete('${c.id}','${c.name}')">🗑 삭제</button>
        </div>
      </div>
    </div>`;
}
