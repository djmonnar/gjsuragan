// ════════════════════════════════════════
// 아임웹 API 연동
// ════════════════════════════════════════
const IW_KEY_STORE = 'iw_keys';
let iwOrders = []; // 불러온 주문 목록

function imwebSaveKeys(){
  const ak = document.getElementById('iw-apikey').value.trim();
  const sk = document.getElementById('iw-secret').value.trim();
  if(!ak || !sk){ toast('API Key와 Secret Key를 모두 입력하세요','er'); return; }
  localStorage.setItem(IW_KEY_STORE, JSON.stringify({ak, sk}));
  toast('저장 완료! 연결을 확인합니다...','info');
  imwebTestConn();
}

function imwebLoadKeys(){
  const s = localStorage.getItem(IW_KEY_STORE);
  if(!s) return null;
  try{ return JSON.parse(s); } catch(e){ return null; }
}

function imwebClearKeys(){
  if(!confirm('저장된 API 키를 삭제하시겠습니까?')) return;
  localStorage.removeItem(IW_KEY_STORE);
  document.getElementById('iw-apikey').value = '';
  document.getElementById('iw-secret').value = '';
  document.getElementById('imweb-conn-status').textContent = '미연결';
  document.getElementById('imweb-conn-status').style.color = 'var(--text3)';
  toast('키 삭제 완료','ok');
}

function imwebToggleShow(el){
  const t = el.checked ? 'text' : 'password';
  document.getElementById('iw-apikey').type = t;
  document.getElementById('iw-secret').type = t;
}

// 연결 테스트 (site_code 조회로 확인)
async function imwebTestConn(){
  const keys = imwebLoadKeys();
  if(!keys){ setConnStatus(false); return; }
  try{
    const token = await imwebGetToken(keys.ak, keys.sk);
    if(token){
      setConnStatus(true);
      toast('아임웹 연결 성공!','ok');
    } else {
      setConnStatus(false);
    }
  } catch(e){
    setConnStatus(false);
    toast('연결 실패: '+e.message,'er');
  }
}

function setConnStatus(ok){
  const el = document.getElementById('imweb-conn-status');
  el.textContent = ok ? '🟢 연결됨' : '🔴 연결 실패';
  el.style.color = ok ? 'var(--accent)' : 'var(--danger)';
}

// 아임웹 Access Token 발급
async function imwebGetToken(apiKey, secret){
  const res = await fetch('https://api.imweb.me/v2/auth', {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify({key: apiKey, secret: secret})
  });
  if(!res.ok) throw new Error('인증 실패 ('+res.status+')');
  const data = await res.json();
  if(data.code !== 200) throw new Error(data.msg || '인증 오류');
  return data.data?.access_token;
}

// 주문 불러오기
async function imwebFetch(){
  const keys = imwebLoadKeys();
  if(!keys){ toast('먼저 API 키를 저장해주세요','er'); goTab('imweb'); return; }

  const from   = document.getElementById('iw-from').value;
  const to     = document.getElementById('iw-to').value;
  const status = document.getElementById('iw-status').value;

  if(!from || !to){ toast('조회 기간을 선택해주세요','er'); return; }

  document.getElementById('iw-loading').style.display = 'block';
  document.getElementById('iw-result-wrap').style.display = 'none';
  document.getElementById('iw-fetch-btn').disabled = true;

  try{
    const token = await imwebGetToken(keys.ak, keys.sk);

    // 기존 주문번호 목록 (중복 방지)
    const existingOrderNums = new Set(custs.map(c=>c.orderNum||'').filter(Boolean));

    let params = `order_date_from=${from.replace(/-/g,'')}&order_date_to=${to.replace(/-/g,'')}`;
    if(status) params += `&status=${status}`;
    params += '&limit=100';

    const res = await fetch(`https://api.imweb.me/v2/shop/orders?${params}`, {
      headers:{'Content-Type':'application/json', 'access-token': token}
    });
    if(!res.ok) throw new Error('주문 조회 실패 ('+res.status+')');
    const data = await res.json();
    if(data.code !== 200) throw new Error(data.msg || '조회 오류');

    const orders = data.data?.list || [];
    // 이미 등록된 주문번호 제외
    iwOrders = orders.filter(o => !existingOrderNums.has(String(o.order_no)));

    document.getElementById('iw-cnt').textContent = `${iwOrders.length}건 (전체 ${orders.length}건 중 미등록)`;
    renderImwebOrders();
    document.getElementById('iw-result-wrap').style.display = 'block';
    toast(`${iwOrders.length}건 불러옴 (기등록 ${orders.length - iwOrders.length}건 제외)`,'info');

  } catch(e){
    toast('오류: '+e.message,'er');
    // CORS 오류 안내
    if(e.message.includes('fetch') || e.message.includes('Failed')){
      toast('CORS 오류 - 아래 안내를 확인하세요','er');
    }
  } finally{
    document.getElementById('iw-loading').style.display = 'none';
    document.getElementById('iw-fetch-btn').disabled = false;
  }
}

