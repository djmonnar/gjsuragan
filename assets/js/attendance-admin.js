(function () {
  'use strict';
  const U = window.AttendanceUI;
  const $ = id => document.getElementById(id);
  let initialized = false, view = 'calendar', month = U.date(Date.now()).slice(0, 7), selectedDate = U.date(Date.now());
  let employeeId = '', floor = 'all', data = null, requestVersion = 0, timer = null, loading = false;
  const person = id => data?.employees.find(e => e.id === id);
  const inFloor = row => floor === 'all' || (row.floor ?? 1) === Number(floor);
  const records = () => (data?.shifts || []).filter(inFloor).filter(s => !employeeId || s.employeeId === employeeId);
  const people = () => [...(data?.employees || [])].sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  const monthlySalaryText = employee => employee?.payType !== 'salaried' ? '—'
    : Number.isSafeInteger(employee.monthlySalary) && employee.monthlySalary > 0 ? U.money(employee.monthlySalary) : '미설정';
  // 일당 직원·일일근무자 자리의 지급 조건 한 줄. 돈이 갈리는 설정이라 카드에서 바로 보여야 한다.
  const dailySettingText = e => {
    const base = minutesToHours(e.dailyBaseMinutes || DEFAULT_DAILY_BASE_MINUTES);
    const unit = e.overtimeUnitMinutes || DEFAULT_OVERTIME_UNIT_MINUTES;
    // 기준 뒤는 시급이 기본이고, 정액은 첫 회를 다르게 줄 때만 쓴다.
    const extra = e.overtimeHourlyRate
      ? (e.overtimePay
        ? ` · 기준 뒤 첫 ${unit}분 ${U.money(e.overtimePay)} · 이후 시급 ${U.money(e.overtimeHourlyRate)}`
        : ` · 기준 뒤 시급 ${U.money(e.overtimeHourlyRate)}`)
      : e.overtimePay ? ` · 기준 뒤 ${unit}분마다 ${U.money(e.overtimePay)}` : '';
    // 예정 출근 시각은 초과를 셀 때만 쓰지만, 돈이 갈리는 값이라 카드에 보여야 한다.
    const scheduled = e.scheduledStartMinutes ? ` · 예정 출근 ${minutesToClock(e.scheduledStartMinutes)}` : '';
    if (e.dailyMode === 'prorate') {
      const grace = Number.isFinite(Number(e.earlyGraceMinutes)) ? Number(e.earlyGraceMinutes) : DEFAULT_EARLY_GRACE_MINUTES;
      return `${base}시간 기준 · 일한 시간 비례 (${grace}분까지는 전액)${scheduled}${extra}`;
    }
    return `${base}시간 기준 · ${e.halfDayPay ? `${minutesToClock(e.halfDayBeforeMinutes || DEFAULT_HALF_DAY_BEFORE_MINUTES)} 전 퇴근·이후 출근은 반타임 ${U.money(e.halfDayPay)}` : '반타임 없음'}${scheduled}${extra}`;
  };
  const bankLabel = employee => employee?.privateSummary?.bankLast4
    ? `${employee.privateSummary.bankName} · •••• ${employee.privateSummary.bankLast4}` : '계좌 미등록';
  // attendanceModel 의 기본값과 같아야 한다. 서버가 실제 계산의 기준이고 여기는 미리보기다.
  const DEFAULT_WORK_HOURS = 209, DEFAULT_WORK_DAYS = 22;
  const DEFAULT_DAILY_BASE_MINUTES = 480, DEFAULT_OVERTIME_UNIT_MINUTES = 30, DEFAULT_HALF_DAY_BEFORE_MINUTES = 17 * 60;
  const DEFAULT_EARLY_GRACE_MINUTES = 30;
  // 유예는 0 이 '안 봐줌'이라는 뜻이라 빈칸과 다르다. 저장된 값이 있을 때만 그대로 보여준다.
  const graceValue = o => (isDailyPaid(o.payType) && Number.isFinite(Number(o.earlyGraceMinutes))
    ? String(o.earlyGraceMinutes) : '');
  // 지급 방식 두 줄짜리 고르개. 직원 설정과 근무 기록이 같은 문구를 쓴다.
  const modeField = o => `<label class="att-field">지급 방식<select class="att-input" name="dailyMode"><option value="portion" ${o.dailyMode !== 'prorate' ? 'selected' : ''}>반타임 · 풀타임</option><option value="prorate" ${o.dailyMode === 'prorate' ? 'selected' : ''}>일한 시간 비례</option></select><small><b>반타임 · 풀타임</b>은 정해진 시각 전에 퇴근하면 반타임 일당을 줍니다. <b>일한 시간 비례</b>는 기준 근무시간을 채운 만큼 줍니다 (6시간 중 3시간이면 절반).</small></label><label class="att-field att-prorate-only">일찍 퇴근 유예 (분)<input class="att-input" name="earlyGraceMinutes" type="number" min="0" max="1440" step="1" value="${graceValue(o)}" placeholder="${DEFAULT_EARLY_GRACE_MINUTES}"><small>이만큼까지 일찍 가는 건 깎지 않고 전액 줍니다. 비우면 ${DEFAULT_EARLY_GRACE_MINUTES}분, 0이면 1분부터 깎습니다.</small></label>`;
  const minutesToClock = minutes => `${String(Math.floor((Number(minutes) || 0) / 60)).padStart(2, '0')}:${String((Number(minutes) || 0) % 60).padStart(2, '0')}`;
  const clockToMinutes = value => {
    const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || '').trim());
    if (!match) return undefined;
    const minutes = Number(match[1]) * 60 + Number(match[2]);
    return minutes > 0 && minutes <= 1440 ? minutes : undefined;
  };
  // 일당으로 받는 사람은 자리(daily)와 정식 직원(perDiem) 둘 다다. 급여 계산은 같다.
  const isDailyPaid = payType => payType === 'daily' || payType === 'perDiem';
  const payTypeLabel = payType => payType === 'hourly' ? '시급' : payType === 'salaried' ? '월급' : payType === 'perDiem' ? '일당' : '일일';
  // 홀·주방·배송. 태블릿과 같은 순서로 나누고, 안 고른 사람은 '그 외'로 모은다.
  const PARTS = [{ key: 'hall', label: '홀' }, { key: 'kitchen', label: '주방' },
    { key: 'delivery', label: '배송' }, { key: 'none', label: '그 외' }];
  const partOf = employee => PARTS.some(p => p.key === employee?.part) ? employee.part : 'none';
  const partLabel = employee => partOf(employee) === 'none' ? '파트 미지정' : PARTS.find(p => p.key === partOf(employee)).label;
  // 파트가 하나뿐이면 제목을 넣지 않는다. 안 고른 매장에서 '그 외' 하나만 뜨면 군더더기다.
  function partGroups(list) {
    return PARTS.map(part => ({ label: part.label, list: list.filter(e => partOf(e) === part.key) })).filter(group => group.list.length);
  }
  // attendanceModel 의 WITHHOLDING_PER_MILLE 과 같아야 한다. 원 단위는 버린다.
  const WITHHOLDING_PER_MILLE = 33;
  const withholdingTax = amount => (Number(amount) > 0 ? Math.floor(Number(amount) * WITHHOLDING_PER_MILLE / 1000) : 0);
  const minutesToHours = minutes => String(Math.round((Number(minutes) || 0) / 6) / 10);
  const specialOn = date => (data?.specialDays || []).find(d => d.workDate === date) || null;
  const absencesOn = date => (data?.absences || []).filter(a => a.workDate === date).filter(inFloor);
  // 150 → '1.5배', 200 → '2배'
  const multiplierText = percent => `${String(Number(percent || 100) / 100)}배`;
  const scopeText = scope => scope === 'both' ? '시급·월급 모두' : scope === 'hourly' ? '시급 직원만' : '월급 직원만';
  const scopeApplies = (day, payType) => Boolean(day) && (day.appliesTo === 'both' || day.appliesTo === payType);
  const ordinaryRate = employee => employee?.payType !== 'salaried' || !(employee.monthlySalary > 0) ? 0
    : Math.round(employee.monthlySalary / (employee.monthlyWorkHours > 0 ? employee.monthlyWorkHours : DEFAULT_WORK_HOURS));
  const dailyDeduction = employee => employee?.payType !== 'salaried' || !(employee.monthlySalary > 0) ? 0
    : Math.round(employee.monthlySalary / (employee.monthlyWorkDays > 0 ? employee.monthlyWorkDays : DEFAULT_WORK_DAYS));
  // 3.3% 를 떼기 전 금액.
  function grossAmount(row) {
    // 일일근무자는 기록 하나가 한 사람이다. 일당에 초과 급여가 이미 더해져 있다.
    if (row.salaryType === 'daily') return Number(row.amount) || 0;
    // 한 달 안에서 급여 유형이 바뀌었으면 금액을 자동으로 낼 수 없다.
    if (row.type !== payTypeLabel(row.salaryType)) return null;
    // 시급 직원은 특수일 배율이, 일당 직원은 반타임·초과 급여가 amount 에 이미 들어 있다.
    if (row.salaryType !== 'salaried') return Number(row.amount) || 0;
    if (!(Number.isSafeInteger(row.monthlySalary) && row.monthlySalary > 0)) return null;
    // 월급은 소정근로만 덮는다. 특수일 근무는 더하고, 결근은 뺀다.
    // 값이 빠진 행이 와도 NaN 을 내보내지 않는다. 관리자가 복사해서 그대로 이체하는 금액이다.
    const extra = Number(row.extraAmount) || 0, deduction = Number(row.deduction) || 0;
    return Math.max(0, row.monthlySalary + extra - deduction);
  }
  // 실제로 건네줄 금액. 체크해둔 사람은 3.3% 를 떼고 준다.
  function transferAmount(row) {
    const gross = grossAmount(row);
    if (gross === null) return null;
    return row.withholding ? gross - withholdingTax(gross) : gross;
  }
  function feedback(message, failed = false) {
    if (!initialized) return;
    let toast = $('att-copy-feedback');
    if (!toast) { toast = document.createElement('div'); toast.id = 'att-copy-feedback'; toast.className = 'att-toast'; toast.setAttribute('role', 'status'); $('attendance-root').append(toast); }
    toast.textContent = message; toast.classList.toggle('is-error', failed);
    clearTimeout(feedback.timer); feedback.timer = setTimeout(() => toast.remove(), 3500);
  }
  async function copyText(value, label) {
    try {
      await navigator.clipboard.writeText(value);
    } catch (_) {
      const field = document.createElement('textarea'); field.value = value; field.className = 'att-clipboard-field'; document.body.append(field); field.select();
      let copied = false;
      try { copied = document.execCommand('copy'); } catch (_) { /* Manual selection remains available. */ }
      field.remove();
      if (!copied) {
        const dialog = U.dialog('복사할 내용', `<p class="att-note">아래 내용을 길게 눌러 복사해 주세요.</p><input class="att-input" readonly aria-label="복사할 내용" value="${U.esc(value)}">`, async () => {}, { submitLabel: '확인' });
        dialog.querySelector('input').select(); return;
      }
    }
    feedback(`${label} 복사했어요`);
  }
  async function copyBank(id, button) {
    button.disabled = true;
    try {
      const result = await api('employee.bank', { id });
      if (!initialized) return;
      if (!result.bankAccount) throw new Error('직원 정보에서 계좌를 먼저 등록해 주세요.');
      await copyText(result.bankAccount, '계좌번호를');
    } catch (error) { feedback(error.message, true); }
    finally { button.disabled = false; }
  }
  async function api(action, input = {}) {
    return U.request(action, input, { token: await window.AttendanceSession.getToken() });
  }
  function init() {
    if (initialized) return;
    initialized = true;
    $('attendance-root').innerHTML = `<div class="att-topline"><div><p class="att-eyebrow">STORE TEAM</p><h2>직원 · 근태 관리</h2><p class="att-subtitle">함께 일하는 직원들의 출퇴근과 급여를 한눈에 확인하세요.</p></div><div class="att-filters" style="width:auto"><button class="att-button" data-action="special-days">명절·특수일</button><button class="att-button" data-action="devices">태블릿 관리</button><a class="att-button" href="./attendance.html" target="_blank" rel="noopener">태블릿 화면 ↗</a><button class="att-button att-primary" data-action="new-employee">＋ 직원 등록</button></div></div><div class="att-stats" id="att-stats"></div><div class="att-toolbar"><div class="att-tabs" role="group" aria-label="관리 화면"><button class="att-tab active" data-view="calendar">근태 캘린더</button><button class="att-tab" data-view="employees">직원 관리</button><button class="att-tab" data-view="payroll">급여 정산</button></div><div class="att-filters"><button class="att-button" data-action="prev-month" aria-label="이전 달">‹</button><input class="att-input" type="month" id="att-month" aria-label="조회 월" min="2020-01" max="2099-12" value="${month}"><button class="att-button" data-action="next-month" aria-label="다음 달">›</button><select class="att-input" id="att-employee-filter" aria-label="직원 필터"><option value="">전체 직원</option></select><button class="att-button" data-action="refresh" aria-label="새로고침">↻</button></div></div><p class="att-error" id="att-load-error" role="alert"></p><div id="att-open-notice"></div><div id="att-content"><div class="att-empty">근태 정보를 불러오는 중…</div></div><p class="att-status" id="att-status" role="status"></p>`;
    $('att-stats').insertAdjacentHTML('beforebegin', '<div class="att-toolbar att-floor-toolbar"><div class="att-tabs" role="group" aria-label="근무 매장"><button class="att-tab active" data-floor="all" aria-pressed="true">전체 매장</button><button class="att-tab" data-floor="2" aria-pressed="false">궁중수라간</button><button class="att-tab" data-floor="1" aria-pressed="false">돌담명가</button></div><span class="att-meta">태블릿은 지정한 매장의 직원만 표시합니다.</span></div>');
    $('attendance-root').addEventListener('click', click);
    $('att-month').onchange = () => changeMonth($('att-month').value);
    $('att-employee-filter').onchange = () => { employeeId = $('att-employee-filter').value; render(); };
    load();
    timer = setInterval(() => { if (!document.hidden && !document.querySelector('dialog[open]') && window.AttendanceSession.isActive('attendance')) load(true); }, 60000);
  }
  function dispose() {
    requestVersion++; clearInterval(timer); clearTimeout(feedback.timer);
    data = null; loading = false; initialized = false;
    const root = $('attendance-root');
    if (root) { root.removeEventListener('click', click); root.innerHTML = ''; }
    document.querySelectorAll('dialog.att-dialog').forEach(el => el.close());
  }
  async function load(quiet = false) {
    if (!initialized) return;
    const sequence = ++requestVersion;
    loading = true;
    if (!quiet) $('att-status').textContent = '근태 정보를 불러오는 중…';
    try {
      const result = await api('admin.list', { month });
      if (sequence !== requestVersion || !initialized) return;
      data = result;
      $('att-load-error').textContent = '';
      $('att-status').textContent = `${U.time(result.serverNow)} 업데이트 · 한국 표준시 · 출근일 기준으로 표시합니다.`;
      render();
    } catch (error) {
      if (sequence !== requestVersion || !initialized) return;
      $('att-load-error').textContent = `${error.message} 새로고침 버튼으로 다시 불러올 수 있습니다.`;
      $('att-status').textContent = data ? '마지막으로 불러온 정보입니다.' : '';
      if (!data) $('att-content').innerHTML = '<div class="att-empty"><strong>근태 정보를 불러오지 못했습니다</strong>연결을 확인한 뒤 새로고침해 주세요.</div>';
    } finally { if (sequence === requestVersion) loading = false; }
  }
  function changeMonth(value) {
    if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(value)) { $('att-month').value = month; return; }
    month = value; selectedDate = `${month}-01`; $('att-month').value = month; data = null;
    $('att-stats').innerHTML = ''; $('att-open-notice').innerHTML = '';
    $('att-content').innerHTML = '<div class="att-empty">선택한 월을 불러오는 중…</div>';
    load();
  }
  function render() {
    document.querySelectorAll('[data-floor]').forEach(button => { const selected = button.dataset.floor === floor; button.classList.toggle('active', selected); button.setAttribute('aria-pressed', String(selected)); });
    if (!data) return;
    // Keep employees with historical records selectable even after a floor transfer.
    const eligible = people().filter(e => inFloor(e) || data.shifts.some(s => inFloor(s) && s.employeeId === e.id));
    if (!eligible.some(e => e.id === employeeId)) employeeId = '';
    $('att-employee-filter').innerHTML = '<option value="">전체 직원</option>' + eligible.map(e => `<option value="${U.esc(e.id)}">${U.esc(e.name)} · ${U.storeName(e.floor)}${e.deletedAt ? ' (삭제)' : !e.active ? ' (퇴사)' : ''}</option>`).join('');
    $('att-employee-filter').value = employeeId;
    const list = records();
    const opens = data.openShifts.filter(inFloor).filter(s => !employeeId || s.employeeId === employeeId);
    const active = data.employees.filter(inFloor).filter(e => e.active && !e.deletedAt && (!employeeId || e.id === employeeId));
    $('att-stats').innerHTML = [
      ['재직 직원', `${active.length}명`, '출퇴근 화면에 표시되는 직원'],
      ['현재 근무 중', `${opens.length}명`, '퇴근하지 않은 전체 근무'],
      ['이번 조회 월 유급 근무', U.duration(list.reduce((sum, s) => sum + s.payableMinutes, 0)), '퇴근 완료 · 무급 휴게 제외'],
      ['시급 직원 급여 합계', U.money(list.filter(s => s.payType === 'hourly').reduce((sum, s) => sum + s.amount, 0)), `${month.replace('-', '년 ')}월 · 퇴근 완료 · 특수일 배율 포함`]
    ].map(([label, value, detail]) => `<div class="att-stat"><div class="att-stat-label">${label}</div><div class="att-stat-value">${value}</div><small>${detail}</small></div>`).join('');
    const stale = opens.filter(s => data.serverNow - s.checkInAt > 18 * 3600000);
    $('att-open-notice').innerHTML = stale.length ? `<div class="att-notice">퇴근 확인이 필요한 기록 ${stale.length}건 · ${stale.map(s => `<button class="att-link-button" data-action="edit-shift" data-id="${U.esc(s.id)}">${U.esc(person(s.employeeId)?.name || s.employeeName)} (${s.workDate.slice(5)} ${U.time(s.checkInAt)})</button>`).join(' ')} · 미퇴근 기록은 급여 합계에서 제외됩니다.</div>` : '';
    document.querySelectorAll('[data-view]').forEach(button => button.classList.toggle('active', button.dataset.view === view));
    if (view === 'calendar') renderCalendar(list);
    if (view === 'employees') renderEmployees();
    if (view === 'payroll') renderPayroll(list);
  }
  function renderCalendar(list) {
    const [year, m] = month.split('-').map(Number);
    const start = new Date(Date.UTC(year, m - 1, 1)).getUTCDay();
    const days = new Date(Date.UTC(year, m, 0)).getUTCDate();
    const today = U.date(data.serverNow);
    const cells = Array.from({ length: start }, () => '<div class="att-day empty" aria-hidden="true"></div>');
    for (let day = 1; day <= days; day++) {
      const date = `${month}-${String(day).padStart(2, '0')}`;
      const daily = list.filter(s => s.workDate === date).sort((a, b) => a.checkInAt - b.checkInAt);
      const chips = daily.slice(0, 2).map(s => `<span class="att-day-chip ${s.checkOutAt === null ? 'open' : ''}">${U.esc(person(s.employeeId)?.name || s.employeeName)} ${U.time(s.checkInAt)}</span>`).join('');
      const special = specialOn(date), offCount = absencesOn(date).length;
      const marks = `${special ? `<span class="att-day-chip special">${U.esc(special.label)} ${multiplierText(special.multiplierPercent)}</span>` : ''}${offCount ? `<span class="att-day-chip absent">결근 ${offCount}명</span>` : ''}`;
      cells.push(`<button class="att-day ${selectedDate === date ? 'selected' : ''} ${today === date ? 'today' : ''}" data-date="${date}" aria-label="${m}월 ${day}일, 근무 ${daily.length}건${special ? `, ${special.label} ${multiplierText(special.multiplierPercent)}` : ''}${offCount ? `, 결근 ${offCount}명` : ''}" aria-pressed="${selectedDate === date}"><span class="att-day-number">${day}</span>${marks}${chips}${daily.length > 2 ? `<span class="att-day-more">+${daily.length - 2}건 더 보기</span>` : ''}</button>`);
    }
    while (cells.length % 7) cells.push('<div class="att-day empty" aria-hidden="true"></div>');
    const daily = list.filter(s => s.workDate === selectedDate).sort((a, b) => a.checkInAt - b.checkInAt);
    const special = specialOn(selectedDate), offList = absencesOn(selectedDate);
    const specialLine = special
      ? `<div class="att-notice">${U.esc(special.label)} · <strong>${multiplierText(special.multiplierPercent)}</strong> · ${scopeText(special.appliesTo)}${special.note ? ` · ${U.esc(special.note)}` : ''} <button class="att-link-button" data-action="special-days">특수일 관리</button></div>`
      : `<div class="att-meta att-day-special-empty">특수일 아님 · <button class="att-link-button" data-action="add-special">이 날 배율 지정</button></div>`;
    const offLine = offList.length
      ? `<div class="att-absence-list">${offList.map(a => `<div class="att-row"><span>결근 · <strong>${U.esc(person(a.employeeId)?.name || a.employeeName)}</strong>${a.note ? ` <span class="att-meta">${U.esc(a.note)}</span>` : ''}</span><button class="att-link-button" data-action="delete-absence" data-id="${U.esc(a.id)}">취소</button></div>`).join('')}</div>`
      : '';
    // 두 줄은 att-day-summary 바깥에 있어서 여백을 따로 줘야 한다.
    // 안 그러면 패널 가장자리에 붙어 위아래 줄과 어긋난다.
    const dayMeta = `<div class="att-day-meta">${specialLine}${offLine}</div>`;
    $('att-content').innerHTML = `<div class="att-layout"><section class="att-panel"><div class="att-panel-head att-row"><h3>${year}년 ${m}월</h3><div class="att-meta">날짜를 누르면 출퇴근 상세가 보여요</div></div><div class="att-calendar">${['일','월','화','수','목','금','토'].map(d => `<div class="att-weekday">${d}</div>`).join('')}${cells.join('')}</div></section><section class="att-panel"><div class="att-panel-head att-row"><h3>${Number(selectedDate.slice(5, 7))}월 ${Number(selectedDate.slice(8))}일</h3><div class="att-row" style="gap:8px"><button class="att-link-button" data-action="mark-absence">결근 표시</button><button class="att-link-button" data-action="new-shift">＋ 기록 추가</button></div></div>${dayMeta}<div class="att-day-summary">${daily.length ? daily.map(s => `<article class="att-shift-item"><div class="att-row"><strong>${U.esc(s.payType === 'daily' && s.workerName ? s.workerName : (person(s.employeeId)?.name || s.employeeName))}</strong><span class="att-pill ${s.checkOutAt === null ? 'amber' : 'green'}">${s.checkOutAt === null ? '근무 중' : '퇴근 완료'}</span></div><div class="att-shift-times">${U.time(s.checkInAt)} → ${s.checkOutAt !== null && U.date(s.checkOutAt) !== s.workDate ? '<small>익일 </small>' : ''}${U.time(s.checkOutAt)}</div><div class="att-meta">${s.checkOutAt === null ? '퇴근 후 근무시간과 금액이 계산됩니다.' : `${U.duration(s.payableMinutes)} · 휴게 ${s.breakMinutes}분`}</div><div class="att-row"><span class="att-meta">${s.payType === 'daily'
      ? `일일근무자 · ${U.money(s.amount)}${s.workerName ? ` · <strong>${U.esc(s.workerName)}</strong>` : ' · <b>이름 미입력</b>'}`
      : s.payType === 'hourly'
      ? `${U.money(s.hourlyRate)}/시간 · ${U.money(s.amount)}${s.extraAmount ? ` <strong>(${multiplierText(s.multiplierPercent)} · 가산 ${U.money(s.extraAmount)})</strong>` : ''}${s.earlyMinutes ? ` · 일찍 출근 ${s.earlyMinutes}분 제외` : ''}`
      : s.extraAmount ? `월급 직원 · 특수일 가산 <strong>${U.money(s.extraAmount)}</strong> (${multiplierText(s.multiplierPercent)})`
      : scopeApplies(special, 'salaried') ? '월급 직원 · 통상시급 미설정이라 가산 없음' : '월급 직원 · 근태 기록'}</span><button class="att-link-button" data-action="edit-shift" data-id="${U.esc(s.id)}">수정</button></div>${s.note ? `<div class="att-meta">${U.esc(s.note)}</div>` : ''}</article>`).join('') : '<div class="att-empty">이 날짜의 근무 기록이 없습니다.</div>'}</div></section></div><p class="att-note">날짜를 넘어 퇴근한 근무도 출근일에 표시됩니다. 빠뜨린 기록은 ‘기록 추가’, 잘못 찍은 시간과 휴게시간은 ‘수정’에서 보정하세요.<br>특수일 배율은 지금 설정을 기준으로 다시 계산합니다. 명절을 뒤늦게 등록해도 지난 기록에 바로 반영됩니다. 결근은 표시한 날만 공제하며, 출근 기록이 없다고 자동으로 결근이 되지는 않습니다.</p>`;
  }
  function renderEmployees() {
    const list = people().filter(inFloor).filter(e => !e.deletedAt && (!employeeId || e.id === employeeId));
    // 카드 사이에 파트 제목 줄을 끼운다. 제목은 그리드 한 줄을 다 쓴다.
    const groups = partGroups(list);
    const items = groups.length > 1
      ? groups.flatMap(group => [{ __header: group.label, count: group.list.length }, ...group.list])
      : list;
    $('att-content').innerHTML = `<div class="att-section-heading"><div><h3>직원 목록 <span class="att-meta">${list.length}명</span></h3><p class="att-subtitle">직원 정보와 급여 계좌를 관리하세요.</p></div></div><div class="att-employee-cards">${list.length ? items.map(e => e.__header ? `<h4 class="att-part-title att-part-row">${e.__header}<span>${e.count}명</span></h4>` : `<article class="att-employee-card">
      <div class="att-row"><div class="att-staff-identity"><span class="att-staff-avatar" aria-hidden="true">${U.esc(e.name.slice(0, 1))}</span><div><h4>${U.esc(e.name)}</h4><p class="att-meta">${U.storeName(e.floor)} · ${partLabel(e)} · ${U.esc(e.role || '업무 미지정')}</p></div></div><span class="att-pill ${e.currentShiftId ? 'green' : ''}">${e.currentShiftId ? '근무 중' : e.active ? '재직' : '퇴사·휴직'}</span></div>
      <div class="att-staff-pay"><span>${e.payType === 'hourly' ? '약정 시급' : isDailyPaid(e.payType) ? '기본 일당' : '약정 월급'}</span><strong>${e.payType === 'hourly' ? U.money(e.hourlyRate) : isDailyPaid(e.payType) ? U.money(e.dailyPay) : monthlySalaryText(e)}</strong></div>
      <div class="att-account-line"><div><span class="att-meta">급여 계좌</span><p>${U.esc(bankLabel(e))}</p></div><button class="att-copy-button" data-action="copy-bank" data-id="${U.esc(e.id)}" ${e.privateSummary?.bankLast4 ? '' : 'disabled'} aria-label="${U.esc(e.name)} 계좌번호 복사">계좌 복사</button></div>
      <div class="att-card-foot"><span class="att-meta">주민등록번호 ${e.privateSummary?.residentRegistered ? '등록됨' : '미등록'} · 휴게 ${e.breakMinutes}분${e.withholding ? ' · <b>3.3% 원천징수</b>' : ''}${isDailyPaid(e.payType) ? ` · ${dailySettingText(e)}` : ''}</span><div><button class="att-link-button" data-action="edit-employee" data-id="${U.esc(e.id)}">수정</button><button class="att-link-button att-delete-link" data-action="delete-employee" data-id="${U.esc(e.id)}">삭제</button></div></div>
    </article>`).join('') : '<div class="att-empty"><strong>함께 일할 직원을 등록해 주세요</strong>위의 직원 등록 버튼에서 시작할 수 있어요.</div>'}</div><p class="att-note">시급과 휴게시간 변경은 다음 출근부터 적용됩니다. 기존 근무는 당시 금액을 유지합니다. 주민등록번호는 직원 수정 화면에서 확인할 수 있습니다.<br><b>하루이틀만 일하는 단기 알바도 그대로 등록해서 쓰시면 됩니다.</b> 일이 끝나면 <b>삭제하지 말고 ‘재직 중’ 체크만 해제</b>하세요. 태블릿에서는 이름이 사라지고 근무기록·급여·계좌는 남습니다. 삭제하면 계좌번호가 지워져 급여를 보낼 때 확인할 수 없습니다. 같은 사람이 다시 오면 체크만 다시 켜면 됩니다.</p>`;
  }
  // 일일근무자는 한 자리를 여러 사람이 쓴다. 자리로 묶으면 누구에게 얼마를 줄지 알 수 없다.
  // 기록 하나가 곧 한 사람이므로 줄도 기록마다 따로 낸다.
  function dailyPayrollRows(list) {
    return list
      .filter(shift => shift.payType === 'daily' && shift.checkOutAt !== null)
      .sort((a, b) => a.checkInAt - b.checkInAt)
      .map(shift => ({
        id: `daily:${shift.id}`, shiftId: shift.id, salaryType: 'daily', type: '일일',
        name: shift.workerName || '이름 미입력', named: Boolean(shift.workerName),
        slotName: person(shift.employeeId)?.name || shift.employeeName || '일일근무자',
        workDate: shift.workDate, checkInAt: shift.checkInAt, checkOutAt: shift.checkOutAt,
        workerNote: shift.workerNote || '', deleted: false,
        days: 1, count: 1, minutes: shift.payableMinutes, breaks: shift.breakMinutes, open: 0,
        amount: shift.amount, baseAmount: shift.amount, extraAmount: 0, specialDays: 0,
        absenceDays: 0, deduction: 0, ordinaryRate: 0, monthlySalary: null,
        dayPortion: shift.dayPortion || 'full',
        overtimeAmount: shift.extraAmount || 0, overtimeUnits: shift.overtimeUnits || 0,
        overtimeUnitMinutes: shift.overtimeUnitMinutes || 0, dailyPay: shift.baseAmount || 0,
        withholding: Boolean(shift.withholding)
      }));
  }
  function payrollRows(list) {
    // 일일근무자 기록은 여기서 빼고 따로 낸다.
    const regular = list.filter(shift => shift.payType !== 'daily');
    const ids = new Set([...data.employees.filter(inFloor).filter(e => !e.deletedAt && e.payType !== 'daily' && (!employeeId || e.id === employeeId)).map(e => e.id), ...regular.map(s => s.employeeId)]);
    list = regular;
    return [...ids].map(id => {
      const employee = person(id), own = list.filter(s => s.employeeId === id), completed = own.filter(s => s.checkOutAt !== null);
      const offDays = (data.absences || []).filter(a => a.employeeId === id).filter(inFloor);
      return { id, name: employee?.name || own[0]?.employeeName || '삭제된 직원', deleted: Boolean(employee?.deletedAt),
        type: own.length ? [...new Set(own.map(s => s.payType))].map(payTypeLabel).join(' / ') : payTypeLabel(employee?.payType),
        salaryType: employee?.payType, monthlySalary: employee?.monthlySalary ?? null,
        days: new Set(completed.map(s => s.workDate)).size, count: completed.length,
        minutes: completed.reduce((sum, s) => sum + s.payableMinutes, 0), breaks: completed.reduce((sum, s) => sum + s.breakMinutes, 0),
        amount: completed.reduce((sum, s) => sum + s.amount, 0), open: own.length - completed.length,
        baseAmount: completed.reduce((sum, s) => sum + (s.baseAmount || 0), 0),
        extraAmount: completed.reduce((sum, s) => sum + (s.extraAmount || 0), 0),
        // 일당 직원은 하루하루가 풀타임인지, 반타임인지, 일한 만큼인지 갈린다.
        fullDays: completed.filter(s => s.payType === 'perDiem' && s.dayPortion !== 'half' && s.dayPortion !== 'part').length,
        halfDays: completed.filter(s => s.payType === 'perDiem' && s.dayPortion === 'half').length,
        halfShiftAmounts: completed.filter(s => s.payType === 'perDiem' && s.dayPortion === 'half').map(s => s.baseAmount || 0),
        partDays: completed.filter(s => s.payType === 'perDiem' && s.dayPortion === 'part').length,
        partShiftAmounts: completed.filter(s => s.payType === 'perDiem' && s.dayPortion === 'part').map(s => s.baseAmount || 0),
        specialDays: new Set(completed.filter(s => s.extraAmount).map(s => s.workDate)).size,
        absenceDays: offDays.length, deduction: dailyDeduction(employee) * offDays.length,
        ordinaryRate: ordinaryRate(employee), withholding: Boolean(employee?.withholding) };
    }).sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  }
  // 반타임으로 지급된 날의 합계. 풀타임 금액은 전체에서 이걸 빼서 낸다.
  function halfDayTotal(row) {
    return (row.halfShiftAmounts || []).reduce((sum, value) => sum + value, 0);
  }
  // 정해진 시간을 못 채워 일한 만큼만 준 날의 합계.
  function partDayTotal(row) {
    return (row.partShiftAmounts || []).reduce((sum, value) => sum + value, 0);
  }
  // 입금 기준액이 어떻게 나왔는지 줄 단위로 보여준다.
  // 합계 하나만 보여주면 왜 이 금액인지 확인할 방법이 없다.
  function payrollBreakdown(row) {
    const lines = [];
    if (row.salaryType === 'salaried' && Number.isSafeInteger(row.monthlySalary) && row.monthlySalary > 0) {
      lines.push(['약정 월급', U.money(row.monthlySalary)]);
      if (row.extraAmount) lines.push([`특수일 가산 (${row.specialDays}일 · 통상시급 ${U.money(row.ordinaryRate)})`, `+ ${U.money(row.extraAmount)}`]);
      if (row.deduction) lines.push([`결근 공제 (${row.absenceDays}일)`, `− ${U.money(row.deduction)}`]);
    } else if (row.salaryType === 'perDiem') {
      if (row.fullDays) lines.push([`풀타임 ${row.fullDays}일`, U.money(row.baseAmount - halfDayTotal(row) - partDayTotal(row))]);
      if (row.halfDays) lines.push([`반타임 ${row.halfDays}일`, U.money(halfDayTotal(row))]);
      if (row.partDays) lines.push([`일찍 퇴근 ${row.partDays}일 · 일한 만큼`, U.money(partDayTotal(row))]);
      if (row.extraAmount) lines.push(['초과 근무 추가 급여', `+ ${U.money(row.extraAmount)}`]);
      if (row.absenceDays) lines.push([`결근 표시 ${row.absenceDays}일`, '일당은 공제 없음']);
    } else if (row.salaryType === 'hourly') {
      lines.push(['기본급', U.money(row.baseAmount)]);
      if (row.extraAmount) lines.push([`특수일 가산 (${row.specialDays}일)`, `+ ${U.money(row.extraAmount)}`]);
      if (row.absenceDays) lines.push([`결근 표시 ${row.absenceDays}일`, '시급은 공제 없음']);
    }
    const gross = grossAmount(row);
    if (row.withholding && gross !== null) {
      lines.push(['원천징수 3.3%', `− ${U.money(withholdingTax(gross))}`]);
    }
    // 줄 하나가 합계를 그대로 되풀이하면 보여줄 것이 없다.
    // 다만 일당 직원은 그 한 줄이 '왜 이 금액인지'를 말해 주므로 남긴다.
    if (lines.length < 2 && row.salaryType !== 'perDiem') return '';
    if (!lines.length) return '';
    return `<div class="att-payout-lines">${lines.map(([label, value]) => `<div class="att-row"><span class="att-meta">${label}</span><span>${value}</span></div>`).join('')}</div>`;
  }
  // 일당에 무엇이 더해지고 빠졌는지. 합계만 보여주면 왜 이 금액인지 알 수 없다.
  function dailyBreakdown(row) {
    const lines = [['일당', U.money(row.dailyPay)]];
    if (row.overtimeAmount) {
      // 회수보다 '몇 분을 넘겼는지' 가 읽기 쉽고, 정액·시급이 섞여도 말이 맞는다.
      lines.push([`추가 급여 (기준 초과 ${(row.overtimeUnitMinutes || 30) * row.overtimeUnits}분)`, `+ ${U.money(row.overtimeAmount)}`]);
    }
    if (row.withholding) lines.push(['원천징수 3.3%', `− ${U.money(withholdingTax(row.amount))}`]);
    if (lines.length < 2) return '';
    return `<div class="att-payout-lines">${lines.map(([label, value]) => `<div class="att-row"><span class="att-meta">${label}</span><span>${value}</span></div>`).join('')}</div>`;
  }
  // 일일근무자 줄. 이름을 아직 안 적은 것이 위로 오게 해서 빠뜨리지 않게 한다.
  function dailyPayrollHtml(rows) {
    if (!rows.length) return '';
    const total = rows.reduce((sum, row) => sum + transferAmount(row), 0);
    const unnamed = rows.filter(row => !row.named).length;
    const sorted = [...rows].sort((a, b) => (a.named === b.named ? a.checkInAt - b.checkInAt : a.named ? 1 : -1));
    return `<section class="att-payroll att-daily-payroll"><div class="att-section-heading"><div><h3>일일근무자 <span class="att-meta">${rows.length}건</span></h3><p class="att-subtitle">한 건이 한 사람입니다. 이름을 적고 금액을 확인한 뒤 지급하세요.</p></div></div>
      ${unnamed ? `<div class="att-notice">이름을 아직 안 적은 기록이 <b>${unnamed}건</b> 있습니다. 누구에게 줄 금액인지 알 수 없으니 먼저 적어 주세요.</div>` : ''}
      <div class="att-payroll-cards">${sorted.map(row => `<article class="att-payroll-card${row.named ? '' : ' is-unnamed'}"><div class="att-payroll-person"><div class="att-row"><strong class="att-staff-name-plain">${U.esc(row.name)}</strong><span class="att-pill">${U.esc(row.slotName)}</span></div><p class="att-meta">${formatDayLabel(row.workDate)} · ${U.time(row.checkInAt)} → ${U.time(row.checkOutAt)} · ${U.duration(row.minutes)}${row.breaks ? ` · 휴게 ${row.breaks}분` : ''}</p>${row.workerNote ? `<p class="att-meta">${U.esc(row.workerNote)}</p>` : ''}</div>
        <div class="att-payroll-transfer">${dailyBreakdown(row)}<div class="att-payout"><div><span class="att-meta">${row.withholding ? '실지급액 (3.3% 뗀 금액)' : '지급액'}</span><strong>${U.money(transferAmount(row))}</strong></div><button class="att-copy-button att-copy-primary" data-action="copy-amount" data-id="${U.esc(row.id)}" aria-label="${U.esc(row.name)} 지급액 복사">금액 복사</button></div>
        <button class="att-button" data-action="edit-shift" data-id="${U.esc(row.shiftId)}">${row.named ? '이름·금액 수정' : '이름 적기'}</button></div></article>`).join('')}</div>
      <div class="att-payroll-total"><span>일일근무자 실지급 합계</span><strong>${U.money(total)}</strong></div></section>
      <p class="att-note">일일근무자는 시간이 아니라 하루 단위로 계산합니다. <b>기준 근무시간</b>을 넘기면 <b>추가 급여 단위</b>마다 금액이 더 붙습니다 (기본 8시간 · 30분 · 30분을 넘겨야 첫 회가 붙습니다). <b>초과 시급</b>을 넣으면 기준을 넘긴 시간을 그 시급으로 계산합니다 (30분 단위면 회당 절반). <b>단위당 추가 급여</b>는 첫 회만 다르게 줄 때 쓰는 선택 칸입니다. <b>예정 출근 시각</b>을 정해 두면 그보다 일찍 찍은 시간은 초과로 세지 않습니다. 특수일 배율은 붙지 않으니, 더 드릴 금액은 그 기록의 <b>이 근무의 일당</b>을 직접 고쳐 주세요.<br>3.3%를 체크한 기록은 뗀 금액이 표시되고 <b>금액 복사</b>도 그 금액으로 복사됩니다.</p>`;
  }
  function formatDayLabel(dateStr) {
    return `${Number(dateStr.slice(5, 7))}월 ${Number(dateStr.slice(8))}일`;
  }
  function renderPayroll(list) {
    const rows = payrollRows(list), amount = rows.reduce((sum, row) => sum + row.amount, 0);
    const dailyRows = dailyPayrollRows(list);
    $('att-content').innerHTML = `<section class="att-payroll"><div class="att-section-heading"><div><h3>${Number(month.slice(5))}월 급여 정산</h3><p class="att-subtitle">계좌와 입금 기준액을 복사해서 이체할 때 사용하세요.</p></div><button class="att-button" data-action="export">CSV 내려받기 ↓</button></div><div class="att-payroll-cards">${rows.length ? rows.map(row => {
      const employee = person(row.id), payout = transferAmount(row);
      return `<article class="att-payroll-card"><div class="att-payroll-person"><div class="att-row"><button class="att-staff-name" data-action="employee-calendar" data-id="${U.esc(row.id)}">${U.esc(row.name)}${row.deleted ? ' (삭제)' : ''}</button><span class="att-pill">${row.type}</span></div><p class="att-meta">${floor === 'all' ? '전체 매장' : U.storeName(floor)} · ${month.replace('-', '년 ')}월</p><div class="att-payroll-metrics"><div><span>출근 / 근무</span><strong>${row.days}일 / ${row.count}건</strong></div><div><span>유급 근무</span><strong>${U.duration(row.minutes)}</strong></div><div><span>무급 휴게</span><strong>${row.breaks}분</strong></div><div><span>미퇴근</span><strong class="${row.open ? 'att-amber-text' : ''}">${row.open}건</strong></div></div></div>
        <div class="att-payroll-transfer"><div class="att-account-line"><div><span class="att-meta">${U.esc(employee?.privateSummary?.accountHolder || row.name)} · 급여 계좌</span><p>${U.esc(bankLabel(employee))}</p></div><button class="att-copy-button" data-action="copy-bank" data-id="${U.esc(row.id)}" ${employee?.privateSummary?.bankLast4 && !row.deleted ? '' : 'disabled'} aria-label="${U.esc(row.name)} 계좌번호 복사">계좌 복사</button></div>
        <div class="att-payout"><div><span class="att-meta">${row.salaryType === 'salaried' ? '월급 · 특수일 가산 · 결근 공제 반영' : row.salaryType === 'perDiem' ? '일당 합계 (반타임 · 비례 · 추가 급여 반영)' : '시급 근무 급여 (배율 포함)'}</span><strong>${payout === null ? (row.type.includes('/') || row.type !== payTypeLabel(row.salaryType) ? '급여 유형 확인 필요' : '월급 미설정') : U.money(payout)}</strong></div><button class="att-copy-button att-copy-primary" data-action="copy-amount" data-id="${U.esc(row.id)}" ${payout === null ? 'disabled' : ''} aria-label="${U.esc(row.name)} 입금 기준액 복사">금액 복사</button></div>${payrollBreakdown(row)}${row.type.includes('/') ? `<p class="att-meta">시급 근무 급여 ${U.money(row.amount)} · 월급과 별도로 확인해 주세요.</p>` : ''}</div></article>`;
    }).join('') : '<div class="att-empty">등록된 직원과 근무 기록이 없습니다.</div>'}</div><div class="att-payroll-total"><span>시급 직원 기본급 합계</span><strong>${U.money(amount)}</strong></div></section>${dailyPayrollHtml(dailyRows)}<p class="att-note">복사되는 금액은 원 단위 숫자입니다. 시급 직원은 조회 월·매장의 퇴근 완료 급여(특수일 배율 포함), 월급 직원은 약정 월급에 특수일 가산을 더하고 결근 공제를 뺀 금액입니다. 미퇴근 기록과 주휴·연장·야간수당, 4대보험 공제는 포함하지 않습니다. <b>3.3% 원천징수는 체크한 사람만</b> 빼고 보여줍니다.<br>월급 직원의 특수일 가산은 <b>근무시간 × 통상시급 × 배율</b>입니다. 통상시급은 <b>월급 ÷ 월 소정근로시간</b>, 결근 하루치는 <b>월급 ÷ 월 소정근로일수</b>로 내며 두 값은 직원 정보에서 바꿀 수 있습니다.<br>약정 월급은 직원 정보의 최신 설정이며 조회 월의 확정 지급액은 아닙니다. 급여 유형이 바뀐 달은 금액을 직접 확인해 주세요.</p>`;
  }
  async function employeeForm(employee = null) {
    let details = { residentNumber: '', bankName: '', bankAccount: '', accountHolder: '' };
    if (employee) {
      try {
        const response = await api('employee.private', { id: employee.id });
        if (!initialized) return;
        if (response.version !== employee.version) { await load(); throw new Error('직원 정보가 변경되어 새로고침했습니다. 수정을 다시 눌러 주세요.'); }
        details = response.privateDetails;
      } catch (error) { feedback(error.message, true); return; }
    }
    const e = employee || { name: '', role: '', floor: floor === 'all' ? 2 : Number(floor), payType: 'hourly', hourlyRate: '', monthlySalary: '', monthlyWorkHours: '', monthlyWorkDays: '', dailyPay: '', halfDayPay: '', halfDayBeforeMinutes: '', dailyBaseMinutes: '', scheduledStartMinutes: '', overtimeUnitMinutes: '', overtimePay: '', overtimeHourlyRate: '', breakMinutes: 0, active: true, note: '' };
    const dialog = U.dialog(employee ? '직원 정보 수정' : '새 직원 등록', `<div class="att-form-grid"><label class="att-field">이름<input class="att-input" name="name" value="${U.esc(e.name)}" maxlength="40" required placeholder="예: 김수라"></label><label class="att-field">담당 업무<input class="att-input" name="role" value="${U.esc(e.role)}" maxlength="40" placeholder="예: 조리 / 포장 / 배송"></label><label class="att-field">파트<select class="att-input" name="part"><option value="none" ${partOf(e) === 'none' ? 'selected' : ''}>미지정</option><option value="hall" ${partOf(e) === 'hall' ? 'selected' : ''}>홀</option><option value="kitchen" ${partOf(e) === 'kitchen' ? 'selected' : ''}>주방</option><option value="delivery" ${partOf(e) === 'delivery' ? 'selected' : ''}>배송</option></select><small>태블릿 출퇴근 화면을 홀·주방·배송으로 나눠 보여줍니다.</small></label></div><div class="att-form-grid"><label class="att-field">급여 유형<select class="att-input" name="payType"><option value="hourly" ${e.payType === 'hourly' ? 'selected' : ''}>시급 아르바이트</option><option value="salaried" ${e.payType === 'salaried' ? 'selected' : ''}>월급 직원</option><option value="perDiem" ${e.payType === 'perDiem' ? 'selected' : ''}>일당 직원</option><option value="daily" ${e.payType === 'daily' ? 'selected' : ''}>일일근무자 자리</option></select></label><label class="att-field">시급 (원)<input class="att-input" name="hourlyRate" type="number" min="1" max="1000000" step="1" value="${e.hourlyRate || ''}" placeholder="약정 시급 입력" required></label><label class="att-field">월급 (원)<input class="att-input" name="monthlySalary" type="number" min="1" max="100000000" step="1" value="${e.monthlySalary || ''}" placeholder="예: 3000000"><small>한 달 약정 금액을 입력하세요.</small></label><label class="att-field">풀타임 일당 (원)<input class="att-input" name="dailyPay" type="number" min="1" max="10000000" step="1" value="${e.dailyPay || ''}" placeholder="예: 100000"><small>하루 일했을 때 줄 금액입니다. 정산할 때 기록마다 고칠 수 있습니다.</small></label></div><div class="att-form-grid att-daily-only">${modeField(e)}</div><div class="att-form-grid att-portion-only"><label class="att-field">반타임 일당 (원)<input class="att-input" name="halfDayPay" type="number" min="0" max="10000000" step="1" value="${e.halfDayPay || ''}" placeholder="예: 55000"><small>비우거나 0이면 반타임 없이 늘 풀타임 일당입니다.</small></label><label class="att-field">반타임 기준 시각<input class="att-input" name="halfDayBefore" type="time" step="60" value="${minutesToClock(e.halfDayBeforeMinutes || DEFAULT_HALF_DAY_BEFORE_MINUTES)}"><small>점심·저녁을 가르는 선입니다. 이 시각 <b>전에</b> 퇴근하거나 이 시각 <b>이후에</b> 출근하면 반타임으로 칩니다 (한국시간). 기본 ${minutesToClock(DEFAULT_HALF_DAY_BEFORE_MINUTES)}.</small></label></div><div class="att-form-grid att-daily-only"><label class="att-field">기준 근무시간<input class="att-input" name="dailyBaseHours" type="number" min="0.5" max="24" step="0.5" value="${e.dailyBaseMinutes ? minutesToHours(e.dailyBaseMinutes) : ''}" placeholder="${minutesToHours(DEFAULT_DAILY_BASE_MINUTES)}"><small>일당이 덮는 근무시간입니다. 이만큼 채우면 전액이고, 넘기면 추가 급여가 붙습니다. 비우면 ${minutesToHours(DEFAULT_DAILY_BASE_MINUTES)}시간.</small></label><label class="att-field">추가 급여 단위 (분)<input class="att-input" name="overtimeUnitMinutes" type="number" min="1" max="1440" step="1" value="${e.overtimeUnitMinutes || ''}" placeholder="${DEFAULT_OVERTIME_UNIT_MINUTES}"><small>기준을 넘긴 뒤 이만큼마다 추가 급여가 붙습니다. 비우면 ${DEFAULT_OVERTIME_UNIT_MINUTES}분.</small></label><label class="att-field">초과 시급 (원)<input class="att-input" name="overtimeHourlyRate" type="number" min="0" max="1000000" step="1" value="${e.overtimeHourlyRate || ''}" placeholder="예: 12000"><small>기준 근무시간을 넘긴 시간은 <b>이 시급으로</b> 계산합니다. 단위가 30분이면 회당 시급의 절반입니다 — 시급 12,000원이면 30분에 6,000원.</small></label><label class="att-field">단위당 추가 급여 (원, 선택)<input class="att-input" name="overtimePay" type="number" min="0" max="10000000" step="1" value="${e.overtimePay || ''}" placeholder="보통 비워둡니다"><small>첫 회만 다르게 줄 때 씁니다 — 이 금액은 첫 단위에만 주고 그 뒤부터 시급으로 셉니다. 초과 시급을 비우면 단위마다 이 금액입니다. <b>둘 다 비우면 추가 급여를 주지 않습니다.</b></small></label></div><div class="att-form-grid att-salaried-only"><label class="att-field">월 소정근로시간<input class="att-input" name="monthlyWorkHours" type="number" min="1" max="744" step="1" value="${e.monthlyWorkHours || ''}" placeholder="${DEFAULT_WORK_HOURS}"><small>특수일 가산의 기준인 통상시급 = 월급 ÷ 이 값. 비우면 ${DEFAULT_WORK_HOURS}시간.</small></label><label class="att-field">월 소정근로일수<input class="att-input" name="monthlyWorkDays" type="number" min="1" max="31" step="1" value="${e.monthlyWorkDays || ''}" placeholder="${DEFAULT_WORK_DAYS}"><small>결근 하루치 = 월급 ÷ 이 값. 비우면 ${DEFAULT_WORK_DAYS}일.</small></label></div><div class="att-form-grid"><label class="att-field">예정 출근 시각<input class="att-input" name="scheduledStart" type="time" step="60" value="${e.scheduledStartMinutes ? minutesToClock(e.scheduledStartMinutes) : ''}" placeholder="예: 07:00"><small>정해진 출근 시각입니다. 이보다 <b>일찍 찍은 시간은 급여에서 빠집니다</b> — 7시 출근인데 6시 50분에 찍어도 7시부터 셉니다 (일당 직원은 추가 급여만). 늦게 온 날은 찍힌 시각부터 셉니다. 비우면 찍힌 시각 그대로입니다.</small></label><label class="att-field">기본 무급 휴게시간 (분)<input class="att-input" name="breakMinutes" type="number" min="0" max="720" step="1" value="${e.breakMinutes}" required><small>매 근무에서 차감할 시간입니다. 자동 차감을 원하지 않으면 0분으로 두세요.</small></label></div><label class="att-field">관리자 메모<textarea class="att-input" name="note" maxlength="500" placeholder="태블릿에는 표시되지 않습니다">${U.esc(e.note)}</textarea></label><label class="att-check"><input type="checkbox" name="withholding" ${e.withholding ? 'checked' : ''}>급여에서 3.3% 원천징수하고 지급</label><label class="att-check"><input type="checkbox" name="active" ${e.active ? 'checked' : ''}>재직 중 · 태블릿에 이름 표시</label>`, async form => {
      await api('employee.save', { id: employee?.id, version: employee?.version, name: form.get('name'), role: form.get('role'), part: form.get('part') || 'none', floor: Number(form.get('floor')), payType: form.get('payType'), hourlyRate: Number(form.get('hourlyRate')), monthlySalary: form.has('monthlySalary') ? Number(form.get('monthlySalary')) : undefined, monthlyWorkHours: form.get('monthlyWorkHours') ? Number(form.get('monthlyWorkHours')) : undefined, monthlyWorkDays: form.get('monthlyWorkDays') ? Number(form.get('monthlyWorkDays')) : undefined, dailyPay: Number(form.get('dailyPay')), halfDayPay: Number(form.get('halfDayPay')) || 0, halfDayBeforeMinutes: clockToMinutes(form.get('halfDayBefore')), dailyMode: form.get('dailyMode') || undefined, earlyGraceMinutes: form.get('earlyGraceMinutes') ? Number(form.get('earlyGraceMinutes')) : undefined, dailyBaseMinutes: form.get('dailyBaseHours') ? Math.round(Number(form.get('dailyBaseHours')) * 60) : undefined, overtimeUnitMinutes: form.get('overtimeUnitMinutes') ? Number(form.get('overtimeUnitMinutes')) : undefined, overtimePay: Number(form.get('overtimePay')) || 0, scheduledStartMinutes: clockToMinutes(form.get('scheduledStart')) ?? 0, overtimeHourlyRate: Number(form.get('overtimeHourlyRate')) || 0, breakMinutes: Number(form.get('breakMinutes')), note: form.get('note'), active: form.has('active'), withholding: form.has('withholding'), privateDetails: { residentNumber: form.get('residentNumber'), bankName: form.get('bankName'), bankAccount: form.get('bankAccount'), accountHolder: form.get('accountHolder') } });
      await load();
    });
    dialog.querySelector('.att-form-grid').insertAdjacentHTML('afterend', `<label class="att-field">근무 매장<select class="att-input" name="floor"><option value="2" ${e.floor === 2 ? 'selected' : ''}>궁중수라간</option><option value="1" ${(e.floor ?? 1) === 1 ? 'selected' : ''}>돌담명가</option></select><small>지정한 매장의 태블릿에만 표시됩니다. 근무 중인 직원은 퇴근 후 매장을 변경하세요.</small></label>`);
    const fields = document.createElement('div');
    fields.innerHTML = `<fieldset class="att-form-section"><legend>급여 계좌 <small>선택 입력</small></legend><div class="att-form-grid"><label class="att-field">은행명<input class="att-input" name="bankName" maxlength="40" autocomplete="off" value="${U.esc(details.bankName)}" placeholder="예: 국민은행" list="att-bank-options"><datalist id="att-bank-options">${['국민은행','신한은행','우리은행','하나은행','농협은행','기업은행','카카오뱅크','토스뱅크','케이뱅크','새마을금고','신협','우체국','수협은행','부산은행','경남은행','iM뱅크'].map(name => `<option value="${name}"></option>`).join('')}</datalist></label><label class="att-field">예금주<input class="att-input" name="accountHolder" maxlength="40" autocomplete="off" value="${U.esc(details.accountHolder)}" placeholder="${U.esc(e.name || '직원 이름')}"></label></div><label class="att-field">계좌번호<input class="att-input" name="bankAccount" inputmode="numeric" maxlength="50" autocomplete="off" value="${U.esc(details.bankAccount)}" placeholder="숫자 또는 하이픈 포함"><small>앞자리 0도 그대로 저장됩니다.</small></label></fieldset>
      <details class="att-sensitive"><summary>주민등록번호 <span>${details.residentNumber ? '등록됨' : '선택 입력'}</span></summary><label class="att-field">주민등록번호<div class="att-private-input"><input class="att-input" name="residentNumber" type="password" inputmode="numeric" maxlength="20" autocomplete="new-password" value="${U.esc(details.residentNumber)}" placeholder="13자리 · 하이픈 생략 가능"><button class="att-copy-button" type="button" data-private-reveal aria-label="주민등록번호 표시" aria-pressed="false">보기</button></div><small>관리자만 확인할 수 있습니다. 비워서 저장하면 삭제됩니다.</small></label></details>`;
    dialog.querySelector('[name=note]').closest('.att-field').before(fields);
    dialog.querySelector('[data-private-reveal]').onclick = event => {
      const field = dialog.querySelector('[name=residentNumber]'), visible = field.type === 'password';
      field.type = visible ? 'text' : 'password'; event.currentTarget.textContent = visible ? '가리기' : '보기'; event.currentTarget.setAttribute('aria-pressed', String(visible));
    };
    bindPayType(dialog);
  }
  // 급여 유형이 세 갈래라 칸도 세 갈래로 나뉜다.
  // 숨긴 칸은 disabled 로 둬서 폼 검증과 저장값에서 빠지게 한다.
  function bindPayType(dialog) {
    const payType = dialog.querySelector('[name=payType]');
    const show = (input, on) => {
      if (!input) return;
      const box = input.closest('.att-field');
      if (box) box.hidden = !on;
      input.disabled = !on;
      input.required = on;
    };
    const sync = () => {
      const kind = payType.value;
      show(dialog.querySelector('[name=hourlyRate]'), kind === 'hourly');
      show(dialog.querySelector('[name=monthlySalary]'), kind === 'salaried');
      show(dialog.querySelector('[name=dailyPay]'), isDailyPaid(kind));
      // 소정근로시간·일수는 월급 직원에게만 쓰인다.
      dialog.querySelectorAll('.att-salaried-only').forEach(box => { box.hidden = kind !== 'salaried'; });
      dialog.querySelectorAll('.att-salaried-only input').forEach(input => { input.disabled = kind !== 'salaried'; });
      // 누가 일했는지는 일일근무자 기록에만 적는다.
      // 일당 전용 칸은 자리와 일당 직원 모두에게 쓴다.
      dialog.querySelectorAll('.att-daily-only').forEach(box => { box.hidden = !isDailyPaid(kind); });
      dialog.querySelectorAll('.att-daily-only input, .att-daily-only select').forEach(input => { input.disabled = !isDailyPaid(kind); });
      // 누가 일했는지·지급 메모는 일일근무자 자리의 기록에서만 쓴다.
      dialog.querySelectorAll('.att-worker-only').forEach(box => { box.hidden = !isDailyPaid(kind); });
      dialog.querySelectorAll('.att-worker-only input').forEach(input => { input.disabled = !isDailyPaid(kind); });
      // 체크박스는 att-check 라 show() 의 att-field 찾기에 안 걸린다. 여기서 직접 여닫는다.
      const withholdBox = dialog.querySelector('.att-check.att-worker-only');
      if (withholdBox) withholdBox.hidden = !isDailyPaid(kind);
      // 반타임 칸과 유예 칸은 지급 방식에 따라 한쪽만 쓴다.
      // 안 쓰는 칸을 열어두면 뭘 채워야 하는지 헷갈리고, 값이 딸려 들어간다.
      const mode = dialog.querySelector('[name=dailyMode]');
      const prorate = isDailyPaid(kind) && mode && mode.value === 'prorate';
      const toggle = (selector, on) => {
        dialog.querySelectorAll(selector).forEach(box => { box.hidden = !on; });
        dialog.querySelectorAll(`${selector} input, ${selector} select`).forEach(input => { input.disabled = !on; });
      };
      toggle('.att-portion-only', isDailyPaid(kind) && !prorate);
      toggle('.att-prorate-only', prorate);
    };
    payType.onchange = sync;
    const mode = dialog.querySelector('[name=dailyMode]');
    if (mode) mode.onchange = sync;
    sync();
    return sync;
  }
  function shiftForm(record = null) {
    const eligible = people().filter(e => (inFloor(e) && !e.deletedAt) || e.id === record?.employeeId);
    if (!eligible.length) return employeeForm();
    const employee = eligible.find(e => e.id === (record?.employeeId || employeeId)) || eligible[0];
    const defaultIn = new Date(`${selectedDate}T09:00:00+09:00`).getTime();
    const s = record || { employeeId: employee.id, checkInAt: Math.min(defaultIn, data.serverNow), checkOutAt: null, breakMinutes: employee.breakMinutes, payType: employee.payType, hourlyRate: employee.hourlyRate, dailyPay: employee.dailyPay || '', halfDayPay: employee.halfDayPay || '', halfDayBeforeMinutes: employee.halfDayBeforeMinutes || '', dayPortion: 'auto', dailyBaseMinutes: employee.dailyBaseMinutes || '', scheduledStartMinutes: employee.scheduledStartMinutes || '', overtimeUnitMinutes: employee.overtimeUnitMinutes || '', overtimePay: employee.overtimePay || '', overtimeHourlyRate: employee.overtimeHourlyRate || '', withholding: Boolean(employee.withholding), workerName: '', workerNote: '', note: '' };
    const dialog = U.dialog(record ? '출퇴근 기록 수정' : '근무 기록 추가', `<label class="att-field">직원<select class="att-input" name="employeeId" ${record ? 'disabled' : ''}>${eligible.map(e => `<option value="${U.esc(e.id)}" ${e.id === s.employeeId ? 'selected' : ''}>${U.esc(e.name)}</option>`).join('')}</select></label><div class="att-form-grid"><label class="att-field">출근 (한국 시간)<input class="att-input" name="checkInAt" type="datetime-local" value="${U.dateTime(s.checkInAt)}" required></label><label class="att-field">퇴근 (한국 시간)<input class="att-input" name="checkOutAt" type="datetime-local" value="${U.dateTime(s.checkOutAt)}"><small>비워두면 근무 중으로 저장됩니다.</small></label></div><div class="att-form-grid"><label class="att-field">급여 유형<select class="att-input" name="payType"><option value="hourly" ${s.payType === 'hourly' ? 'selected' : ''}>시급</option><option value="salaried" ${s.payType === 'salaried' ? 'selected' : ''}>월급 · 근태만</option><option value="perDiem" ${s.payType === 'perDiem' ? 'selected' : ''}>일당 직원</option><option value="daily" ${s.payType === 'daily' ? 'selected' : ''}>일일근무자</option></select></label><label class="att-field">이 근무의 시급 (원)<input class="att-input" name="hourlyRate" type="number" min="1" max="1000000" step="1" value="${s.hourlyRate}" required></label><label class="att-field">이 근무의 풀타임 일당 (원)<input class="att-input" name="dailyPay" type="number" min="1" max="10000000" step="1" value="${s.dailyPay || ''}"><small>이 사람에게 줄 금액입니다. 설정된 기본 일당과 다르게 줄 수 있습니다.</small></label></div><div class="att-form-grid att-daily-only">${modeField(s)}<label class="att-field">지급 구분<select class="att-input" name="dayPortion"><option value="auto" ${(s.dayPortion || 'auto') === 'auto' ? 'selected' : ''}>자동 (근무시간으로)</option><option value="full" ${s.dayPortion === 'full' ? 'selected' : ''}>풀타임으로 지급</option><option value="half" ${s.dayPortion === 'half' ? 'selected' : ''}>반타임으로 지급</option></select><small>비우지 않으면 자동 판정보다 우선합니다.</small></label></div><div class="att-form-grid att-portion-only"><label class="att-field">이 근무의 반타임 일당 (원)<input class="att-input" name="halfDayPay" type="number" min="0" max="10000000" step="1" value="${s.halfDayPay || ''}" placeholder="0"></label><label class="att-field">반타임 기준 시각<input class="att-input" name="halfDayBefore" type="time" step="60" value="${minutesToClock(s.halfDayBeforeMinutes || DEFAULT_HALF_DAY_BEFORE_MINUTES)}"><small>이 시각 전에 퇴근하거나 이후에 출근하면 반타임.</small></label></div><div class="att-form-grid att-worker-only"><label class="att-field">기준 근무시간<input class="att-input" name="dailyBaseHours" type="number" min="0.5" max="24" step="0.5" value="${s.dailyBaseMinutes ? minutesToHours(s.dailyBaseMinutes) : ''}" placeholder="${minutesToHours(DEFAULT_DAILY_BASE_MINUTES)}"></label><label class="att-field">추가 급여 단위 (분)<input class="att-input" name="overtimeUnitMinutes" type="number" min="1" max="1440" step="1" value="${s.overtimeUnitMinutes || ''}" placeholder="${DEFAULT_OVERTIME_UNIT_MINUTES}"></label><label class="att-field">이 근무의 초과 시급 (원)<input class="att-input" name="overtimeHourlyRate" type="number" min="0" max="1000000" step="1" value="${s.overtimeHourlyRate || ''}" placeholder="예: 12000"><small>기준을 넘긴 시간은 이 시급으로 계산.</small></label><label class="att-field">단위당 추가 급여 (원, 선택)<input class="att-input" name="overtimePay" type="number" min="0" max="10000000" step="1" value="${s.overtimePay || ''}" placeholder="보통 비움"><small>첫 회만 다르게 줄 때. 둘 다 0이면 추가 급여 없음.</small></label></div><label class="att-check att-worker-only"><input type="checkbox" name="withholding" ${s.withholding ? 'checked' : ''}>이 사람은 3.3% 원천징수하고 지급</label><div class="att-form-grid att-worker-only"><label class="att-field">일한 사람<input class="att-input" name="workerName" maxlength="40" value="${U.esc(s.workerName || '')}" placeholder="예: 김일손"><small>나중에 적어도 됩니다.</small></label><label class="att-field">지급 메모<input class="att-input" name="workerNote" maxlength="200" value="${U.esc(s.workerNote || '')}" placeholder="예: 국민 123-456 / 현금 지급"></label></div><div class="att-form-grid"><label class="att-field">이 근무의 예정 출근 시각<input class="att-input" name="scheduledStart" type="time" step="60" value="${s.scheduledStartMinutes ? minutesToClock(s.scheduledStartMinutes) : ''}"><small>이보다 일찍 찍은 시간은 급여에서 빠집니다. 비우면 찍힌 시각 그대로.</small></label><label class="att-field">이 근무의 무급 휴게시간 (분)<input class="att-input" name="breakMinutes" type="number" min="0" max="720" step="1" value="${s.breakMinutes}" required></label></div><label class="att-field">수정 사유 / 메모<textarea class="att-input" name="note" maxlength="500" placeholder="예: 퇴근 버튼을 빠뜨려 실제 시간으로 수정">${U.esc(s.note)}</textarea></label>${record ? '<button class="att-link-button" type="button" data-delete-record>이 근무 기록 삭제</button>' : ''}`, async form => {
      // Retain original seconds when only the wage, break or note was changed.
      const parse = (name, original) => form.get(name) === U.dateTime(original) ? original : form.get(name) ? new Date(`${form.get(name)}:00+09:00`).getTime() : null;
      await api('shift.save', { id: record?.id, version: record?.version, employeeId: record?.employeeId || form.get('employeeId'), checkInAt: parse('checkInAt', s.checkInAt), checkOutAt: parse('checkOutAt', s.checkOutAt), payType: form.get('payType'), hourlyRate: Number(form.get('hourlyRate')), dailyPay: Number(form.get('dailyPay')), halfDayPay: form.has('halfDayPay') ? Number(form.get('halfDayPay')) || 0 : undefined, halfDayBeforeMinutes: clockToMinutes(form.get('halfDayBefore')), dailyMode: form.get('dailyMode') || undefined, earlyGraceMinutes: form.get('earlyGraceMinutes') ? Number(form.get('earlyGraceMinutes')) : undefined, dayPortion: form.get('dayPortion') || undefined, dailyBaseMinutes: form.get('dailyBaseHours') ? Math.round(Number(form.get('dailyBaseHours')) * 60) : undefined, overtimeUnitMinutes: form.get('overtimeUnitMinutes') ? Number(form.get('overtimeUnitMinutes')) : undefined, overtimePay: form.has('overtimePay') ? Number(form.get('overtimePay')) || 0 : undefined, scheduledStartMinutes: form.has('scheduledStart') ? (clockToMinutes(form.get('scheduledStart')) ?? 0) : undefined, overtimeHourlyRate: form.has('overtimeHourlyRate') ? Number(form.get('overtimeHourlyRate')) || 0 : undefined, withholding: isDailyPaid(form.get('payType')) ? form.has('withholding') : undefined, workerName: form.get('workerName'), workerNote: form.get('workerNote'), breakMinutes: Number(form.get('breakMinutes')), note: form.get('note') });
      await load();
    });
    const sync = bindPayType(dialog);
    dialog.querySelector('[name=employeeId]').onchange = event => {
      const e = person(event.target.value);
      dialog.querySelector('[name=payType]').value = e.payType;
      dialog.querySelector('[name=hourlyRate]').value = e.hourlyRate;
      dialog.querySelector('[name=breakMinutes]').value = e.breakMinutes;
      sync();
    };
    if (record) dialog.querySelector('[data-delete-record]').onclick = () => {
      U.dialog('근무 기록 삭제', `<p>${U.esc(person(record.employeeId)?.name || record.employeeName)} 님의 ${record.workDate} ${U.time(record.checkInAt)} 출근 기록을 삭제할까요?</p><p class="att-note">이 기록은 근태와 급여 합계에서 제외됩니다. 변경 이력은 보존됩니다.</p>`, async () => {
        await api('shift.delete', { id: record.id, version: record.version }); dialog.close(); await load();
      }, { submitLabel: '기록 삭제' });
    };
  }
  // 명절·특수일 배율. 날짜 하나에 하나만 둔다.
  function specialDayForm(day = null, date = selectedDate) {
    const d = day || { workDate: date, label: '', multiplierPercent: 150, appliesTo: 'both', note: '' };
    U.dialog(day ? '특수일 수정' : '특수일 추가', `<div class="att-form-grid"><label class="att-field">날짜<input class="att-input" name="workDate" type="date" value="${U.esc(d.workDate)}" ${day ? 'readonly' : ''} required></label><label class="att-field">이름<input class="att-input" name="label" maxlength="40" value="${U.esc(d.label)}" placeholder="예: 설날" required></label></div><div class="att-form-grid"><label class="att-field">배율<input class="att-input" name="multiplier" type="number" min="0.5" max="5" step="0.1" value="${Number(d.multiplierPercent) / 100}" required><small>1.5 를 넣으면 1.5배입니다.</small></label><label class="att-field">적용 대상<select class="att-input" name="appliesTo"><option value="both" ${d.appliesTo === 'both' ? 'selected' : ''}>시급·월급 모두</option><option value="hourly" ${d.appliesTo === 'hourly' ? 'selected' : ''}>시급 직원만</option><option value="salaried" ${d.appliesTo === 'salaried' ? 'selected' : ''}>월급 직원만</option></select></label></div><label class="att-field">메모<input class="att-input" name="note" maxlength="500" value="${U.esc(d.note || '')}" placeholder="예: 추석 당일"></label><p class="att-note">시급 직원은 그날 급여가 배율만큼 지급됩니다. 월급 직원은 <b>근무시간 × 통상시급 × 배율</b>이 월급에 더해집니다. 가산분만 주시려면 0.5 를 넣으세요.<br>날짜당 하나만 둘 수 있고, 같은 날을 다시 저장하면 덮어씁니다. 출근 기록이 있는 날에 뒤늦게 등록해도 바로 반영됩니다.</p>`, async form => {
      await api('specialDay.save', { workDate: form.get('workDate'), label: form.get('label'),
        multiplierPercent: Math.round(Number(form.get('multiplier')) * 100), appliesTo: form.get('appliesTo'),
        note: form.get('note'), version: day?.version });
      await load();
    });
  }

  function specialDaysDialog() {
    const days = [...(data.specialDays || [])].sort((a, b) => a.workDate.localeCompare(b.workDate));
    const el = U.dialog(`${month.replace('-', '년 ')}월 명절·특수일`, `<p class="att-note">이 달에 지정된 날만 보입니다. 다른 달은 위에서 조회 월을 바꾸세요.</p><div>${days.length ? days.map(d => `<div class="att-shift-item att-row"><div><strong>${U.esc(d.workDate)} · ${U.esc(d.label)}</strong> <span class="att-pill">${multiplierText(d.multiplierPercent)}</span><div class="att-meta">${scopeText(d.appliesTo)}${d.note ? ` · ${U.esc(d.note)}` : ''}</div></div><div class="att-filters"><button class="att-button" type="button" data-edit-special="${U.esc(d.workDate)}">수정</button><button class="att-button att-danger" type="button" data-remove-special="${U.esc(d.workDate)}">삭제</button></div></div>`).join('') : '<div class="att-empty">이 달에 지정된 특수일이 없습니다.</div>'}</div><div class="att-filters"><button class="att-button att-primary" type="button" data-add-special>＋ 특수일 추가</button></div>`, async () => {}, { submitLabel: '닫기' });
    el.querySelector('[data-add-special]').onclick = () => { el.close(); specialDayForm(null, selectedDate); };
    el.querySelectorAll('[data-edit-special]').forEach(button => { button.onclick = () => {
      el.close(); specialDayForm(days.find(d => d.workDate === button.dataset.editSpecial));
    }; });
    el.querySelectorAll('[data-remove-special]').forEach(button => { button.onclick = () => {
      const day = days.find(d => d.workDate === button.dataset.removeSpecial);
      U.dialog('특수일 삭제', `<p>${U.esc(day.workDate)} ${U.esc(day.label)} 배율을 지울까요?</p><p class="att-note">그날 근무의 가산분이 사라지고 기본 금액으로 다시 계산됩니다.</p>`, async () => {
        await api('specialDay.delete', { workDate: day.workDate }); el.close(); await load();
      }, { submitLabel: '삭제' });
    }; });
  }

  // 결근은 관리자가 직접 표시한 날만 잡는다.
  function absenceForm(date) {
    const marked = new Set(absencesOn(date).map(a => a.employeeId));
    const eligible = people().filter(inFloor).filter(e => !e.deletedAt && !marked.has(e.id));
    if (!eligible.length) {
      U.dialog('결근 표시', '<p>이 날 결근으로 표시할 수 있는 직원이 없습니다.</p><p class="att-note">이미 모두 표시했거나 이 매장에 직원이 없습니다.</p>', async () => {}, { submitLabel: '닫기' });
      return;
    }
    U.dialog('결근 표시', `<label class="att-field">날짜<input class="att-input" name="workDate" type="date" value="${U.esc(date)}" required></label><label class="att-field">직원<select class="att-input" name="employeeId">${eligible.map(e => `<option value="${U.esc(e.id)}">${U.esc(e.name)} · ${e.payType === 'salaried' ? `월급 (하루 ${U.money(dailyDeduction(e))} 공제)` : '시급 (공제 없음)'}</option>`).join('')}</select></label><label class="att-field">사유<input class="att-input" name="note" maxlength="500" placeholder="예: 무단결근"></label><p class="att-note">월급 직원만 <b>월급 ÷ 월 소정근로일수</b>만큼 급여에서 빠집니다. 시급 직원은 안 나온 날의 급여가 원래 없으므로 기록으로만 남습니다.<br>휴무나 연차는 표시하지 마세요. 표시한 날만 공제됩니다.</p>`, async form => {
      await api('absence.save', { employeeId: form.get('employeeId'), workDate: form.get('workDate'), note: form.get('note') });
      await load();
    });
  }

  const DEVICE_STORAGE_KEY = 'gjsuragan-attendance-device';
  async function deviceIdInThisBrowser() {
    try {
      const token = localStorage.getItem(DEVICE_STORAGE_KEY) || '';
      if (!/^[a-f0-9]{64}$/.test(token) || !window.crypto?.subtle) return '';
      const digest = await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
      return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
    } catch (_) {
      // 저장소를 막아둔 브라우저거나 http 로 열어 crypto.subtle 이 없는 경우다.
      // 못 읽으면 안내만 못 할 뿐, 목록과 매장 변경은 그대로 쓸 수 있다.
      return '';
    }
  }

  // 이 브라우저 자체가 태블릿으로 연결돼 있으면 어느 기기인지 알려준다.
  // 모르면 '궁중수라간 태블릿' 을 눌러도 돌담명가가 열려서 고장으로 보인다.
  async function markConnectedDeviceHere(el, tablets) {
    const box = el.querySelector('#att-device-here');
    if (!box) return;
    const id = await deviceIdInThisBrowser();
    const mine = id ? tablets.find(d => d.id === id) : null;
    if (!mine) return;
    box.innerHTML = `<div class="att-notice">지금 보고 계신 이 기기는 <b>${U.esc(U.deviceName(mine.name, mine.floor))}</b> 로 연결돼 있습니다. 그래서 아래 두 버튼 중 어느 쪽을 눌러도 <b>${U.storeName(mine.floor)}</b> 화면이 열립니다.<br>이 기기를 다른 매장으로 쓰시려면 아래 목록의 <b>매장 변경</b>을, 다른 매장 태블릿을 새로 두시려면 <b>그 기기에서</b> 아래 버튼을 눌러 주세요.</div>`;
  }

  function devicesDialog() {
    const tablets = data.devices.filter(d => d.enabled);
    const el = U.dialog('연결된 출퇴근 태블릿', `<p class="att-note">태블릿마다 근무 매장을 지정하세요. 지정한 매장의 직원만 표시됩니다. 분실하거나 사용하지 않는 기기는 연결을 해제할 수 있습니다.</p>
      <div id="att-device-here"></div>
      <p class="att-note"><b>아래 두 버튼은 아직 연결하지 않은 새 기기에서 눌러야 뜻이 있습니다.</b> 연결된 기기는 어느 쪽을 눌러도 연결할 때 지정한 매장이 열립니다.</p>
      <div class="att-filters"><a class="att-button" href="./attendance.html?store=suragan" target="_blank" rel="noopener">새 기기를 궁중수라간으로 연결 ↗</a><a class="att-button" href="./attendance.html?store=doldam" target="_blank" rel="noopener">새 기기를 돌담명가로 연결 ↗</a></div>
      <div>${tablets.length ? tablets.map(d => `<div class="att-shift-item att-row"><div><strong>${U.esc(U.deviceName(d.name, d.floor))}</strong> <span class="att-pill">${U.storeName(d.floor)}</span><div class="att-meta">${U.date(d.createdAt)} 연결</div></div><div class="att-filters"><button class="att-button" type="button" data-device-floor="${U.esc(d.id)}">매장 변경</button><button class="att-button att-danger" type="button" data-revoke="${U.esc(d.id)}">연결 해제</button></div></div>`).join('') : '<div class="att-empty">연결된 태블릿이 없습니다.</div>'}</div>`, async () => {}, { submitLabel: '닫기' });
    markConnectedDeviceHere(el, tablets);
    el.querySelectorAll('[data-device-floor]').forEach(button => { button.onclick = () => {
      const device = tablets.find(d => d.id === button.dataset.deviceFloor);
      U.dialog('태블릿 근무 매장 변경', `<p>${U.esc(U.deviceName(device.name, device.floor))}</p><label class="att-field">표시할 직원의 매장<select class="att-input" name="floor"><option value="2" ${device.floor === 2 ? 'selected' : ''}>궁중수라간 직원만 표시</option><option value="1" ${(device.floor ?? 1) === 1 ? 'selected' : ''}>돌담명가 직원만 표시</option></select></label>`, async form => {
        await api('device.floor', { id: device.id, version: device.version || 1, floor: Number(form.get('floor')) }); el.close(); await load();
      });
    }; });
    el.querySelectorAll('[data-revoke]').forEach(button => { button.onclick = () => {
      const device = tablets.find(d => d.id === button.dataset.revoke);
      U.dialog('태블릿 연결 해제', `<p>${U.esc(U.deviceName(device.name, device.floor))}의 출퇴근 기록 권한을 해제할까요?</p>`, async () => {
        await api('device.revoke', { id: device.id }); el.close(); await load();
      }, { submitLabel: '연결 해제' });
    }; });
  }
  function exportPayroll() {
    if (loading) return;
    const rows = payrollRows(records());
    const daily = dailyPayrollRows(records());
    const scope = floor === 'all' ? '전체 매장' : U.storeName(floor);
    const values = [['조회월', '조회매장', '직원명', '급여유형', '약정 월급(원)', '출근일수', '완료근무건수', '유급근무(분)', '무급휴게(분)', '미퇴근건수', '기본급(원)', '특수일 가산·추가 급여(원)', '특수일 근무일수', '결근일수', '결근 공제(원)', '원천징수 3.3%(원)', '실지급액(원, 4대보험 제외)'], ...rows.map(r => {
      const gross = grossAmount(r), payout = transferAmount(r);
      const tax = r.withholding && gross !== null ? withholdingTax(gross) : 0;
      return [month, scope, r.name, r.type, r.salaryType === 'salaried' ? r.monthlySalary ?? '미설정' : '', r.days, r.count, r.minutes, r.breaks, r.open, r.baseAmount, r.extraAmount, r.specialDays, r.absenceDays, r.deduction, tax, payout === null ? '확인 필요' : payout];
    }), ...daily.map(r => [month, scope, `${r.name} (${r.slotName} ${formatDayLabel(r.workDate)})`, r.type, '', 1, 1, r.minutes, r.breaks, 0, r.dailyPay, r.overtimeAmount, 0, 0, 0, r.withholding ? withholdingTax(r.amount) : 0, transferAmount(r)])];
    const cell = value => `"${String(value).replace(/^[\s]*[=+@-]/, match => `'${match}`).replace(/"/g, '""')}"`;
    const blob = new Blob(['\uFEFF', values.map(row => row.map(cell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `궁중수라간_급여정산_${month}_${scope}.csv`;
    a.hidden = true; document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  function click(event) {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.dataset.floor) { floor = button.dataset.floor; employeeId = ''; render(); return; }
    if (button.dataset.view) { view = button.dataset.view; render(); return; }
    if (button.dataset.date) { selectedDate = button.dataset.date; render(); return; }
    const action = button.dataset.action;
    if (action === 'refresh') return load();
    if (action === 'new-employee') return employeeForm();
    if (action === 'prev-month' || action === 'next-month') {
      const [year, m] = month.split('-').map(Number);
      return changeMonth(new Date(Date.UTC(year, m - 1 + (action === 'prev-month' ? -1 : 1), 1)).toISOString().slice(0, 7));
    }
    if (!data) return;
    const id = button.dataset.id;
    if (action === 'edit-employee') employeeForm(person(id));
    if (action === 'copy-bank') copyBank(id, button);
    if (action === 'copy-amount') {
      const all = [...payrollRows(records()), ...dailyPayrollRows(records())];
      const row = all.find(r => r.id === id), amount = row && transferAmount(row);
      if (amount !== null && amount !== undefined) copyText(String(amount), '입금 기준액을');
    }
    if (action === 'delete-employee') {
      const e = person(id);
      U.dialog('직원 삭제', `<p>${U.esc(e.name)} 님을 직원 목록에서 삭제할까요?</p><p class="att-note"><b>계좌번호와 주민등록번호가 함께 지워집니다.</b> 급여를 아직 보내지 않았다면 삭제하지 마세요. 급여 정산 화면에서 계좌를 복사할 수 없게 됩니다.<br>잠깐 안 나오는 것뿐이라면 <b>직원 수정에서 ‘재직 중’ 체크만 해제</b>하세요. 태블릿에서 이름이 사라지고 계좌는 그대로 남습니다.<br>지난 근태와 정산 기록은 삭제해도 보존됩니다.</p>`, async () => {
        await api('employee.delete', { id, version: e.version }); await load();
      }, { submitLabel: '직원 삭제' });
    }
    if (action === 'new-shift') shiftForm();
    if (action === 'edit-shift') shiftForm([...data.shifts, ...data.openShifts].find(s => s.id === id));
    if (action === 'employee-calendar') { employeeId = id; $('att-employee-filter').value = id; view = 'calendar'; render(); }
    if (action === 'special-days') specialDaysDialog();
    if (action === 'add-special') specialDayForm(null, selectedDate);
    if (action === 'mark-absence') absenceForm(selectedDate);
    if (action === 'delete-absence') {
      const off = (data.absences || []).find(a => a.id === id);
      if (off) U.dialog('결근 취소', `<p>${U.esc(person(off.employeeId)?.name || off.employeeName)} 님의 ${U.esc(off.workDate)} 결근 표시를 지울까요?</p><p class="att-note">그만큼 공제가 사라집니다.</p>`, async () => {
        await api('absence.delete', { id: off.id }); await load();
      }, { submitLabel: '결근 취소' });
    }
    if (action === 'devices') devicesDialog();
    if (action === 'export') exportPayroll();
  }
  window.AttendanceAdmin = { init, dispose };
})();
