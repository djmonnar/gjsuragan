// ════════════════════════════════════════
// Firebase Auth 관리자 로그인
// ════════════════════════════════════════
// index.html에 const DELIVERY_ADMIN_EMAIL = 'sun1562@naver.com'; 가 있으면 그 값을 사용
// 없으면 기본값으로 sun1562@naver.com 사용
const AUTH_ADMIN_EMAIL =
  typeof DELIVERY_ADMIN_EMAIL !== 'undefined'
    ? DELIVERY_ADMIN_EMAIL
    : 'sun1562@naver.com';

let loginAttempts = 0;
const MAX_ATTEMPTS = 5;
let APP_BOOTED = false;
let _customersUnsub = null;

function showLoginScreen(){
  const loading = document.getElementById('loading');
  const loginScreen = document.getElementById('loginScreen');
  const app = document.getElementById('app');

  if(loading) loading.style.display = 'none';
  if(loginScreen) loginScreen.style.display = 'flex';
  if(app) app.style.display = 'none';
}

function showAppScreen(){
  const loading = document.getElementById('loading');
  const loginScreen = document.getElementById('loginScreen');
  const app = document.getElementById('app');

  if(loading) loading.style.display = 'none';
  if(loginScreen) loginScreen.style.display = 'none';
  if(app) app.style.display = 'block';

  bootAppOnce();
}

function bootAppOnce(){
  if(APP_BOOTED) return;
  APP_BOOTED = true;

  updateHDate();

  const t = todayStr();
  document.getElementById('dashDate').value = t;
  document.getElementById('todayDate').value = t;
  document.getElementById('expDate').value = t;
  document.getElementById('asd').value = t;
  document.getElementById('aod').value = t;

  updateDashDisp();
  updateTodayDisp();
  initReport();

  // 테마
  const theme = localStorage.getItem('theme') || 'light';
  document.documentElement.setAttribute('data-theme', theme);
  document.getElementById('themeBtn').textContent = theme === 'dark' ? '☀️' : '🌙';

  // 로그인 성공 후에만 Firestore 연결
  initFirestore();
}

function stopFirestore(){
  if(typeof _customersUnsub === 'function'){
    _customersUnsub();
  }
  _customersUnsub = null;
  _fbInitDone = false;
}

window.addEventListener('DOMContentLoaded', () => {
  if(!window.__AUTH){
    const loading = document.getElementById('loading');
    if(loading) loading.style.display = 'none';
    alert('Firebase Auth 연결이 없습니다. index.html 설정을 확인해주세요.');
    return;
  }

  window.__AUTH.onAuthStateChanged(async (user) => {
    if(user && user.email === AUTH_ADMIN_EMAIL){
      showAppScreen();
      return;
    }

    stopFirestore();
    APP_BOOTED = false;

    if(user){
      await window.__AUTH.signOut();
    }

    showLoginScreen();
  });
});

async function doLogin(){
  const emailEl = document.getElementById('emailInput');
  const pwEl = document.getElementById('pwInput');
  const errEl = document.getElementById('loginErr');
  const attemptsEl = document.getElementById('loginAttempts');

  const email = emailEl ? emailEl.value.trim() : '';
  const pw = pwEl ? pwEl.value : '';

  if(errEl){
    errEl.style.display = 'none';
    errEl.textContent = '';
  }
  if(attemptsEl){
    attemptsEl.textContent = '';
  }

  if(loginAttempts >= MAX_ATTEMPTS){
    if(errEl){
      errEl.textContent = '5회 이상 실패하여 잠겼습니다. 페이지를 새로고침하세요.';
      errEl.style.display = 'block';
    }
    return;
  }

  if(!email || !pw){
    if(errEl){
      errEl.textContent = '이메일과 비밀번호를 입력해주세요.';
      errEl.style.display = 'block';
    }
    return;
  }

  try{
    const cred = await window.__AUTH.signInWithEmailAndPassword(email, pw);

    if(cred.user.email !== AUTH_ADMIN_EMAIL){
      await window.__AUTH.signOut();

      if(errEl){
        errEl.textContent = '허용된 관리자 계정이 아닙니다.';
        errEl.style.display = 'block';
      }
      return;
    }

    loginAttempts = 0;

    if(pwEl) pwEl.value = '';

    showAppScreen();

  } catch(e){
    loginAttempts++;

    const left = MAX_ATTEMPTS - loginAttempts;

    if(errEl){
      errEl.textContent = '이메일 또는 비밀번호가 올바르지 않습니다.';
      errEl.style.display = 'block';
    }

    if(attemptsEl){
      attemptsEl.textContent = left > 0 ? `남은 시도: ${left}회` : '잠금됨';
    }

    if(pwEl){
      pwEl.value = '';
      pwEl.focus();
    }
  }
}

