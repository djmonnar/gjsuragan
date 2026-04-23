// ════════════════════════════════════════
// 택배 내보내기
// ════════════════════════════════════════
function genExport(){
  const date=document.getElementById('expDate').value, sf=document.getElementById('expSet').value, tf=document.getElementById('expType').value;
  if(!date){toast('날짜를 선택해주세요','er');return;}
  let list=listFor(date);
  if(sf) list=list.filter(c=>c.set===sf);
  if(tf) list=list.filter(c=>c.orderType===tf);
  const tb=document.getElementById('expTbl');
  if(!list.length){
    document.getElementById('expTxt').textContent='해당 날짜 배송 없음.';
    tb.innerHTML=`<tr><td colspan="6"><div class="empty">배송 건 없음</div></td></tr>`;
    return;
  }
  tb.innerHTML=list.map((c,i)=>`<tr>
    <td style="color:var(--text3);">${i+1}</td><td><strong>${c.name}</strong></td>
    <td style="white-space:nowrap;">${c.phone}</td>
    <td style="font-size:11px;">${c.addr}</td>
    <td><span class="badge ${productBadgeClass(c.productId||c.set)}">${productLabel(c.productId||c.set)}</span></td>
    <td style="font-size:11px;color:var(--text2);">${c.request||''}</td>
  </tr>`).join('');
  const directList  = list.filter(c=>c.isDirect);
  const courierList = list.filter(c=>!c.isDirect);
  let txt=`===== 궁중수라간 발송 목록 =====\n날짜  : ${date} (${DAYS[dow(date)]}요일)\n총 ${list.length}건 (직배송 ${directList.length}건 / 택배 ${courierList.length}건)\n생성  : ${new Date().toLocaleString('ko-KR')}\n`;

  if(directList.length){
    txt+=`\n${'━'.repeat(40)}\n🚗 직배송 (${directList.length}건)\n${'─'.repeat(40)}`;
    directList.forEach((c,i)=>{
      txt+=`\n[직${String(i+1).padStart(2,'0')}] ${c.name}\n     전화: ${c.phone}\n     주소: ${c.addr}\n     상품: ${productLabel(c.productId||c.set)}`;
      if(c.qty&&c.qty>1) txt+=` x${c.qty}개`;
      if(c.door)    txt+=`\n     현관: ${c.door}`;
      if(c.request) txt+=`\n     요청: ${c.request}`;
      txt+='\n';
    });
  }
  if(courierList.length){
    txt+=`\n${'━'.repeat(40)}\n📦 택배 (${courierList.length}건)\n${'─'.repeat(40)}`;
    courierList.forEach((c,i)=>{
      txt+=`\n[택${String(i+1).padStart(2,'0')}] ${c.name} (${c.orderType==='once'?'선택':'정기'})\n     전화: ${c.phone}\n     주소: ${c.addr}\n     상품: ${productLabel(c.productId||c.set)}`;
      if(c.qty&&c.qty>1) txt+=` x${c.qty}개`;
      if(c.door)    txt+=`\n     현관: ${c.door}`;
      if(c.request) txt+=`\n     요청: ${c.request}`;
      txt+='\n';
    });
  }
  txt+=`\n${'━'.repeat(40)}\nEND`;
  document.getElementById('expTxt').textContent=txt;
}
function copyExp(){navigator.clipboard.writeText(document.getElementById('expTxt').textContent).then(()=>toast('복사됨!','ok'));}
function dlExp(){
  const date=document.getElementById('expDate').value||todayStr();
  const blob=new Blob([document.getElementById('expTxt').textContent],{type:'text/plain;charset=utf-8'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`궁중수라간_발송목록_${date}.txt`;a.click();
  toast('파일 저장 완료','ok');
}

// ════════════════════════════════════════
// 텍스트 파싱
// ════════════════════════════════════════
function parseText(){
  const raw=document.getElementById('pasteArea').value.trim();
  if(!raw){toast('텍스트를 붙여넣어 주세요','er');return;}
  const lines=raw.split('\n').map(l=>l.trim()).filter(Boolean);

  const phoneReg=/01[016789]-?\d{3,4}-?\d{4}/;
  const addrReg=/\(?\d{5}\)?\s+.+/;

  // ── 전화번호: 마지막 등장 번호 (배송지 정보 기준) ──
  const allPhones=[];
  for(let i=0;i<lines.length;i++){
    const m=lines[i].match(phoneReg);
    if(m) allPhones.push({phone:m[0],idx:i});
  }
  const mainPhone = allPhones.length ? allPhones[allPhones.length-1].phone : '';
  const lastPhoneIdx = allPhones.length ? allPhones[allPhones.length-1].idx : -1;

  // ── 이름: 마지막 전화번호 바로 위 줄 ──
  let mainName='';
  if(lastPhoneIdx>0){
    let cand=lines[lastPhoneIdx-1].replace(/\s*\(비회원\)\s*/g,'').trim();
    if(!/[0-9]{6,}|오전|오후|취소|완료|주문|배송|결제|원$/.test(cand)&&cand.length>=1&&cand.length<=15)
      mainName=cand;
  }

  // ── 주소 ──
  let mainAddr='';
  for(const l of lines){
    if(addrReg.test(l)){ mainAddr=l.replace(/^\(?\d{5}\)?\s*/,'').trim(); break; }
  }

  // ── 현관번호 / 요청사항 ──
  let door='', request='';
  for(let i=0;i<lines.length;i++){
    const l=lines[i];
    if(/현관|비밀번호/i.test(l)&&!door){
      const combined=(l+' '+(lines[i+1]||'')).replace(/현관\s*비밀번호\s*[:：]?/i,'').trim();
      door=combined.split('\n')[0].trim();
    }
    if(/배송\s*전|미리\s*연락|부재|문\s*앞|두고\s*가|놓아/i.test(l)) request=l;
  }

  // ── 복수 주문 감지: "-001", "-002" 등 섹션번호로 분리 ──
  // 섹션번호 패턴: 주문번호-001, 주문번호-002 ...
  const sectionPat=/^\d{10,}-\d{3}$/;
  const sectionIdxs=[];
  for(let i=0;i<lines.length;i++){
    if(sectionPat.test(lines[i])) sectionIdxs.push(i);
  }

  // 날짜 파싱 헬퍼: "3월 27일 금요일" → "2026-03-27"
  function parseDateKo(str){
    const m=str.match(/(\d{1,2})월[\s\.\-]*(\d{1,2})일/);
    if(!m) return '';
    const y=new Date().getFullYear();
    const mo=String(m[1]).padStart(2,'0');
    const d=String(m[2]).padStart(2,'0');
    return `${y}-${mo}-${d}`;
  }

  // 상품ID 파싱 헬퍼
  function parseProduct(str){
    if(/[ABC]세트/i.test(str)){
      const m=str.match(/([ABC])세트/i); return m?m[1].toUpperCase():'';
    }
    if(/수제.*돼지.*갈비|돼지.*양념.*갈비|수제양념돼지갈비/i.test(str)) return 'pork_rib';
    if(/양념.*LA.*갈비|LA.*갈비|라갈비/i.test(str)) return 'beef_la';
    return '';
  }

  // ── 섹션이 2개 이상 → 복수 주문 ──
  if(sectionIdxs.length>=2){
    const orders=[];
    for(let si=0;si<sectionIdxs.length;si++){
      const from=sectionIdxs[si];
      const to=si+1<sectionIdxs.length ? sectionIdxs[si+1] : lines.length;
      const seg=lines.slice(from,to);
      // 날짜: "3월 XX일" 패턴
      let onceDate=''; let prodId=''; let qty=1;
      for(const l of seg){
        if(!onceDate&&/\d{1,2}월[\s\.\-]*\d{1,2}일/.test(l)) onceDate=parseDateKo(l);
        if(!prodId) prodId=parseProduct(l);
        const qm=l.match(/^(\d+)\s*개$/);
        if(qm) qty=parseInt(qm[1])||1;
      }
      if(prodId||onceDate) orders.push({onceDate,prodId,qty});
    }
    // 복수주문 결과 표시
    parsedData={
      _multi: true,
      orders,
      name: mainName, phone: mainPhone,
      addr: mainAddr, door, request,
    };
    // 미리보기
    let rowsHtml=`
      <div style="font-size:11px;font-weight:700;color:var(--text3);margin-bottom:8px;">📦 ${orders.length}건의 주문이 감지되었습니다</div>
      <div class="prr"><div class="prk">이름</div><div class="prv">${mainName||'(미인식)'}</div></div>
      <div class="prr"><div class="prk">연락처</div><div class="prv">${mainPhone||'(미인식)'}</div></div>
      <div class="prr"><div class="prk">주소</div><div class="prv">${mainAddr||'(미인식)'}</div></div>
      <div class="prr"><div class="prk">현관번호</div><div class="prv">${door||'—'}</div></div>
      <div class="prr"><div class="prk">요청사항</div><div class="prv">${request||'—'}</div></div>
      <div style="height:1px;background:var(--border);margin:8px 0;"></div>`;
    orders.forEach((o,i)=>{
      rowsHtml+=`
      <div style="background:var(--bg3);border-radius:6px;padding:8px 10px;margin-bottom:6px;">
        <div style="font-size:11px;font-weight:700;color:var(--accent);margin-bottom:4px;">주문 ${i+1}</div>
        <div class="prr"><div class="prk">배송일</div><div class="prv">${o.onceDate||'(미인식)'}</div></div>
        <div class="prr"><div class="prk">상품</div><div class="prv">${o.prodId?productLabel(o.prodId):'(미인식)'}</div></div>
        <div class="prr"><div class="prk">수량</div><div class="prv">${o.qty}개</div></div>
      </div>`;
    });
    document.getElementById('parseRows').innerHTML=rowsHtml;
    document.getElementById('parseResult').classList.add('on');
    toast(`${orders.length}건 복수 주문 감지! 확인 후 등록하세요`,'info');
    return;
  }

  // ── 단일 주문 파싱 ──
  // 주문번호 파싱: 숫자 15자리 이상 단독 줄
  let parsedOrderNum='';
  for(const l of lines){
    if(/^\d{15,20}$/.test(l)){ parsedOrderNum=l; break; }
  }
  const p={name:mainName,phone:mainPhone,addr:mainAddr,door,request,set:'',productId:'',qty:1,orderType:'once',orderNum:parsedOrderNum};

  for(let i=0;i<lines.length;i++){
    const l=lines[i];
    if(!p.set&&/[ABC]세트/i.test(l)){const m=l.match(/([ABC])세트/i);if(m)p.set=m[1].toUpperCase();}
    if(!p.productId){
      if(/수제.*돼지.*갈비|돼지.*양념.*갈비|수제양념돼지갈비|돼지갈비/i.test(l)) p.productId='pork_rib';
      else if(/양념.*LA.*갈비|LA.*갈비|라갈비/i.test(l)) p.productId='beef_la';
    }
    if(!p.qty||p.qty===1){
      const qm=l.match(/^(\d+)\s*개$/) || l.match(/수량\s*[:：]?\s*(\d+)/);
      if(qm) p.qty=parseInt(qm[1])||1;
    }
    if(/정기/.test(l)) p.orderType='sub';
  }
  if(p.productId&&!p.set) p.set=p.productId;
  else if(p.set&&!p.productId&&['A','B','C'].includes(p.set)) p.productId=p.set;

  parsedData=p;
  const prodDisplay=p.productId?productLabel(p.productId):(p.set?p.set+'세트':'(직접 선택)');
  document.getElementById('parseRows').innerHTML=[
    ['이름',p.name||'(미인식)'],['연락처',p.phone||'(미인식)'],
    ['주소',p.addr||'(미인식)'],['현관번호',p.door||'—'],
    ['요청사항',p.request||'—'],['상품',prodDisplay],
    ['수량',p.qty+'개'],['유형',p.orderType==='sub'?'정기배송':'선택주문'],
  ].map(([k,v])=>`<div class="prr"><div class="prk">${k}</div><div class="prv">${v}</div></div>`).join('');
  document.getElementById('parseResult').classList.add('on');
  toast('인식 완료. 확인 후 등록하세요','info');
}

// 파싱 후 모달 열기
function regParsed(){
  if(!parsedData){ toast('먼저 분석을 실행하세요','er'); return; }
  const p = parsedData;
  const t = todayStr();

  // 공통 기본 정보 채우기
  document.getElementById('pm-name').value  = p.name  || '';
  document.getElementById('pm-phone').value = p.phone || '';
  document.getElementById('pm-addr').value  = p.addr  || '';
  document.getElementById('pm-door').value  = p.door  || '';
  document.getElementById('pm-req').value   = p.request || '';
  document.getElementById('pm-memo').value  = '';

  if(p._multi){
    // ── 복수 주문 모드 ──
    document.getElementById('parseMTitle').textContent = `주문 확인 및 수정 (${p.orders.length}건)`;
    document.getElementById('pm-single').style.display = 'none';
    document.getElementById('pm-multi').style.display  = 'block';
    renderPmOrderList(p.orders);
  } else {
    // ── 단일 주문 모드 ──
    document.getElementById('parseMTitle').textContent = '주문 확인 및 수정';
    document.getElementById('pm-single').style.display = 'block';
    document.getElementById('pm-multi').style.display  = 'none';
    const ot = p.orderType || 'once';
    pmSetOrderType(ot);
    if(ot === 'once'){
      document.getElementById('pm-prod').value  = p.productId || p.set || '';
      document.getElementById('pm-date').value  = p.onceDate  || t;
      document.getElementById('pm-qty').value   = p.qty || 1;
    } else {
      document.getElementById('pm-set').value   = p.set || '';
      document.getElementById('pm-total').value = p.total || 12;
      document.getElementById('pm-start').value = p.startDate || t;
    }
  }
  // 주문번호·직배송 채우기
  const pmOn = document.getElementById('pm-ordernum');
  const pmDr = document.getElementById('pm-direct');
  if(pmOn) pmOn.value = p.orderNum||'';
  if(pmDr) pmDr.checked = !!(p.isDirect);
  openM('parseM');
}

// 복수주문 목록 렌더링
function renderPmOrderList(orders){
  const wrap = document.getElementById('pm-order-list');
  wrap.innerHTML = orders.map((o,i) => `
    <div class="pm-order-item" id="pm-ord-${i}" style="background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:14px;margin-bottom:8px;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
        <span style="font-size:12px;font-weight:700;color:var(--accent);">주문 ${i+1}</span>
        <button class="btn btn-d sm" onclick="pmRemoveOrder(${i})">✕ 제외</button>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 80px;gap:10px;">
        <div class="fgrp">
          <div class="flab">상품 *</div>
          <select class="inp" id="pm-ord-prod-${i}">
            <option value="">선택</option>
            <optgroup label="반찬 세트">
              <option value="A" ${o.prodId==='A'?'selected':''}>A세트</option>
              <option value="B" ${o.prodId==='B'?'selected':''}>B세트</option>
              <option value="C" ${o.prodId==='C'?'selected':''}>C세트</option>
            </optgroup>
            <optgroup label="단품 상품">
              <option value="pork_rib" ${o.prodId==='pork_rib'?'selected':''}>🥩 수제 돼지양념갈비</option>
              <option value="beef_la"  ${o.prodId==='beef_la' ?'selected':''}>🥩 양념 LA갈비</option>
            </optgroup>
          </select>
        </div>
        <div class="fgrp">
          <div class="flab">배송 예정일 *</div>
          <input type="date" class="inp" id="pm-ord-date-${i}" value="${o.onceDate||''}">
        </div>
        <div class="fgrp">
          <div class="flab">수량</div>
          <input type="number" class="inp" id="pm-ord-qty-${i}" value="${o.qty||1}" min="1" max="99" style="text-align:center;font-weight:700;">
        </div>
      </div>
    </div>`).join('');
  // 인덱스 저장
  wrap.dataset.count = orders.length;
}

function pmRemoveOrder(i){
  const item = document.getElementById('pm-ord-'+i);
  if(item) item.remove();
  // 남은 건수 표시 업데이트
  const remaining = document.querySelectorAll('[id^="pm-ord-"][id$="-0"], [id^="pm-ord-prod-"]').length;
}

function pmAddOrder(){
  const wrap = document.getElementById('pm-order-list');
  const i = parseInt(wrap.dataset.count || 0);
  wrap.dataset.count = i+1;
  const div = document.createElement('div');
  div.innerHTML = `
    <div class="pm-order-item" id="pm-ord-${i}" style="background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:14px;margin-bottom:8px;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
        <span style="font-size:12px;font-weight:700;color:var(--accent);">주문 추가</span>
        <button class="btn btn-d sm" onclick="pmRemoveOrder(${i})">✕ 제외</button>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 80px;gap:10px;">
        <div class="fgrp"><div class="flab">상품 *</div>
          <select class="inp" id="pm-ord-prod-${i}">
            <option value="">선택</option>
            <optgroup label="반찬 세트">
              <option value="A">A세트</option><option value="B">B세트</option><option value="C">C세트</option>
            </optgroup>
            <optgroup label="단품 상품">
              <option value="pork_rib">🥩 수제 돼지양념갈비</option>
              <option value="beef_la">🥩 양념 LA갈비</option>
            </optgroup>
          </select>
        </div>
        <div class="fgrp"><div class="flab">배송 예정일 *</div>
          <input type="date" class="inp" id="pm-ord-date-${i}" value="${todayStr()}">
        </div>
        <div class="fgrp"><div class="flab">수량</div>
          <input type="number" class="inp" id="pm-ord-qty-${i}" value="1" min="1" max="99" style="text-align:center;font-weight:700;">
        </div>
      </div>
    </div>`;
  wrap.appendChild(div.firstElementChild);
}

// 단일주문 유형 전환
function pmSetOrderType(ot){
  const isOnce = ot==='once';
  document.getElementById('pm-prod-wrap').style.display  = isOnce?'':'none';
  document.getElementById('pm-date-wrap').style.display  = isOnce?'':'none';
  document.getElementById('pm-qty-wrap').style.display   = isOnce?'':'none';
  document.getElementById('pm-set-wrap').style.display   = isOnce?'none':'';
  document.getElementById('pm-freq-wrap').style.display  = isOnce?'none':'';
  document.getElementById('pm-sched-wrap').style.display = isOnce?'none':'';
  document.getElementById('pm-total-wrap').style.display = isOnce?'none':'';
  document.getElementById('pm-start-wrap').style.display = isOnce?'none':'';
}

function pmChangeQty(d){
  const el=document.getElementById('pm-qty');
  el.value=Math.max(1,Math.min(99,(parseInt(el.value)||1)+d));
}

function pmUpdSch(){
  const tp=document.getElementById('pm-freq').value;
  const sel=document.getElementById('pm-sched');
  sel.innerHTML='';
  if(!tp){sel.innerHTML='<option>주기를 먼저 선택하세요</option>';return;}
  SCH[tp].forEach((sc,i)=>{const o=document.createElement('option');o.value=i;o.textContent=sc.l;sel.appendChild(o);});
}

// 최종 저장
async function saveParsed(){
  const name  = document.getElementById('pm-name').value.trim();
  const phone = document.getElementById('pm-phone').value.trim();
  const addr  = document.getElementById('pm-addr').value.trim();
  const door  = document.getElementById('pm-door').value.trim();
  const req   = document.getElementById('pm-req').value.trim();
  const memo  = document.getElementById('pm-memo').value.trim();

  if(!name) { toast('주문자명을 입력하세요','er'); return; }
  if(!phone){ toast('연락처를 입력하세요','er'); return; }
  if(!addr) { toast('주소를 입력하세요','er'); return; }

  const isDirect = document.getElementById('pm-direct')?.checked||false;
  const orderNum = document.getElementById('pm-ordernum')?.value.trim()||'';
  const base = {
    name, phone, addr, door, request:req, memo:memo||'자동 등록 (텍스트 파싱)',
    status:'active', deliveredDates:[], createdAt:new Date().toISOString(),
    isDirect, orderNum,
  };

  const isMulti = document.getElementById('pm-multi').style.display !== 'none';

  if(isMulti){
    // 복수 주문 수집
    const items = document.querySelectorAll('#pm-order-list .pm-order-item');
    if(!items.length){ toast('등록할 주문이 없습니다','er'); return; }
    let ok=0, errs=[];
    for(const item of items){
      const id = item.id.replace('pm-ord-','');
      const prod  = document.getElementById('pm-ord-prod-'+id)?.value||'';
      const date  = document.getElementById('pm-ord-date-'+id)?.value||'';
      const qty   = parseInt(document.getElementById('pm-ord-qty-'+id)?.value)||1;
      if(!prod){ errs.push(`주문${parseInt(id)+1}: 상품 미선택`); continue; }
      if(!date){ errs.push(`주문${parseInt(id)+1}: 날짜 미입력`); continue; }
      const data={
        ...base, orderType:'once', set:prod, productId:prod,
        total:qty, remain:qty, qty,
        onceDate:date, startDate:date,
        scheduleName:productLabel(prod)+(qty>1?' x'+qty+'개':''),
        arriveDays:[], cookDays:[],
      };
      try{ await window.__DB.collection('customers').add(data); ok++; }
      catch(e){ errs.push('저장 오류: '+e.message); }
    }
    if(errs.length) toast(errs.join(' / '),'er');
    if(ok>0){ closeM('parseM'); clearParse(); toast(name+' '+ok+'건 등록 완료!','ok'); }

  } else {
    // 단일 주문
    const isSub = document.getElementById('pm-set-wrap').style.display !== 'none';
    let data = {...base, orderType: isSub?'sub':'once'};

    if(isSub){
      const s   = document.getElementById('pm-set').value;
      const tp  = document.getElementById('pm-freq').value;
      const si  = document.getElementById('pm-sched').value;
      const tot = parseInt(document.getElementById('pm-total').value)||0;
      const sd  = document.getElementById('pm-start').value;
      if(!s)  { toast('세트를 선택하세요','er'); return; }
      if(!tp) { toast('배송 주기를 선택하세요','er'); return; }
      if(si===''){ toast('배송 일정을 선택하세요','er'); return; }
      if(!tot){ toast('총 구독 횟수를 입력하세요','er'); return; }
      if(!sd) { toast('시작일을 선택하세요','er'); return; }
      const sch=SCH[tp][parseInt(si)];
      Object.assign(data,{set:s,productId:s,type:parseInt(tp),
        scheduleName:sch.l, cookDays:sch.c, arriveDays:sch.a,
        total:tot, remain:tot, startDate:sd});
    } else {
      const prod = document.getElementById('pm-prod').value;
      const date = document.getElementById('pm-date').value;
      const qty  = parseInt(document.getElementById('pm-qty').value)||1;
      if(!prod){ toast('상품을 선택하세요','er'); return; }
      if(!date){ toast('배송 예정일을 입력하세요','er'); return; }
      Object.assign(data,{set:prod, productId:prod,
        total:qty, remain:qty, qty,
        onceDate:date, startDate:date,
        scheduleName:productLabel(prod)+(qty>1?' x'+qty+'개':''),
        arriveDays:[], cookDays:[]});
    }
    try{
      await window.__DB.collection('customers').add(data);
      closeM('parseM'); clearParse(); toast(name+' 등록 완료!','ok');
    } catch(e){ toast('등록 오류: '+e.message,'er'); }
  }
}

function clearParse(){
  document.getElementById('pasteArea').value='';
  document.getElementById('parseResult').classList.remove('on');
  parsedData=null;
}

// ════════════════════════════════════════
// 엑셀 (스마트스토어 양식 기준)
// 컬럼 인덱스 (0-based):
//  0:판매채널  1:주문번호  2:주문상태  3:총품목합계  4:총할인  5:총배송비
//  6:총포인트  7:최종주문금액  8:주문자이름  9:이메일  10:주문자번호
//  11:배송방식  12:배송비결제  13:송장번호  14:주문섹션번호  15:주문섹션품목번호
//  16:구매수량  17:상품명  18:옵션명  19:판매가  ...
//  24:수령자명  25:수령자전화  26:국가코드  27:우편번호  28:주소  29:상세주소
//  30:배송메모  31:택배사명  32:취소사유  33:반품사유  34:취소상세  35:반품상세
//  36:주문일  37:상품고유번호
// ════════════════════════════════════════

function parseXlRow(r){
  // 세트 파싱 (상품명·옵션명에서 A/B/C세트 추출)
  const productName = String(r[17]||r[18]||'');
  const optionName  = String(r[18]||'');
  let set = '';
  const setMatch = (productName+' '+optionName).match(/([ABC])세트/i);
  if(setMatch) set = setMatch[1].toUpperCase();

  // 주문유형 (상품명 or 옵션명에서 정기/선택 판별)
  const isRegular = /정기/.test(productName+optionName);

  // 주소 합치기 (주소 + 상세주소)
  const addr = [String(r[28]||''), String(r[29]||'')].filter(Boolean).join(' ').trim();

  // 수령자명: 24번. 없으면 주문자(8번)
  const name = String(r[24]||r[8]||'').trim();

  // 전화: 25번(수령자). 없으면 주문자(10번)
  const phone = String(r[25]||r[10]||'').trim();

  // 배송메모: 30번
  const request = String(r[30]||'').trim();

  // 주문번호: 1번 (섹션품목번호 15번)
  const orderNum = String(r[15]||r[1]||'').trim();

  // 주문상태
  const status = String(r[2]||'').trim();

  // 현관비밀번호: 배송메모에서 추출 시도
  let door = '';
  const doorMatch = request.match(/현관\s*비밀번호\s*[:：]?\s*(\S+)/i)
    || request.match(/공동\s*현관\s*[:：]?\s*(\S+)/i);
  if(doorMatch) door = doorMatch[1];

  return { name, phone, addr, door, request, set, orderType: isRegular?'sub':'once', orderNum, orderStatus: status };
}

function dzOver(e){e.preventDefault();document.getElementById('dz').classList.add('drag');}
function dzLeave(){document.getElementById('dz').classList.remove('drag');}
function dzDrop(e){e.preventDefault();dzLeave();const f=e.dataTransfer.files[0];if(f)procXl(f);}
function readXl(inp){if(inp.files[0])procXl(inp.files[0]);}

function procXl(file){
  const r=new FileReader();
  r.onload=e=>{
    try{
      const wb=XLSX.read(e.target.result,{type:'binary'});
      const ws=wb.Sheets[wb.SheetNames[0]];
      const rows=XLSX.utils.sheet_to_json(ws,{header:1,defval:''});

      // 1행 = 헤더, 2행부터 데이터. 이름(수령자) 있는 행만
      const dataRows = rows.slice(1).filter(r => String(r[24]||r[8]||'').trim());
      xlData = dataRows.map(parseXlRow);

      // 중복제거: 같은 이름+연락처 조합
      const seen = new Set();
      xlData = xlData.filter(c => {
        const key = c.name+'|'+c.phone;
        if(seen.has(key)) return false;
        seen.add(key); return true;
      });

      document.getElementById('xlCnt').textContent = xlData.length+'건';
      renderXlPreview();
      document.getElementById('xlWrap').style.display='block';
      toast(xlData.length+'건 인식됨 (중복 제거 완료)','info');
    }catch(err){ toast('엑셀 오류: '+err.message,'er'); }
  };
  r.readAsBinaryString(file);
}

function renderXlPreview(){
  document.getElementById('xlPrev').innerHTML = xlData.map((c,i)=>`
    <tr id="xlrow-${i}">
      <td>${i+1}</td>
      <td><strong>${c.name}</strong></td>
      <td style="white-space:nowrap;">${c.phone}</td>
      <td style="font-size:11px;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${c.addr}">${c.addr}</td>
      <td>
        <select class="inp inp-sm" onchange="xlData[${i}].set=this.value" style="width:80px;">
          <option value="" ${!c.set?'selected':''}>미정</option>
          <option value="A" ${c.set==='A'?'selected':''}>A세트</option>
          <option value="B" ${c.set==='B'?'selected':''}>B세트</option>
          <option value="C" ${c.set==='C'?'selected':''}>C세트</option>
        </select>
      </td>
      <td><span class="badge ${c.orderType==='sub'?'b-sub':'b-once'}">${c.orderType==='sub'?'정기':'선택'}</span></td>
      <td style="font-size:11px;color:var(--text3);max-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${c.request}">${c.request||'—'}</td>
      <td>
        <button class="btn btn-d sm" onclick="xlData.splice(${i},1);renderXlPreview();document.getElementById('xlCnt').textContent=xlData.length+'건';">✕</button>
      </td>
    </tr>`).join('');
}

async function regXl(){
  if(!xlData.length){ toast('데이터 없음','er'); return; }
  const noSet = xlData.filter(c=>!c.set);
  if(noSet.length){
    toast(`세트 미선택 ${noSet.length}건이 있습니다. 모두 선택 후 등록하세요.`,'er'); return;
  }
  if(!confirm(xlData.length+'건을 모두 등록하시겠습니까?')) return;
  const t=todayStr(); let ok=0;
  try{
    for(const c of xlData){
      const data={
        name:c.name, phone:c.phone, addr:c.addr, door:c.door||'',
        request:c.request||'', set:c.set, memo:`주문번호: ${c.orderNum||''}`,
        status:'active', deliveredDates:[], createdAt:new Date().toISOString(),
        orderType:c.orderType, total:1, remain:1,
        scheduleName:c.orderType==='sub'?'정기배송':'선택주문 (1회)',
        arriveDays:[], startDate:t, onceDate:c.orderType==='once'?t:''
      };
      await window.__DB.collection('customers').add(data); ok++;
    }
    toast(ok+'건 등록 완료!','ok');
    resetXl();
  }catch(e){ toast(`오류 (${ok}건 완료 후 중단): `+e.message,'er'); }
}

function resetXl(){
  xlData=[];
  document.getElementById('xlWrap').style.display='none';
  document.getElementById('xlf').value='';
  document.getElementById('xlPrev').innerHTML='';
  document.getElementById('xlCnt').textContent='';
  toast('초기화 완료','ok');
}