// 상품명에서 세트/상품 자동 파싱
function parseImwebProduct(prodName){
  if(!prodName) return '';
  const s = prodName.toUpperCase();
  if(/A세트|A-|A_|A\s/.test(prodName)) return 'A';
  if(/B세트|B-|B_|B\s/.test(prodName)) return 'B';
  if(/C세트|C-|C_|C\s/.test(prodName)) return 'C';
  if(/돼지.*갈비|양념.*갈비|돼지갈비/.test(prodName)) return 'pork_rib';
  if(/LA.*갈비|라갈비/.test(prodName)) return 'beef_la';
  // 옵션에서 다시 시도
  const m = prodName.match(/([ABC])세트/i);
  if(m) return m[1].toUpperCase();
  return '';
}

function renderImwebOrders(){
  const tbody = document.getElementById('iw-tbody');
  if(!iwOrders.length){
    tbody.innerHTML = `<tr><td colspan="11"><div class="empty"><div class="ei">📭</div><div>불러온 주문 없음</div></div></td></tr>`;
    return;
  }
  tbody.innerHTML = iwOrders.map((o,i)=>{
    const recv   = o.order_info?.recv || {};
    const items  = o.product_list || [];
    const prod0  = items[0] || {};
    const prodName = (prod0.prod_name||'')+(prod0.opt_name?' / '+prod0.opt_name:'');
    const autoProd = parseImwebProduct(prodName);
    const addr   = (recv.addr||'')+(recv.addr_detail?' '+recv.addr_detail:'');
    const date   = String(o.order_date||'').slice(0,8);
    const dateStr= date ? `${date.slice(0,4)}-${date.slice(4,6)}-${date.slice(6,8)}` : '';

    return `<tr id="iw-row-${i}">
      <td><input type="checkbox" class="iw-ck" data-idx="${i}" checked></td>
      <td style="color:var(--text3);">${i+1}</td>
      <td style="font-size:11px;font-family:monospace;">${o.order_no||''}</td>
      <td><strong>${recv.name||o.member_id||''}</strong></td>
      <td style="white-space:nowrap;">${recv.phone||''}</td>
      <td style="font-size:11px;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${addr}">${addr}</td>
      <td style="font-size:11px;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${prodName}">${prodName||'—'}</td>
      <td>
        <select class="inp inp-sm" id="iw-prod-${i}" style="width:130px;">
          <option value="" ${!autoProd?'selected':''}>미선택</option>
          <optgroup label="반찬 세트">
            <option value="A" ${autoProd==='A'?'selected':''}>A세트</option>
            <option value="B" ${autoProd==='B'?'selected':''}>B세트</option>
            <option value="C" ${autoProd==='C'?'selected':''}>C세트</option>
          </optgroup>
          <optgroup label="단품">
            <option value="pork_rib" ${autoProd==='pork_rib'?'selected':''}>🥩 돼지양념갈비</option>
            <option value="beef_la"  ${autoProd==='beef_la' ?'selected':''}>🥩 양념LA갈비</option>
          </optgroup>
        </select>
      </td>
      <td style="font-size:11px;max-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${recv.memo||'—'}</td>
      <td style="font-size:11px;white-space:nowrap;">${dateStr}</td>
      <td><button class="btn btn-d sm" onclick="iwRemoveRow(${i})">✕</button></td>
    </tr>`;
  }).join('');
}