async function doLogout(){
  if(!confirm('로그아웃하시겠습니까?')) return;

  stopFirestore();
  APP_BOOTED = false;

  if(window.__AUTH){
    await window.__AUTH.signOut();
  }

  showLoginScreen();
}

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
  const p = PRODUCTS.find(x => x.id === id);
  return p ? p.label : (id || '');
}

// 상품ID → 뱃지 CSS 클래스
function productBadgeClass(id){
  if(id === 'A')         return 'ba';
  if(id === 'B')         return 'bb';
  if(id === 'C')         return 'bc';
  if(id === 'pork_rib')  return 'b-pork';
  if(id === 'beef_la')   return 'b-beef';
  if(id === 'beef_soup') return 'b-beef';
  return 'b-pause';
}

const SCH = {
  '1':[
    { l:'월 조리 → 화 도착', c:[1], a:[2] },
    { l:'화 조리 → 수 도착', c:[2], a:[3] },
    { l:'수 조리 → 목 도착', c:[3], a:[4] },
    { l:'목 조리 → 금 도착', c:[4], a:[5] },
    { l:'금 조리 → 토 도착', c:[5], a:[6] },
  ],
  '2':[
    { l:'월·수 조리 → 화·목 도착', c:[1,3], a:[2,4] },
    { l:'월·목 조리 → 화·금 도착', c:[1,4], a:[2,5] },
    { l:'화·목 조리 → 수·금 도착', c:[2,4], a:[3,5] },
    { l:'수·금 조리 → 목·토 도착', c:[3,5], a:[4,6] },
    { l:'월·금 조리 → 화·토 도착', c:[1,5], a:[2,6] },
  ],
  '3':[
    { l:'월·수·금 조리 → 화·목·토 도착', c:[1,3,5], a:[2,4,6] },
    { l:'화·목·금 조리 → 수·금·토 도착', c:[2,4,5], a:[3,5,6] },
  ]
};

const DAYS = ['일','월','화','수','목','금','토'];
const SL = { active:'구독중', pause:'정지', end:'종료' };

// ════════════════════════════════════════
// 상태
// ════════════════════════════════════════
let custs = [];
let editId = null;
let orderType = 'sub';
let parsedData = null;
let xlData = [];
let reportView = 'week'; // 'week' | 'month'
let reportOffset = 0;   // 주 또는 월 오프셋

// ════════════════════════════════════════
// Firebase
// ════════════════════════════════════════
let _fbInitDone = false;

function initFirestore(){
  if(_fbInitDone) return;

  if(!window.__DB){
    setTimeout(initFirestore, 200);
    return;
  }

  if(!window.__AUTH || !window.__AUTH.currentUser){
    showLoginScreen();
    return;
  }

  _fbInitDone = true;

  document.getElementById('fbDot').classList.add('on');
  document.getElementById('fbTxt').textContent = '연결됨';

  _customersUnsub = window.__DB.collection('customers').onSnapshot(
    snap => {
      custs = snap.docs.map(d => ({ id:d.id, ...d.data() }));
      refreshAll();

      const loading = document.getElementById('loading');
      if(loading) loading.style.display = 'none';
    },
    err => {
      toast('Firestore 오류: ' + err.message, 'er');

      document.getElementById('fbDot').classList.remove('on');
      document.getElementById('fbTxt').textContent = '연결 오류';

      const loading = document.getElementById('loading');
      if(loading) loading.style.display = 'none';
    }
  );
}

// 로그인 판정이 오래 걸리는 상황 대비
setTimeout(() => {
  const loading = document.getElementById('loading');
  if(loading) loading.style.display = 'none';
}, 5000);

// ════════════════════════════════════════
// CRUD
// ════════════════════════════════════════
async function saveNew(){
  const n = g('an');
  const ph = g('ap');
  const a = g('aa');
  const d = g('ad');
  const r = g('ar');
  const m = g('am');

  // 공통 필수값 체크
  if(!n){ toast('주문자명을 입력하세요','er'); return; }
  if(!ph){ toast('연락처를 입력하세요','er'); return; }
  if(!a){ toast('배송지 주소를 입력하세요','er'); return; }

  const isDirect = document.getElementById('a-direct').checked;
  const orderNum = document.getElementById('a-ordernum').value.trim();

  let data = {
    name:n,
    phone:ph,
    addr:a,
    door:d,
    request:r,
    memo:m,
    status:'active',
    deliveredDates:[],
    createdAt:new Date().toISOString(),
    orderType,
    isDirect,
    orderNum
  };

  if(orderType === 'sub'){
    // 정기배송
    const s = g('as');
    const tp = g('at');
    const si = document.getElementById('ach').value;
    const tot = parseInt(g('ato')) || 0;
    const sd = g('asd');

    if(!s){ toast('세트를 선택하세요','er'); return; }
    if(!tp){ toast('배송 주기를 선택하세요','er'); return; }
    if(si === '' || si === null){ toast('배송 일정을 선택하세요','er'); return; }
    if(!tot){ toast('총 구독 횟수를 입력하세요','er'); return; }
    if(!sd){ toast('시작일을 선택하세요','er'); return; }

    const sch = SCH[tp][parseInt(si)];

    Object.assign(data, {
      set:s,
      type:parseInt(tp),
      scheduleName:sch.l,
      cookDays:sch.c,
      arriveDays:sch.a,
      total:tot,
      remain:tot,
      startDate:sd
    });

  } else {
    // 선택주문
    const od = g('aod');
    const prod = g('aprod');
    const qty = parseInt(document.getElementById('aqty').value) || 1;

    if(!od){ toast('배송 예정일을 선택하세요','er'); return; }
    if(!prod){ toast('상품을 선택하세요','er'); return; }

    Object.assign(data, {
      set:prod,
      productId:prod,
      total:qty,
      remain:qty,
      qty,
      onceDate:od,
      startDate:od,
      scheduleName:productLabel(prod) + (qty > 1 ? ' x' + qty + '개' : ''),
      arriveDays:[],
      cookDays:[]
    });
  }

  try{
    await window.__DB.collection('customers').add(data);
    closeM('addM');
    clearAdd();
    toast(n + ' 등록 완료!', 'ok');
  } catch(e){
    toast('등록 오류: ' + e.message, 'er');
  }
}

