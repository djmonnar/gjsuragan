// ════════════════════════════════════════
// UI 헬퍼
// ════════════════════════════════════════
function gauge(c){
  // 선택주문(1회): 수량만 표시, 게이지 없음
  if(c.orderType==='once'){
    const q=c.qty||c.total||1;
    return `<span style="font-size:12px;color:var(--text2);font-weight:600;">${q > 1 ? q+'개' : '—'}</span>`;
  }
  // 정기배송: 잔여 게이지
  const pct=c.total>0?Math.min(100,c.remain/c.total*100):0, lo=c.remain<=3;
  return `<div class="gw"><div class="gt"><div class="gf ${lo?'low':''}" style="width:${pct}%"></div></div><span class="gn ${lo?'g-low':'g-ok'}">${c.remain}회</span></div>`;
}

// 배송일정 표시: 정기는 스케줄명, 선택주문은 배송예정일만
function scheduleDisp(c){
  if(c.orderType==='sub'){
    const name = c.scheduleName||'';
    if(c.isDirect){
      // 직배송은 당일 조리·배송 → "X 조리 → Y 도착" → "X 조리·배송"
      return name.replace(/\s*→.+도착$/, '').replace('조리', '조리·배송');
    }
    return name;
  }
  return c.onceDate||'';
}

// 로젠택배 복사: 이름·연락처·주소·현관번호 탭 구분
function copyLozen(id){
  const c=custs.find(x=>x.id===id); if(!c) return;
  const parts=[c.name||'', c.phone||'', c.addr||'', c.door||''];
  navigator.clipboard.writeText(parts.join('\t')).then(()=>toast('로젠택배 형식으로 복사됨!','ok'));
}
function s(id,v){const el=document.getElementById(id);if(el)el.textContent=v;}
function g(id){return document.getElementById(id)?.value.trim()||'';}
function g2(id,v){const el=document.getElementById(id);if(el)el.value=v||'';}

function updateHDate(){
  const n=new Date();
  document.getElementById('hDate').textContent=`${n.getFullYear()}.${String(n.getMonth()+1).padStart(2,'0')}.${String(n.getDate()).padStart(2,'0')} (${DAYS[n.getDay()]})`;
}

function toggleTheme(){
  const h=document.documentElement, isDark=h.getAttribute('data-theme')==='dark';
  h.setAttribute('data-theme',isDark?'light':'dark');
  document.getElementById('themeBtn').textContent=isDark?'🌙':'☀️';
  localStorage.setItem('theme',isDark?'light':'dark');
}

function setTypeTab(type){
  orderType=type;
  const $e = id => document.getElementById(id);
  if($e('tTab-sub'))  $e('tTab-sub').classList.toggle('on',type==='sub');
  if($e('tTab-once')) $e('tTab-once').classList.toggle('on',type==='once');
  ['af-freq','af-sched','af-total'].forEach(id=>{const el=$e(id);if(el)el.style.display=type==='sub'?'':'none';});
  if($e('af-set'))       $e('af-set').style.display=type==='sub'?'':'none';
  if($e('af-prod'))      $e('af-prod').style.display=type==='once'?'':'none';
  if($e('af-once-date')) $e('af-once-date').style.display=type==='once'?'':'none';
  if($e('af-qty'))       $e('af-qty').style.display=type==='once'?'':'none';
}

function updSch(){
  const tp=document.getElementById('at').value, sel=document.getElementById('ach');
  sel.innerHTML='';
  if(!tp){sel.innerHTML='<option>주기를 먼저 선택하세요</option>';return;}
  SCH[tp].forEach((sc,i)=>{const o=document.createElement('option');o.value=i;o.textContent=sc.l;sel.appendChild(o);});
}