function iwRemoveRow(i){
  const row = document.getElementById('iw-row-'+i);
  if(row) row.remove();
}

function imwebToggleAll(el){
  document.querySelectorAll('.iw-ck').forEach(c=>c.checked=el.checked);
}

async function imwebRegAll(){
  const checked = [...document.querySelectorAll('.iw-ck:checked')];
  if(!checked.length){ toast('등록할 주문을 선택하세요','er'); return; }

  const noSet = checked.filter(ck=>{
    const idx = ck.dataset.idx;
    return !document.getElementById('iw-prod-'+idx)?.value;
  });
  if(noSet.length){ toast(`세트/상품 미선택 ${noSet.length}건이 있습니다`,'er'); return; }

  if(!confirm(`선택한 ${checked.length}건을 등록하시겠습니까?`)) return;

  const t = todayStr(); let ok=0;
  for(const ck of checked){
    const i   = parseInt(ck.dataset.idx);
    const o   = iwOrders[i];
    const row = document.getElementById('iw-row-'+i);
    if(!o || !row) continue;

    const recv     = o.order_info?.recv || {};
    const items    = o.product_list || [];
    const prod0    = items[0] || {};
    const prod     = document.getElementById('iw-prod-'+i)?.value || '';
    const qty      = parseInt(prod0.ea)||1;
    const addr     = (recv.addr||'')+(recv.addr_detail?' '+recv.addr_detail:'');
    const date     = String(o.order_date||'').slice(0,8);
    const dateStr  = date ? `${date.slice(0,4)}-${date.slice(4,6)}-${date.slice(6,8)}` : t;

    const data = {
      name:     recv.name||'',
      phone:    recv.phone||'',
      addr:     addr,
      door:     '',
      request:  recv.memo||'',
      memo:     `아임웹 주문번호: ${o.order_no}`,
      set:      prod,
      productId:prod,
      orderNum: String(o.order_no||''),
      orderType:'once',
      status:   'active',
      deliveredDates:[],
      createdAt:new Date().toISOString(),
      total:qty, remain:qty, qty,
      onceDate: dateStr,
      startDate:dateStr,
      scheduleName: productLabel(prod)+(qty>1?' x'+qty+'개':''),
      arriveDays:[], cookDays:[],
      isDirect: false,
    };
    try{
      await window.__DB.collection('customers').add(data);
      row.style.opacity='0.4';
      ok++;
    } catch(e){ toast('등록 오류: '+e.message,'er'); }
  }
  if(ok>0) toast(`${ok}건 등록 완료!`,'ok');
}

function imwebReset(){
  iwOrders=[];
  document.getElementById('iw-result-wrap').style.display='none';
  document.getElementById('iw-tbody').innerHTML='';
}

// 아임웹 초기화 (goTab 시 호출)
function initImwebTab(){
  const keys = imwebLoadKeys();
  if(keys){
    if(!document.getElementById('iw-apikey').value) document.getElementById('iw-apikey').value = keys.ak;
    if(!document.getElementById('iw-secret').value) document.getElementById('iw-secret').value = keys.sk;
    imwebTestConn();
  }
  const t = todayStr();
  if(!document.getElementById('iw-from').value) document.getElementById('iw-from').value = addDays(t,-7);
  if(!document.getElementById('iw-to').value)   document.getElementById('iw-to').value   = t;
}