async function saveEdit(){
  const current = custs.find(x => x.id === editId);
  if(!current) return;

  const esVal = g('es');
  const isSub = current.orderType === 'sub';

  const upd = {
    name:g('en'),
    phone:g('ep'),
    addr:g('ea'),
    door:g('ed'),
    request:g('er'),
    set:['A','B','C'].includes(esVal) ? esVal : (esVal || ''),
    productId:esVal,
    status:g('est'),
    remain:parseInt(g('erem')) || 0,
    total:parseInt(g('etot')) || 1,
    memo:g('em'),
    isDirect:document.getElementById('e-direct').checked,
    orderNum:document.getElementById('e-ordernum').value.trim()
  };

  if(isSub){
    const freq = document.getElementById('e-freq').value;
    const schIdx = document.getElementById('e-sched').value;
    const sd = g('e-startdate');

    if(!freq){ toast('배송 주기를 선택하세요','er'); return; }
    if(schIdx === ''){ toast('배송 일정을 선택하세요','er'); return; }
    if(!sd){ toast('정기 시작일을 선택하세요','er'); return; }

    const sch = SCH[freq][parseInt(schIdx)];

    if(sch){
      upd.type = parseInt(freq);
      upd.scheduleName = sch.l;
      upd.cookDays = sch.c;
      upd.arriveDays = sch.a;
      upd.startDate = sd;
    }

  } else {
    const od = g('eodate');

    if(od){
      upd.onceDate = od;
      upd.startDate = od;
    }

    upd.scheduleName = productLabel(esVal) || esVal;
  }

  try{
    await window.__DB.collection('customers').doc(editId).update(upd);
    closeM('editM');
    toast(upd.name + ' 수정 완료', 'ok');
  } catch(e){
    toast('오류: ' + e.message, 'er');
  }
}

async function delCust(){
  if(!confirm('삭제하시겠습니까? 복구 불가합니다.')) return;

  try{
    await window.__DB.collection('customers').doc(editId).delete();
    closeM('editM');
    toast('삭제 완료', 'ok');
  } catch(e){
    toast('오류: ' + e.message, 'er');
  }
}

// 잔여 횟수 충전 (정기 갱신)
async function chargeRemain(id){
  const c = custs.find(x => x.id === id);
  if(!c) return;

  const add = parseInt(prompt(`${c.name} 고객의 잔여 횟수를 추가합니다.
현재 잔여: ${c.remain}회
추가할 횟수를 입력하세요:`, '12'));

  if(!add || isNaN(add) || add <= 0){
    toast('올바른 횟수를 입력하세요','er');
    return;
  }

  try{
    await window.__DB.collection('customers').doc(id).update({
      remain:c.remain + add,
      status:'active'
    });

    toast(`${c.name} +${add}회 충전 완료 (총 ${c.remain + add}회)`, 'ok');

  } catch(e){
    toast('오류: ' + e.message, 'er');
  }
}

// 일시정지 / 재개 토글
async function togglePause(id){
  const c = custs.find(x => x.id === id);
  if(!c) return;

  const isPaused = c.status === 'pause';
  const newStatus = isPaused ? 'active' : 'pause';
  const label = isPaused ? '재개' : '일시정지';

  if(!confirm(`${c.name} 구독을 ${label}하시겠습니까?`)) return;

  try{
    await window.__DB.collection('customers').doc(id).update({
      status:newStatus
    });

    toast(`${c.name} 구독 ${label}됨`, 'ok');

  } catch(e){
    toast('오류: ' + e.message, 'er');
  }
}
