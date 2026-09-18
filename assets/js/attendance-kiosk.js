(function () {
  'use strict';
  const U = window.AttendanceUI;
  const $ = id => document.getElementById(id);
  const STORAGE_KEY = 'gjsuragan-attendance-device';
  let device = '', employees = [], filter = 'all', offset = 0, loading = false, dialogOpen = false;
  let setupAuth, floor = 1;
  const setupFloor = U.setupStore(location.search);
  function showStore(value) {
    document.title = `출퇴근 · ${U.storeName(value)}`;
    $('kiosk-store-name').textContent = U.storeName(value);
    $('kiosk-seal').textContent = Number(value) === 1 ? '石' : '宮';
  }
  showStore(setupFloor);
  $('kiosk-setup-floor').value = String(setupFloor);
  $('kiosk-setup-form').elements.name.value = `${U.storeName(setupFloor)} 출퇴근 태블릿`;
  $('kiosk-setup-floor').onchange = event => {
    $('kiosk-setup-form').elements.name.value = `${U.storeName(event.target.value)} 출퇴근 태블릿`;
    showStore(event.target.value);
  };
  try { device = localStorage.getItem(STORAGE_KEY) || ''; } catch (_) { /* Setup explains unavailable storage on submit. */ }
  function connection(ok, label) {
    $('kiosk-connection').textContent = label;
    $('kiosk-connection').classList.toggle('offline', !ok);
  }
  function tick() {
    const now = Date.now() + offset;
    $('kiosk-clock').textContent = U.time(now);
    $('kiosk-date').textContent = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'long', day: 'numeric', weekday: 'long' }).format(now);
  }
  // 화면에 뜨는 칸 목록. 직원 한 명은 칸 하나지만,
  // 일일근무자 자리는 '출근 칸 하나 + 지금 들어와 있는 사람마다 퇴근 칸 하나'가 된다.
  // 한 자리를 여러 명이 같이 쓰므로 각자 자기 것을 눌러 퇴근해야 한다.
  function buildCards() {
    const today = U.date(Date.now() + offset);
    const cards = [];
    employees.forEach(employee => {
      const role = employee.role || `${U.storeName(floor)} ${employee.payType === 'daily' ? '일일근무자' : '직원'}`;
      if (employee.payType === 'daily') {
        const open = employee.openShifts || [];
        cards.push({ employee, shiftId: '', working: false, name: employee.name, role, slot: true,
          pill: open.length ? `${open.length}명 근무 중` : '출근 전',
          detail: '누구든 이 칸으로 출근합니다', action: '출근' });
        open.forEach((shift, index) => cards.push({ employee, shiftId: shift.id, working: true, slot: true,
          name: shift.workerName || `${employee.name} ${index + 1}`, role,
          pill: '근무 중', checkInAt: shift.checkInAt,
          detail: `${U.date(shift.checkInAt) !== today ? `${U.date(shift.checkInAt).slice(5)} ` : ''}${U.time(shift.checkInAt)} 출근`,
          action: '퇴근' }));
        return;
      }
      const working = Boolean(employee.currentShiftId);
      const last = employee.lastShift;
      const finishedToday = !working && last?.checkOutAt && U.date(last.checkOutAt) === today;
      cards.push({ employee, shiftId: employee.currentShiftId || '', working, name: employee.name, role,
        pill: working ? '근무 중' : finishedToday ? '퇴근 완료' : '출근 전',
        checkInAt: working ? last.checkInAt : null,
        detail: working
          ? `${U.date(last.checkInAt) !== today ? `${U.date(last.checkInAt).slice(5)} ` : ''}${U.time(last.checkInAt)} 출근`
          : finishedToday ? `${U.time(last.checkOutAt)} 퇴근` : '오늘도 반갑습니다',
        action: working ? '퇴근' : '출근' });
    });
    return cards;
  }
  function render() {
    const cards = buildCards();
    $('kiosk-total').textContent = cards.length;
    $('kiosk-working').textContent = cards.filter(card => card.working).length;
    const query = $('kiosk-search').value.trim().toLowerCase();
    const visible = cards.filter(card => card.name.toLowerCase().includes(query) && (filter === 'all' || (filter === 'working' ? card.working : !card.working)));
    $('kiosk-grid').innerHTML = visible.map(card => `<button class="att-person ${card.working ? 'working' : ''}${card.slot ? ' slot' : ''}" data-employee="${U.esc(card.employee.id)}" data-shift="${U.esc(card.shiftId)}" aria-label="${U.esc(card.name)}, ${card.action}하기"><div class="att-person-head"><span class="att-avatar" aria-hidden="true">${U.esc(Array.from(card.name)[0])}</span><span class="att-pill ${card.working ? 'green' : ''}">${U.esc(card.pill)}</span></div><div class="att-person-name">${U.esc(card.name)}</div><div class="att-person-role">${U.esc(card.role)}</div><div class="att-person-bottom"><span>${U.esc(card.detail)}</span><span class="att-person-action">${card.action} →</span></div></button>`).join('');
    $('kiosk-empty').hidden = visible.length > 0;
    $('kiosk-empty').innerHTML = employees.length ? '<strong>해당하는 직원이 없어요</strong>이름이나 근무 상태를 다시 확인해 주세요.' : `<strong>${U.storeName(floor)}에 등록된 직원이 아직 없어요</strong>별도 관리 페이지에서 직원의 근무 매장을 ${U.storeName(floor)}로 지정해 주세요.`;
  }
  async function load() {
    if (!device || loading) return;
    loading = true;
    try {
      const data = await U.request('kiosk.list', {}, { device });
      floor = data.floor ?? 1;
      employees = data.employees.sort((a, b) => a.name.localeCompare(b.name, 'ko'));
      offset = data.serverNow - Date.now();
      $('kiosk-device-name').textContent = `${U.deviceName(data.deviceName, floor)} · ${U.storeName(floor)} 전용`;
      $('kiosk-floor-label').textContent = `${U.storeName(floor)} 직원 출퇴근`;
      showStore(floor);
      // 연결된 기기는 주소의 store 값을 무시하고 연결할 때 지정한 매장을 따른다.
      // 아무 말이 없으면 다른 매장 버튼을 눌러도 같은 화면이 나와서 고장으로 보인다.
      const askedFloor = new URLSearchParams(location.search).has('store') ? setupFloor : floor;
      const mismatch = $('kiosk-store-mismatch');
      if (mismatch) {
        mismatch.hidden = askedFloor === floor;
        if (askedFloor !== floor) {
          mismatch.textContent = `이 기기는 ${U.storeName(floor)} 전용으로 연결돼 있어서 ${U.storeName(askedFloor)} 직원은 나오지 않습니다. 매장을 바꾸시려면 관리 페이지의 태블릿 관리에서 '매장 변경'을 눌러 주세요.`;
        }
      }
      $('kiosk-error').hidden = true;
      $('kiosk-setup').hidden = true;
      $('kiosk-main').hidden = false;
      connection(true, '출퇴근 기록 가능');
      tick(); render();
      window.AttendanceBookings?.connect(device, () => Date.now() + offset);
    } catch (error) {
      connection(false, '연결 확인 필요');
      if (error.status === 401) {
        device = '';
        window.AttendanceBookings?.clear();
        try { localStorage.removeItem(STORAGE_KEY); } catch (_) { /* ignore */ }
        $('kiosk-main').hidden = true;
        $('kiosk-setup').hidden = false;
        $('kiosk-setup-error').textContent = error.message;
      } else {
        $('kiosk-main').hidden = false;
        $('kiosk-error').textContent = error.message;
        $('kiosk-error').hidden = false;
      }
    } finally { loading = false; }
  }
  function choose(card) {
    if (dialogOpen) return;
    dialogOpen = true;
    const working = card.working;
    const pending = { employeeId: card.employee.id, kind: working ? 'out' : 'in', shiftId: card.shiftId, requestId: crypto.randomUUID() };
    const el = U.dialog(card.name,
      `<div class="att-avatar" aria-hidden="true">${U.esc(Array.from(card.name)[0])}</div><h2>${U.esc(card.name)} 님</h2><p class="att-confirm-kind">${working ? '오늘도 수고하셨습니다' : '좋은 하루 시작해요'}</p><p class="att-meta">${working ? `${U.date(card.checkInAt).slice(5)} ${U.time(card.checkInAt)} 출근 · 지금 퇴근을 기록할까요?` : card.slot ? '지금 출근을 기록할까요? 이 칸은 여러 분이 같이 쓸 수 있습니다.' : '지금 출근을 기록할까요?'}</p>`,
      async (_form, dialog) => {
        const result = await U.request('kiosk.punch', pending, { device });
        dialog.querySelector('form').innerHTML = `<div class="att-kiosk-success" role="status"><div class="att-success-mark">✓</div><h2>${U.esc(result.name)} 님</h2><p class="att-confirm-kind">${result.kind === 'in' ? '출근' : '퇴근'}이 기록되었어요</p><div class="att-shift-times">${U.time(result.at)}</div><p class="att-meta">잠시 후 직원 목록으로 돌아갑니다.</p></div>`;
        await new Promise(resolve => setTimeout(resolve, 1800));
        await load();
      }, { submitLabel: working ? '퇴근하기' : '출근하기' });
    el.classList.add('att-kiosk-dialog');
    el.querySelector('.att-dialog-head').remove();
    el.addEventListener('close', () => { dialogOpen = false; load(); });
  }
  $('kiosk-grid').onclick = event => {
    const button = event.target.closest('[data-employee]');
    if (!button) return;
    const card = buildCards().find(item => item.employee.id === button.dataset.employee && item.shiftId === button.dataset.shift);
    if (card) choose(card);
  };
  document.querySelectorAll('[data-filter]').forEach(button => { button.onclick = () => {
    filter = button.dataset.filter;
    document.querySelectorAll('[data-filter]').forEach(b => b.classList.toggle('active', b === button));
    render();
  }; });
  $('kiosk-search').oninput = render;
  $('kiosk-refresh').onclick = load;
  $('kiosk-fullscreen').onclick = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
    } catch (_) { connection(false, '전체 화면 전환 불가'); }
  };
  $('kiosk-setup-form').onsubmit = async event => {
    event.preventDefault();
    const button = event.target.querySelector('button');
    if (button.disabled) return;
    button.disabled = true;
    $('kiosk-setup-error').textContent = '';
    try {
      localStorage.setItem(`${STORAGE_KEY}-check`, '1');
      localStorage.removeItem(`${STORAGE_KEY}-check`);
      if (!setupAuth) {
        const app = firebase.initializeApp({ apiKey: 'AIzaSyCWXHJfMLW2Cf7pjI2u6X5QVKeGW6oC_3A', authDomain: 'gjsuragan-60505.firebaseapp.com', projectId: 'gjsuragan-60505' }, 'gjsuragan-attendance-setup');
        setupAuth = app.auth();
        await setupAuth.setPersistence(firebase.auth.Auth.Persistence.NONE);
      }
      const form = new FormData(event.target);
      const credential = await setupAuth.signInWithEmailAndPassword('sun1562@naver.com', form.get('password'));
      const result = await U.request('device.create', { name: form.get('name'), floor: Number(form.get('floor')) }, { token: await credential.user.getIdToken() });
      localStorage.setItem(STORAGE_KEY, result.token);
      device = result.token;
      await load();
    } catch (error) {
      $('kiosk-setup-error').textContent = error.code?.startsWith('auth/') ? '관리자 비밀번호와 인터넷 연결을 확인해 주세요.' : error.name === 'SecurityError' ? '브라우저 저장소 사용을 허용한 뒤 다시 연결해 주세요.' : error.message;
    } finally {
      event.target.elements.password.value = '';
      if (setupAuth) await setupAuth.signOut().catch(() => {});
      button.disabled = false;
    }
  };
  window.addEventListener('online', load);
  window.addEventListener('offline', () => { connection(false, '인터넷 연결 끊김'); $('kiosk-error').textContent = '인터넷 연결 후 출퇴근 버튼을 다시 눌러 주세요. 오프라인 상태에서는 기록되지 않습니다.'; $('kiosk-error').hidden = false; });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
  tick();
  setInterval(tick, 1000);
  setInterval(() => { if (!document.hidden && !dialogOpen) load(); }, 15000);
  if (device) load(); else { $('kiosk-setup').hidden = false; connection(false, '태블릿 연결 필요'); }
})();