// ════════════════════════════════════════
// 아임웹 엑셀 업로드 전용 파싱
// 컬럼(0-based): [01]주문번호 [02]주문상태 [16]구매수량
//   [17]상품명 [18]옵션명 [24]수령자명 [25]전화 [28]주소 [29]상세주소
//   [30]배송메모 [36]주문일
// ════════════════════════════════════════
let iwXlData = [];

function iwDzOver(e){ e.preventDefault(); document.getElementById('iw-dz').classList.add('drag'); }
function iwDzLeave(){ document.getElementById('iw-dz').classList.remove('drag'); }
function iwDzDrop(e){ e.preventDefault(); iwDzLeave(); const f=e.dataTransfer.files[0]; if(f) iwProcXl(f); }
function iwReadXl(inp){ if(inp.files[0]) iwProcXl(inp.files[0]); }

function iwProcXl(file){
  const reader = new FileReader();
  reader.onload = e => {
    try{
      const wb = XLSX.read(e.target.result, {type:'binary', cellDates:true});
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, {header:1, raw:false});
      const dataRows = rows.slice(1).filter(r => r.length > 5); // 헤더 제외
      iwXlData = dataRows.map(iwParseRow).filter(r => r !== null);
      document.getElementById('iw-xl-cnt').textContent =
        `${iwXlData.length}건 (제외됨 ${dataRows.length - iwXlData.length}건)`;
      iwRenderXl();
      document.getElementById('iw-xl-wrap').style.display = 'block';
      toast(`아임웹 엑셀 ${iwXlData.length}건 로드됨`, 'info');
    } catch(err){ toast('엑셀 읽기 오류: '+err.message,'er'); }
  };
  reader.readAsBinaryString(file);
}

// 아임웹 날짜 파싱: "3월 27일 금요일..." → "2026-03-27"
function iwParseDateKo(str, orderDateStr){
  const m = str.match(/(\d{1,2})월[\s\.\-]*(\d{1,2})일/);
  if(!m) return '';
  // 연도: 주문일에서 추출, 없으면 현재 연도
  let y = new Date().getFullYear();
  if(orderDateStr){
    const ym = String(orderDateStr).match(/^(\d{4})/);
    if(ym) y = parseInt(ym[1]);
  }
  return `${y}-${String(m[1]).padStart(2,'0')}-${String(m[2]).padStart(2,'0')}`;
}

// 정기배송 옵션에서 스케줄 자동 매칭
function iwMatchSch(optName){
  if(!optName) return {freq:'', schIdx:''};
  // 주기 파싱
  const fm = optName.match(/주\s*(\d)회/);
  const freq = fm ? fm[1] : '';
  // 요일 매칭
  const schMap = {
    '월 조리': {freq:'1', idx:0},  '화 조리': {freq:'1', idx:1},
    '수 조리': {freq:'1', idx:2},  '목 조리': {freq:'1', idx:3},
    '금 조리': {freq:'1', idx:4},
    '월.수 조리': {freq:'2', idx:0}, '월/수 조리': {freq:'2', idx:0},
    '화.목 조리': {freq:'2', idx:1}, '화/목 조리': {freq:'2', idx:1},
    '수.금 조리': {freq:'2', idx:2}, '수/금 조리': {freq:'2', idx:2},
    '목.토 조리': {freq:'2', idx:3}, '목/토 조리': {freq:'2', idx:3},
    '금.일 조리': {freq:'2', idx:4}, '금/일 조리': {freq:'2', idx:4},
    '월.수.금 조리': {freq:'3', idx:0}, '월/수/금 조리': {freq:'3', idx:0},
    '화.목.토 조리': {freq:'3', idx:1}, '화/목/토 조리': {freq:'3', idx:1},
  };
  for(const [key, val] of Object.entries(schMap)){
    if(optName.includes(key.replace('.','/')) || optName.includes(key.replace('/','.'))
       || optName.includes(key)){
      return {freq: val.freq, schIdx: val.idx};
    }
  }
  return {freq, schIdx:''};
}