function openEdit(id){
  const c=custs.find(x=>x.id===id);if(!c)return;
  editId=id;
  g2('en',c.name);g2('ep',c.phone);g2('ea',c.addr);g2('ed',c.door);g2('er',c.request);
  document.getElementById('es').value=c.productId||c.set||'A';
  document.getElementById('est').value=c.status;
  g2('erem',c.remain);g2('etot',c.total);g2('em',c.memo);g2('eodate',c.onceDate||'');
  g2('e-startdate',c.startDate||'');
  g2('e-ordernum',c.orderNum||'');
  document.getElementById('e-direct').checked=!!(c.isDirect);

  // 정기/선택 구분에 따라 일정 필드 표시
  const isSub = c.orderType === 'sub';
  document.getElementById('ef-sched-wrap').style.display = isSub ? '' : 'none';
  document.getElementById('ef-sched-sel').style.display  = isSub ? '' : 'none';
  document.getElementById('ef-start-wrap').style.display = isSub ? '' : 'none';
  document.getElementById('ef-oncedate-wrap').style.display = isSub ? 'none' : '';

  // 선택주문이면 반드시 초기화 (이전 정기배송 값 잔류 방지)
  if(!isSub){
    document.getElementById('e-freq').value = '';
    document.getElementById('e-sched').innerHTML = '<option value="">선택하세요</option>';
  }

  if(isSub){
    // 현재 저장된 cookDays로 주기·일정 역산
    const freq = String(c.type || (c.cookDays && c.cookDays.length) || '');
    document.getElementById('e-freq').value = freq;
    editUpdSch(); // 드롭다운 옵션 생성

    // 현재 cookDays와 일치하는 인덱스 선택
    if(freq && c.cookDays && c.cookDays.length){
      const cookKey = c.cookDays.slice().sort((a,b)=>a-b).join(',');
      const schIndexMap = {
        '1':{1:0,2:1,3:2,4:3,5:4},
        '2':{'1,3':0,'1,4':1,'2,4':2,'3,5':3,'1,5':4},
        '3':{'1,3,5':0,'2,4,5':1},
      };
      const idx = freq === '1'
        ? (schIndexMap['1'][c.cookDays[0]] ?? '')
        : (schIndexMap[freq]?.[cookKey] ?? '');
      document.getElementById('e-sched').value = String(idx);
    }
  }

  openM('editM');
}

// 수정 모달 배송 일정 드롭다운 업데이트
function editUpdSch(){
  const freq = document.getElementById('e-freq').value;
  const sel  = document.getElementById('e-sched');
  sel.innerHTML = '<option value="">선택하세요</option>';
  if(!freq || !SCH[freq]) return;
  SCH[freq].forEach((sc,i)=>{
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = sc.l;
    sel.appendChild(opt);
  });
}

function changeQty(d){
  const el=document.getElementById('aqty');
  const v=parseInt(el.value)||1;
  el.value=Math.max(1,Math.min(99,v+d));
}

function clearAdd(){
  ['an','ap','aa','ad','ar','am','ato','a-ordernum'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
  document.getElementById('as').value='';
  document.getElementById('aprod').value='';
  document.getElementById('aqty').value='1';
  document.getElementById('a-direct').checked=false;
  document.getElementById('at').value='';
  document.getElementById('ach').innerHTML='<option>주기를 먼저 선택하세요</option>';
  document.getElementById('asd').value=todayStr();document.getElementById('aod').value=todayStr();
  setTypeTab('sub');
}

function goTab(name){
  const tabs=['dash','today','report','customers','export','import'];
  document.querySelectorAll('.ni').forEach((t,i)=>t.classList.toggle('on',tabs[i]===name));
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('on'));
  document.getElementById('page-'+name).classList.add('on');
  if(name==='customers') renderCust();
  if(name==='report') renderReport();
}

function openM(id){document.getElementById(id).classList.add('on');}
function closeM(id){document.getElementById(id).classList.remove('on');}
document.querySelectorAll('.mbg').forEach(m=>m.addEventListener('click',e=>{if(e.target===m)m.classList.remove('on');}));

function toggleAll(el){document.querySelectorAll('.ck').forEach(c=>c.checked=el.checked);}

function toast(msg,type=''){
  const w=document.getElementById('tw');
  if(!w){ console.warn('toast:',msg); return; }
  const t=document.createElement('div');
  t.className='toast '+type; t.appendChild(document.createTextNode(msg));
  w.appendChild(t); setTimeout(()=>t.remove(),3500);
}
