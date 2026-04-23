// ════════════════════════════════════════
// ★ 비밀번호 설정 - 여기를 수정하세요 ★
// ════════════════════════════════════════
// ★★★ 반드시 아래 비밀번호를 변경하세요! ★★★
const PASSWORDS = [
  'tkdgns1q2w!',
  'rndwndtnfkrks1q2w!',
];
const SESSION_KEY = 'gjsr_auth';
const SESSION_HOURS = 8; // 몇 시간 동안 로그인 유지

// ════════════════════════════════════════
// 로그인 로직
// ════════════════════════════════════════
let loginAttempts = 0;
const MAX_ATTEMPTS = 5;

function checkSession(){
  const s = localStorage.getItem(SESSION_KEY);
  if(!s) return false;
  try{
    const {ts} = JSON.parse(s);
    return (Date.now() - ts) < SESSION_HOURS * 3600 * 1000;
  } catch(e){ return false; }
}

function doLogin(){
  const errEl      = document.getElementById('loginErr');
  const attemptsEl = document.getElementById('loginAttempts');

  if(loginAttempts >= MAX_ATTEMPTS){
    errEl.textContent='5회 이상 실패하여 잠겼습니다. 페이지를 새로고침하세요.';
    errEl.style.display='block';
    return;
  }

  const pw = document.getElementById('pwInput').value;

  if(PASSWORDS.includes(pw)){
    // ✅ 로그인 성공
    localStorage.setItem(SESSION_KEY, JSON.stringify({ts:Date.now()}));
    document.getElementById('loginScreen').style.display='none';
    document.getElementById('app').style.display='block';
    document.getElementById('pwInput').value='';
    loginAttempts=0;
    errEl.style.display='none';
  } else {
    // ❌ 실패
    loginAttempts++;
    const left = MAX_ATTEMPTS - loginAttempts;
    errEl.textContent = '비밀번호가 올바르지 않습니다.';
    errEl.style.display='block';
    attemptsEl.textContent = left > 0 ? `남은 시도: ${left}회` : '잠금됨';
    document.getElementById('pwInput').value='';
    document.getElementById('pwInput').focus();
  }
}

function doLogout(){
  if(!confirm('로그아웃하시겠습니까?')) return;
  localStorage.removeItem(SESSION_KEY);
  location.reload();
}

// 세션 체크 후 화면 표시
window.addEventListener('DOMContentLoaded',()=>{
  if(checkSession()){
    document.getElementById('loginScreen').style.display='none';
    document.getElementById('app').style.display='block';
  }
  updateHDate();
  const t=todayStr();
  document.getElementById('dashDate').value=t;
  document.getElementById('todayDate').value=t;
  document.getElementById('expDate').value=t;
  document.getElementById('asd').value=t;
  document.getElementById('aod').value=t;
  updateDashDisp();
  updateTodayDisp();
  initReport();

  // 테마
  const theme=localStorage.getItem('theme')||'light';
  document.documentElement.setAttribute('data-theme',theme);
  document.getElementById('themeBtn').textContent=theme==='dark'?'☀️':'🌙';
});

// ════════════════════════════════════════
// 배송 일정 데이터
// ════════════════════════════════════════
// ════════════════════════════════════════
// 판매 상품 목록
// ════════════════════════════════════════
const PRODUCTS = [
  // 정기배송 세트
  { id:'A', label:'A세트', type:'sub', category:'set' },
  { id:'B', label:'B세트', type:'sub', category:'set' },
  { id:'C', label:'C세트', type:'sub', category:'set' },
  // 1회 배송 상품
  { id:'pork_rib',  label:'수제 돼지양념갈비', type:'once', category:'meat' },
  { id:'beef_la',   label:'양념 LA갈비',        type:'once', category:'meat' },
  { id:'beef_soup', label:'소고기무국',          type:'once', category:'meat' },
];

// 상품ID → 라벨
function productLabel(id){
  const p = PRODUCTS.find(x=>x.id===id);
  return p ? p.label : (id||'');
}
// 상품ID → 뱃지 CSS 클래스
function productBadgeClass(id){
  if(id==='A')         return 'ba';
  if(id==='B')         return 'bb';
  if(id==='C')         return 'bc';
  if(id==='pork_rib')  return 'b-pork';
  if(id==='beef_la')   return 'b-beef';
  if(id==='beef_soup') return 'b-beef';
  return 'b-pause';
}