function iwParseRow(r){
  const status   = r[2] || '';
  // 거래종료·취소·반품 제외
  if(/거래종료|취소완료|반품완료|취소|반품/.test(status)) return null;

  const orderNo  = String(r[1]  || '').trim();
  const qty      = parseInt(r[16]) || 1;
  const prodName = String(r[17] || '').trim();
  const optName  = String(r[18] || '').trim();
  const recv     = String(r[24] || '').trim();
  const phone    = String(r[25] || '').trim();
  const addr     = (String(r[28]||'')+' '+String(r[29]||'')).trim();
  const memo     = String(r[30] || '').trim();
  const orderDate= String(r[36] || '');

  // 상품 파싱
  const combined = prodName + ' ' + optName;
  let prod = '', orderType = 'once', onceDate = '', schInfo = {};

  if(/수제.*돼지.*갈비|돼지.*양념.*갈비|수제양념돼지갈비/.test(combined)){
    prod = 'pork_rib';
  } else if(/양념.*LA.*갈비|LA.*갈비|라갈비/.test(combined)){
    prod = 'beef_la';
  } else {
    const sm = combined.match(/([ABC])세트/i);
    if(sm) prod = sm[1].toUpperCase();
  }

  // 정기/선택 구분
  if(/정기구독|정기배송/.test(combined)){
    orderType = 'sub';
    schInfo = iwMatchSch(optName);
  } else {
    orderType = 'once';
    // 날짜 파싱 (상품명에서)
    if(/\d{1,2}월\s*\d{1,2}일/.test(prodName)){
      onceDate = iwParseDateKo(prodName, orderDate);
    }
  }

  // 횟수 파싱 (정기)
  const tm = optName.match(/총\s*(\d+)회/);
  const total = tm ? parseInt(tm[1]) : 12;

  return { orderNo, status, recv, phone, addr, memo, orderDate,
           prod, qty, orderType, onceDate, total, schInfo, optName, prodName,
           _excluded: false };
}

const IW_PROD_OPTIONS = `
  <option value="">미선택</option>
  <optgroup label="반찬 세트">
    <option value="A">A세트</option>
    <option value="B">B세트</option>
    <option value="C">C세트</option>
  </optgroup>
  <optgroup label="단품">
    <option value="pork_rib">🥩 수제 돼지양념갈비</option>
    <option value="beef_la">🥩 양념 LA갈비</option>
  </optgroup>`;

function iwRenderXl(){
  const tbody = document.getElementById('iw-xl-tbody');
  if(!iwXlData.length){
    tbody.innerHTML = `<tr><td colspan="11"><div class="empty"><div class="ei">📭</div><div>데이터 없음</div></div></td></tr>`;
    return;
  }
  tbody.innerHTML = iwXlData.map((row, i) => {
    const typeBadge = row.orderType === 'sub'
      ? '<span class="badge b-sub">정기</span>'
      : '<span class="badge b-once">선택</span>';
    // 배송일/일정 표시
    let dateDisplay = '';
    if(row.orderType === 'once'){
      dateDisplay = `<input type="date" class="inp inp-sm" id="iw-xl-date-${i}" value="${row.onceDate}" style="width:130px;">`;
    } else {
      // 정기: 주기 + 일정 선택
      const freq = row.schInfo.freq || '';
      dateDisplay = `
        <select class="inp inp-sm" id="iw-xl-freq-${i}" onchange="iwXlUpdSch(${i})" style="width:70px;margin-bottom:4px;">
          <option value="">주기</option>
          <option value="1" ${freq==='1'?'selected':''}>주1회</option>
          <option value="2" ${freq==='2'?'selected':''}>주2회</option>
          <option value="3" ${freq==='3'?'selected':''}>주3회</option>
        </select>
        <select class="inp inp-sm" id="iw-xl-sched-${i}" style="width:130px;"></select>`;
    }
    return `<tr id="iw-xl-row-${i}">
      <td style="color:var(--text3);">${i+1}</td>
      <td style="font-size:10px;font-family:monospace;">${row.orderNo}</td>
      <td><strong>${row.recv}</strong></td>
      <td style="white-space:nowrap;font-size:12px;">${row.phone}</td>
      <td style="font-size:11px;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${row.addr}">${row.addr}</td>
      <td>${typeBadge}</td>
      <td>
        <select class="inp inp-sm" id="iw-xl-prod-${i}" style="width:130px;">
          ${IW_PROD_OPTIONS}
        </select>
      </td>
      <td style="min-width:140px;">${dateDisplay}</td>
      <td style="text-align:center;">${row.qty}</td>
      <td style="font-size:11px;max-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${row.memo||'—'}</td>
      <td><button class="btn btn-d sm" onclick="iwXlRemove(${i})">✕</button></td>
    </tr>`;
  }).join('');

  // 렌더 후 값 세팅
  iwXlData.forEach((row, i) => {
    const prodEl = document.getElementById('iw-xl-prod-'+i);
    if(prodEl) prodEl.value = row.prod;
    if(row.orderType === 'sub'){
      iwXlUpdSch(i, row.schInfo.schIdx);
    }
  });
}

function iwXlUpdSch(i, presetIdx){
  const freq = document.getElementById('iw-xl-freq-'+i)?.value;
  const sel  = document.getElementById('iw-xl-sched-'+i);
  if(!sel) return;
  sel.innerHTML = '<option value="">일정 선택</option>';
  if(!freq||!SCH[freq]) return;
  SCH[freq].forEach((sc, idx) => {
    const opt = document.createElement('option');
    opt.value = idx;
    opt.textContent = sc.l;
    if(presetIdx !== undefined && presetIdx !== '' && parseInt(presetIdx) === idx) opt.selected = true;
    sel.appendChild(opt);
  });
}

function iwXlRemove(i){
  const row = document.getElementById('iw-xl-row-'+i);
  if(row) row.remove();
}

function iwResetXl(){
  iwXlData = [];
  document.getElementById('iw-xl-wrap').style.display = 'none';
  document.getElementById('iw-xl-tbody').innerHTML = '';
  document.getElementById('iw-xlf').value = '';
}

async function iwRegXl(){
  const rows = document.querySelectorAll('[id^="iw-xl-row-"]');
  if(!rows.length){ toast('등록할 데이터가 없습니다','er'); return; }

  // 검증
  let errs = [];
  rows.forEach(row => {
    const i = row.id.replace('iw-xl-row-','');
    const prod = document.getElementById('iw-xl-prod-'+i)?.value;
    if(!prod) errs.push(`행${parseInt(i)+1}: 세트/상품 미선택`);
  });
  if(errs.length){ toast(errs.slice(0,3).join(' / ')+(errs.length>3?` 외 ${errs.length-3}건`:''),'er'); return; }
  if(!confirm(`${rows.length}건을 등록하시겠습니까?`)) return;

  // 기존 주문번호 목록 (중복 방지)
  const existNums = new Set(custs.map(c=>c.orderNum||'').filter(Boolean));

  let ok=0, skip=0;
  for(const row of rows){
    const i    = row.id.replace('iw-xl-row-','');
    const d    = iwXlData[parseInt(i)];
    if(!d) continue;

    const prod = document.getElementById('iw-xl-prod-'+i)?.value || '';
    const orderNum = d.orderNo;

    // 중복 체크
    if(existNums.has(orderNum)){ skip++; continue; }

    let data = {
      name:     d.recv,
      phone:    d.phone,
      addr:     d.addr,
      door:     '',
      request:  d.memo,
      memo:     `아임웹 주문번호: ${orderNum}`,
      set:      prod,
      productId:prod,
      orderNum: orderNum,
      status:   'active',
      deliveredDates:[],
      createdAt:new Date().toISOString(),
      isDirect: false,
    };

    if(d.orderType === 'sub'){
      const freq  = document.getElementById('iw-xl-freq-'+i)?.value;
      const schIdx= document.getElementById('iw-xl-sched-'+i)?.value;
      if(!freq||schIdx===''||schIdx===undefined){ toast(`행${parseInt(i)+1}: 배송 일정을 선택하세요`,'er'); continue; }
      const sch = SCH[freq][parseInt(schIdx)];
      Object.assign(data, {
        orderType:'sub', type:parseInt(freq),
        scheduleName:sch.l, cookDays:sch.c, arriveDays:sch.a,
        total:d.total, remain:d.total,
        startDate:todayStr(),
      });
    } else {
      const onceDate = document.getElementById('iw-xl-date-'+i)?.value || todayStr();
      Object.assign(data, {
        orderType:'once',
        total:d.qty, remain:d.qty, qty:d.qty,
        onceDate, startDate:onceDate,
        scheduleName:productLabel(prod)+(d.qty>1?' x'+d.qty+'개':''),
        arriveDays:[], cookDays:[],
      });
    }

    try{
      await window.__DB.collection('customers').add(data);
      row.style.opacity = '0.35';
      row.style.pointerEvents = 'none';
      ok++;
    } catch(e){ toast('오류: '+e.message,'er'); }
  }

  let msg = `${ok}건 등록 완료!`;
  if(skip) msg += ` (중복 ${skip}건 건너뜀)`;
  toast(msg, 'ok');
}