const SCH={
  '1':[
    {l:'월 조리 → 화 도착', c:[1], a:[2]},
    {l:'화 조리 → 수 도착', c:[2], a:[3]},
    {l:'수 조리 → 목 도착', c:[3], a:[4]},
    {l:'목 조리 → 금 도착', c:[4], a:[5]},
    {l:'금 조리 → 토 도착', c:[5], a:[6]},
  ],
  '2':[
    {l:'월·수 조리 → 화·목 도착', c:[1,3], a:[2,4]},
    {l:'월·목 조리 → 화·금 도착', c:[1,4], a:[2,5]},
    {l:'화·목 조리 → 수·금 도착', c:[2,4], a:[3,5]},
    {l:'수·금 조리 → 목·토 도착', c:[3,5], a:[4,6]},
    {l:'월·금 조리 → 화·토 도착', c:[1,5], a:[2,6]},
  ],
  '3':[
    {l:'월·수·금 조리 → 화·목·토 도착', c:[1,3,5], a:[2,4,6]},
    {l:'화·목·금 조리 → 수·금·토 도착', c:[2,4,5], a:[3,5,6]},
  ]
};
const DAYS=['일','월','화','수','목','금','토'];
const SL={active:'구독중',pause:'정지',end:'종료'};

// ════════════════════════════════════════
// 상태
// ════════════════════════════════════════
let custs=[], editId=null, orderType='sub', parsedData=null, xlData=[];
let reportView='week'; // 'week' | 'month'
let reportOffset=0;   // 주 또는 월 오프셋

// ════════════════════════════════════════
// Firebase
// ════════════════════════════════════════
let _fbInitDone = false;
function initFirestore(){
  if(_fbInitDone) return;
  if(!window.__DB){ setTimeout(initFirestore, 200); return; }
  _fbInitDone = true;
  document.getElementById('fbDot').classList.add('on');
  document.getElementById('fbTxt').textContent='연결됨';
  window.__DB.collection('customers').onSnapshot(snap=>{
    custs=snap.docs.map(d=>({id:d.id,...d.data()}));
    refreshAll();
    document.getElementById('loading').style.display='none';
  }, err=>{
    toast('Firestore 오류: '+err.message,'er');
    document.getElementById('fbDot').classList.remove('on');
    document.getElementById('fbTxt').textContent='연결 오류';
    document.getElementById('loading').style.display='none';
  });
}
setTimeout(initFirestore, 300);
setTimeout(()=>{ document.getElementById('loading').style.display='none'; },5000);

// ════════════════════════════════════════
// CRUD
// ════════════════════════════════════════
async function saveNew(){
  const n=g('an'), ph=g('ap'), a=g('aa'), d=g('ad'), r=g('ar'), m=g('am');
  // 공통 필수값 체크
  if(!n){ toast('주문자명을 입력하세요','er'); return; }
  if(!ph){ toast('연락처를 입력하세요','er'); return; }
  if(!a){ toast('배송지 주소를 입력하세요','er'); return; }

  const isDirect = document.getElementById('a-direct').checked;
  const orderNum = document.getElementById('a-ordernum').value.trim();
  let data={
    name:n, phone:ph, addr:a, door:d, request:r, memo:m,
    status:'active', deliveredDates:[], createdAt:new Date().toISOString(),
    orderType, isDirect, orderNum
  };

  if(orderType==='sub'){
    // 정기배송
    const s=g('as'), tp=g('at'), si=document.getElementById('ach').value;
    const tot=parseInt(g('ato'))||0, sd=g('asd');
    if(!s)  { toast('세트를 선택하세요','er'); return; }
    if(!tp) { toast('배송 주기를 선택하세요','er'); return; }
    if(si===''||si===null){ toast('배송 일정을 선택하세요','er'); return; }
    if(!tot){ toast('총 구독 횟수를 입력하세요','er'); return; }
    if(!sd) { toast('시작일을 선택하세요','er'); return; }
    const sch=SCH[tp][parseInt(si)];
    Object.assign(data,{
      set:s, type:parseInt(tp),
      scheduleName:sch.l, cookDays:sch.c, arriveDays:sch.a,
      total:tot, remain:tot, startDate:sd
    });
  } else {
    // 선택주문
    const od=g('aod');
    const prod=g('aprod');
    const qty=parseInt(document.getElementById('aqty').value)||1;
    if(!od)  { toast('배송 예정일을 선택하세요','er'); return; }
    if(!prod){ toast('상품을 선택하세요','er'); return; }
    Object.assign(data,{
      set:prod, productId:prod,
      total:qty, remain:qty, qty,
      onceDate:od, startDate:od,
      scheduleName:productLabel(prod)+(qty>1?' x'+qty+'개':''),
      arriveDays:[], cookDays:[]
    });
  }

  try{
    await window.__DB.collection('customers').add(data);
    closeM('addM'); clearAdd(); toast(n+' 등록 완료!','ok');
  } catch(e){ toast('등록 오류: '+e.message,'er'); }
}