// CSS용 드래그 스타일 (iw-dz)
// (기존 .dz 스타일 공유)


// ════════════════════════════
// 배송지 상세 모달
// ════════════════════════════
function showAddrModal(id){
  const c = custs.find(x=>x.id===id);
  if(!c) return;
  document.getElementById('am-name').textContent  = c.name  || '';
  document.getElementById('am-phone').textContent = c.phone || '';
  document.getElementById('am-addr').textContent  = c.addr  || '';
  document.getElementById('am-door').textContent  = c.door  || '—';
  document.getElementById('am-req').textContent   = c.request || '—';
  // 현관번호/요청사항 없으면 흐리게
  document.getElementById('am-door-wrap').style.opacity = c.door    ? '1' : '0.4';
  document.getElementById('am-req-wrap').style.opacity  = c.request ? '1' : '0.4';
  // 로젠택배 복사 버튼에 현재 고객 id 연결
  const lozenBtn = document.getElementById('lozenCopyBtn');
  if(lozenBtn) lozenBtn.onclick = ()=>copyLozen(id);
  openM('addrM');
}

function copyField(id){
  const text = document.getElementById(id)?.textContent?.trim() || '';
  if(!text || text === '—') { toast('복사할 내용 없음','er'); return; }
  navigator.clipboard.writeText(text).then(()=>toast('복사됨!','ok'));
}

function copyAllAddr(){
  const name  = document.getElementById('am-name')?.textContent?.trim()  || '';
  const phone = document.getElementById('am-phone')?.textContent?.trim() || '';
  const addr  = document.getElementById('am-addr')?.textContent?.trim()  || '';
  const door  = document.getElementById('am-door')?.textContent?.trim()  || '';
  const parts = [name, phone, addr];
  if(door && door !== '—') parts.push('현관: ' + door);
  navigator.clipboard.writeText(parts.join('\n')).then(()=>toast('전체 복사됨!','ok'));
}

// CSV 전체 백업
function exportCSV(){
  if(!custs.length){ toast('내보낼 고객 데이터가 없습니다','er'); return; }
  const header=['이름','연락처','주소','현관번호','요청사항','세트/상품','배송유형',
    '배송방식','주문번호','배송일정','총횟수','잔여횟수','시작일','선택주문배송일',
    '상태','등록일','메모'];
  const rows=custs.map(c=>[
    c.name||'', c.phone||'', c.addr||'', c.door||'', c.request||'',
    productLabel(c.productId||c.set)||c.set||'',
    c.orderType==='sub'?'정기배송':'선택주문',
    c.isDirect?'직배송':'택배',
    c.orderNum||'',
    c.scheduleName||'',
    c.total||'', c.remain||'',
    c.startDate||'', c.onceDate||'',
    {active:'구독중',pause:'일시정지',end:'종료'}[c.status]||c.status||'',
    c.createdAt?c.createdAt.slice(0,10):'',
    (c.memo||'').replace(/\r?\n/g,' ')
  ]);
  const BOM='\ufeff';
  const lines=[header,...rows].map(r=>r.map(v=>'"'+String(v).replace(/"/g,'""')+'"').join(','));
  const csv=BOM+lines.join('\r\n');
  const blob=new Blob([csv],{type:'text/csv;charset=utf-8;'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download='궁중수라간_고객백업_'+todayStr()+'.csv';
  a.click();
  toast(custs.length+'명 CSV 백업 완료','ok');
}

// 고객 목록에서 바로 삭제
async function quickDelete(id, name){
  if(!confirm(`[${name}] 고객을 삭제하시겠습니까?\n삭제된 데이터는 복구되지 않습니다.`)) return;
  try{
    await window.__DB.collection('customers').doc(id).delete();
    toast(name+' 삭제 완료','ok');
  } catch(e){ toast('삭제 오류: '+e.message,'er'); }
}

async function markDone(id, dateStr){
  const c=custs.find(x=>x.id===id); if(!c) return;
  if(c.remain<=0){ toast('이미 배송 완료된 건입니다','er'); return; }
  const t=dateStr||todayStr();
  if((c.deliveredDates||[]).includes(t)){ toast('해당 날짜 이미 처리됨','er'); return; }
  const rem=c.remain-1;
  const dates=[...(c.deliveredDates||[]),t];
  // 선택주문: 무조건 1번이면 end / 정기배송: remain 0이면 end
  const st = rem===0 ? 'end' : c.status;
  const upd = {remain:rem, deliveredDates:dates, status:st};
  try{
    await window.__DB.collection('customers').doc(id).update(upd);
    if(c.orderType==='once'){
      toast(c.name+' 배송 완료! (주문 종료)','ok');
    } else {
      toast(c.name+' 배송완료 (잔여 '+rem+'회)','ok');
    }
  } catch(e){ toast('오류: '+e.message,'er'); }
}

// 배송완료 취소 (실수 방지)
async function undoMarkDone(id, dateStr){
  const c=custs.find(x=>x.id===id); if(!c) return;
  const dates=(c.deliveredDates||[]).filter(d=>d!==dateStr);
  const newRemain=c.remain+1;
  const newStatus=c.status==='end'?'active':c.status;
  if(!confirm(`${c.name}의 [${dateStr}] 배송완료를 취소하시겠습니까?`)) return;
  try{
    await window.__DB.collection('customers').doc(id).update({
      remain:newRemain, deliveredDates:dates, status:newStatus
    });
    toast(c.name+' 배송완료 취소됨','ok');
  } catch(e){ toast('오류: '+e.message,'er'); }
}

async function markAll(){
  const dateStr=document.getElementById('todayDate').value;
  const list=listFor(dateStr);
  if(!list.length){ toast('해당 날짜 배송 없음','er'); return; }
  if(!confirm(list.length+'건 전체 완료 처리?')) return;
  try{
    await Promise.all(list.map(c=>{
      if((c.deliveredDates||[]).includes(dateStr)) return;
      const rem=c.remain-1;
      return window.__DB.collection('customers').doc(c.id).update({
        remain:rem,deliveredDates:[...(c.deliveredDates||[]),dateStr],status:rem===0?'end':c.status
      });
    }));
    toast(list.length+'건 완료!','ok');
  } catch(e){ toast('오류: '+e.message,'er'); }
}