async function saveEdit(){
  const current=custs.find(x=>x.id===editId); if(!current) return;
  const esVal=g('es');
  const isSub=current.orderType==='sub';
  const upd={name:g('en'),phone:g('ep'),addr:g('ea'),door:g('ed'),request:g('er'),
    set:['A','B','C'].includes(esVal)?esVal:(esVal||''),
    productId:esVal,
    status:g('est'),remain:parseInt(g('erem'))||0,total:parseInt(g('etot'))||1,memo:g('em'),
    isDirect: document.getElementById('e-direct').checked,
    orderNum: document.getElementById('e-ordernum').value.trim()};

  if(isSub){
    const freq  = document.getElementById('e-freq').value;
    const schIdx= document.getElementById('e-sched').value;
    const sd    = g('e-startdate');
    if(!freq){ toast('배송 주기를 선택하세요','er'); return; }
    if(schIdx===''){ toast('배송 일정을 선택하세요','er'); return; }
    if(!sd){ toast('정기 시작일을 선택하세요','er'); return; }
    const sch = SCH[freq][parseInt(schIdx)];
    if(sch){
      upd.type         = parseInt(freq);
      upd.scheduleName = sch.l;
      upd.cookDays     = sch.c;
      upd.arriveDays   = sch.a;
      upd.startDate    = sd;
    }
  } else {
    const od=g('eodate');
    if(od){
      upd.onceDate  = od;
      upd.startDate = od;
    }
    upd.scheduleName = productLabel(esVal) || esVal;
  }

  try{
    await window.__DB.collection('customers').doc(editId).update(upd);
    closeM('editM'); toast(upd.name+' 수정 완료','ok');
  } catch(e){ toast('오류: '+e.message,'er'); }
}

async function delCust(){
  if(!confirm('삭제하시겠습니까? 복구 불가합니다.')) return;
  try{
    await window.__DB.collection('customers').doc(editId).delete();
    closeM('editM'); toast('삭제 완료','ok');
  } catch(e){ toast('오류: '+e.message,'er'); }
}

// 잔여 횟수 충전 (정기 갱신)
async function chargeRemain(id){
  const c=custs.find(x=>x.id===id); if(!c) return;
  const add=parseInt(prompt(`${c.name} 고객의 잔여 횟수를 추가합니다.
현재 잔여: ${c.remain}회
추가할 횟수를 입력하세요:`,'12'));
  if(!add||isNaN(add)||add<=0){ toast('올바른 횟수를 입력하세요','er'); return; }
  try{
    await window.__DB.collection('customers').doc(id).update({
      remain:c.remain+add, status:'active'
    });
    toast(`${c.name} +${add}회 충전 완료 (총 ${c.remain+add}회)`,'ok');
  } catch(e){ toast('오류: '+e.message,'er'); }
}

// 일시정지 / 재개 토글
async function togglePause(id){
  const c=custs.find(x=>x.id===id); if(!c) return;
  const isPaused=c.status==='pause';
  const newStatus=isPaused?'active':'pause';
  const label=isPaused?'재개':'일시정지';
  if(!confirm(`${c.name} 구독을 ${label}하시겠습니까?`)) return;
  try{
    await window.__DB.collection('customers').doc(id).update({status:newStatus});
    toast(`${c.name} 구독 ${label}됨`,'ok');
  } catch(e){ toast('오류: '+e.message,'er'); }
}
