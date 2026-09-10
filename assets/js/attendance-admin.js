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
  const bankLabel = employee => employee?.privateSummary?.bankLast4
    ? `${employee.privateSummary.bankName} · •••• ${employee.privateSummary.bankLast4}` : '계좌 미등록';
  function transferAmount(row) {
    if (row.type !== (row.salaryType === 'salaried' ? '월급' : '시급')) return null;
    return row.salaryType === 'salaried' ? Number.isSafeInteger(row.monthlySalary) && row.monthlySalary > 0 ? row.monthlySalary : null : row.amount;
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
    if (!auth.currentUser || !ADMIN_EMAILS.includes(auth.currentUser.email)) throw new Error('관리자 로그인이 필요합니다.');
    return U.request(action, input, { token: await auth.currentUser.getIdToken() });
  }
  function init() {
    if (initialized) return;
    initialized = true;
    $('attendance-root').innerHTML = `<div class="att-topline"><div><p class="att-eyebrow">SURAGAN TEAM</p><h2>직원 · 근태 관리</h2><p class="att-subtitle">함께 일하는 직원들의 출퇴근과 급여를 한눈에 확인하세요.</p></div><div class="att-filters" style="width:auto"><button class="att-button" data-action="devices">태블릿 관리</button><a class="att-button" href="./attendance.html" target="_blank" rel="noopener">태블릿 화면 ↗</a><button class="att-button att-primary" data-action="new-employee">＋ 직원 등록</button></div></div><div class="att-stats" id="att-stats"></div><div class="att-toolbar"><div class="att-tabs" role="group" aria-label="관리 화면"><button class="att-tab active" data-view="calendar">근태 캘린더</button><button class="att-tab" data-view="employees">직원 관리</button><button class="att-tab" data-view="payroll">급여 정산</button></div><div class="att-filters"><button class="att-button" data-action="prev-month" aria-label="이전 달">‹</button><input class="att-input" type="month" id="att-month" aria-label="조회 월" min="2020-01" max="2099-12" value="${month}"><button class="att-button" data-action="next-month" aria-label="다음 달">›</button><select class="att-input" id="att-employee-filter" aria-label="직원 필터"><option value="">전체 직원</option></select><button class="att-button" data-action="refresh" aria-label="새로고침">↻</button></div></div><p class="att-error" id="att-load-error" role="alert"></p><div id="att-open-notice"></div><div id="att-content"><div class="att-empty">근태 정보를 불러오는 중…</div></div><p class="att-status" id="att-status" role="status"></p>`;
    $('att-stats').insertAdjacentHTML('beforebegin', '<div class="att-toolbar att-floor-toolbar"><div class="att-tabs" role="group" aria-label="근무 층"><button class="att-tab active" data-floor="all" aria-pressed="true">전체 층</button><button class="att-tab" data-floor="1" aria-pressed="false">1층</button><button class="att-tab" data-floor="2" aria-pressed="false">2층</button></div><span class="att-meta">태블릿은 지정한 층의 직원만 표시합니다.</span></div>');
    $('attendance-root').addEventListener('click', click);
    $('att-month').onchange = () => changeMonth($('att-month').value);
    $('att-employee-filter').onchange = () => { employeeId = $('att-employee-filter').value; render(); };
    load();
    timer = setInterval(() => { if (!document.hidden && !document.querySelector('dialog[open]') && activeAdminTab === 'attendance') load(true); }, 60000);
  }
  function dispose() {
    requestVersion++; clearInterval(timer); clearTimeout(feedback.timer);
    data = null; loading = false; initialized = false;
    const root = $('attendance-root');
    if (root) { root.removeEventListener('click', click); root.innerHTML = ''; }
    document.querySelectorAll('dialog.att-dialog').forEach(el => el.close());
  }
  async function load(quiet = false) {
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
    $('att-employee-filter').innerHTML = '<option value="">전체 직원</option>' + eligible.map(e => `<option value="${U.esc(e.id)}">${U.esc(e.name)} · ${e.floor ?? 1}층${e.deletedAt ? ' (삭제)' : !e.active ? ' (퇴사)' : ''}</option>`).join('');
    $('att-employee-filter').value = employeeId;
    const list = records();
    const opens = data.openShifts.filter(inFloor).filter(s => !employeeId || s.employeeId === employeeId);
    const active = data.employees.filter(inFloor).filter(e => e.active && !e.deletedAt && (!employeeId || e.id === employeeId));
    $('att-stats').innerHTML = [
      ['재직 직원', `${active.length}명`, '출퇴근 화면에 표시되는 직원'],
      ['현재 근무 중', `${opens.length}명`, '퇴근하지 않은 전체 근무'],
      ['이번 조회 월 유급 근무', U.duration(list.reduce((sum, s) => sum + s.payableMinutes, 0)), '퇴근 완료 · 무급 휴게 제외'],
      ['시급 직원 기본급 합계', U.money(list.reduce((sum, s) => sum + s.amount, 0)), `${month.replace('-', '년 ')}월 · 퇴근 완료 기준`]
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
      cells.push(`<button class="att-day ${selectedDate === date ? 'selected' : ''} ${today === date ? 'today' : ''}" data-date="${date}" aria-label="${m}월 ${day}일, 근무 ${daily.length}건" aria-pressed="${selectedDate === date}"><span class="att-day-number">${day}</span>${chips}${daily.length > 2 ? `<span class="att-day-more">+${daily.length - 2}건 더 보기</span>` : ''}</button>`);
    }
    while (cells.length % 7) cells.push('<div class="att-day empty" aria-hidden="true"></div>');
    const daily = list.filter(s => s.workDate === selectedDate).sort((a, b) => a.checkInAt - b.checkInAt);
    $('att-content').innerHTML = `<div class="att-layout"><section class="att-panel"><div class="att-panel-head att-row"><h3>${year}년 ${m}월</h3><div class="att-meta">날짜를 누르면 출퇴근 상세가 보여요</div></div><div class="att-calendar">${['일','월','화','수','목','금','토'].map(d => `<div class="att-weekday">${d}</div>`).join('')}${cells.join('')}</div></section><section class="att-panel"><div class="att-panel-head att-row"><h3>${Number(selectedDate.slice(5, 7))}월 ${Number(selectedDate.slice(8))}일</h3><button class="att-link-button" data-action="new-shift">＋ 기록 추가</button></div><div class="att-day-summary">${daily.length ? daily.map(s => `<article class="att-shift-item"><div class="att-row"><strong>${U.esc(person(s.employeeId)?.name || s.employeeName)}</strong><span class="att-pill ${s.checkOutAt === null ? 'amber' : 'green'}">${s.checkOutAt === null ? '근무 중' : '퇴근 완료'}</span></div><div class="att-shift-times">${U.time(s.checkInAt)} → ${s.checkOutAt !== null && U.date(s.checkOutAt) !== s.workDate ? '<small>익일 </small>' : ''}${U.time(s.checkOutAt)}</div><div class="att-meta">${s.checkOutAt === null ? '퇴근 후 근무시간과 금액이 계산됩니다.' : `${U.duration(s.payableMinutes)} · 휴게 ${s.breakMinutes}분`}</div><div class="att-row"><span class="att-meta">${s.payType === 'hourly' ? `${U.money(s.hourlyRate)}/시간 · ${U.money(s.amount)}` : '월급 직원 · 근태 기록'}</span><button class="att-link-button" data-action="edit-shift" data-id="${U.esc(s.id)}">수정</button></div>${s.note ? `<div class="att-meta">${U.esc(s.note)}</div>` : ''}</article>`).join('') : '<div class="att-empty">이 날짜의 근무 기록이 없습니다.</div>'}</div></section></div><p class="att-note">날짜를 넘어 퇴근한 근무도 출근일에 표시됩니다. 빠뜨린 기록은 ‘기록 추가’, 잘못 찍은 시간과 휴게시간은 ‘수정’에서 보정하세요.</p>`;
  }
  function renderEmployees() {
    const list = people().filter(inFloor).filter(e => !e.deletedAt && (!employeeId || e.id === employeeId));
    $('att-content').innerHTML = `<div class="att-section-heading"><div><h3>직원 목록 <span class="att-meta">${list.length}명</span></h3><p class="att-subtitle">직원 정보와 급여 계좌를 관리하세요.</p></div></div><div class="att-employee-cards">${list.length ? list.map(e => `<article class="att-employee-card">
      <div class="att-row"><div class="att-staff-identity"><span class="att-staff-avatar" aria-hidden="true">${U.esc(e.name.slice(0, 1))}</span><div><h4>${U.esc(e.name)}</h4><p class="att-meta">${e.floor ?? 1}층 · ${U.esc(e.role || '업무 미지정')}</p></div></div><span class="att-pill ${e.currentShiftId ? 'green' : ''}">${e.currentShiftId ? '근무 중' : e.active ? '재직' : '퇴사·휴직'}</span></div>
      <div class="att-staff-pay"><span>${e.payType === 'hourly' ? '약정 시급' : '약정 월급'}</span><strong>${e.payType === 'hourly' ? U.money(e.hourlyRate) : monthlySalaryText(e)}</strong></div>
      <div class="att-account-line"><div><span class="att-meta">급여 계좌</span><p>${U.esc(bankLabel(e))}</p></div><button class="att-copy-button" data-action="copy-bank" data-id="${U.esc(e.id)}" ${e.privateSummary?.bankLast4 ? '' : 'disabled'} aria-label="${U.esc(e.name)} 계좌번호 복사">계좌 복사</button></div>
      <div class="att-card-foot"><span class="att-meta">주민등록번호 ${e.privateSummary?.residentRegistered ? '등록됨' : '미등록'} · 휴게 ${e.breakMinutes}분</span><div><button class="att-link-button" data-action="edit-employee" data-id="${U.esc(e.id)}">수정</button><button class="att-link-button att-delete-link" data-action="delete-employee" data-id="${U.esc(e.id)}">삭제</button></div></div>
    </article>`).join('') : '<div class="att-empty"><strong>함께 일할 직원을 등록해 주세요</strong>위의 직원 등록 버튼에서 시작할 수 있어요.</div>'}</div><p class="att-note">시급과 휴게시간 변경은 다음 출근부터 적용됩니다. 기존 근무는 당시 금액을 유지합니다. 주민등록번호는 직원 수정 화면에서 확인할 수 있습니다.</p>`;
  }
  function payrollRows(list) {
    const ids = new Set([...data.employees.filter(inFloor).filter(e => !e.deletedAt && (!employeeId || e.id === employeeId)).map(e => e.id), ...list.map(s => s.employeeId)]);
    return [...ids].map(id => {
      const employee = person(id), own = list.filter(s => s.employeeId === id), completed = own.filter(s => s.checkOutAt !== null);
      return { id, name: employee?.name || own[0]?.employeeName || '삭제된 직원', deleted: Boolean(employee?.deletedAt),
        type: own.length ? [...new Set(own.map(s => s.payType))].map(t => t === 'hourly' ? '시급' : '월급').join(' / ') : employee?.payType === 'hourly' ? '시급' : '월급',
        salaryType: employee?.payType, monthlySalary: employee?.monthlySalary ?? null,
        days: new Set(completed.map(s => s.workDate)).size, count: completed.length,
        minutes: completed.reduce((sum, s) => sum + s.payableMinutes, 0), breaks: completed.reduce((sum, s) => sum + s.breakMinutes, 0),
        amount: completed.reduce((sum, s) => sum + s.amount, 0), open: own.length - completed.length };
    }).sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  }
  function renderPayroll(list) {
    const rows = payrollRows(list), amount = rows.reduce((sum, row) => sum + row.amount, 0);
    $('att-content').innerHTML = `<section class="att-payroll"><div class="att-section-heading"><div><h3>${Number(month.slice(5))}월 급여 정산</h3><p class="att-subtitle">계좌와 입금 기준액을 복사해서 이체할 때 사용하세요.</p></div><button class="att-button" data-action="export">CSV 내려받기 ↓</button></div><div class="att-payroll-cards">${rows.length ? rows.map(row => {
      const employee = person(row.id), payout = transferAmount(row);
      return `<article class="att-payroll-card"><div class="att-payroll-person"><div class="att-row"><button class="att-staff-name" data-action="employee-calendar" data-id="${U.esc(row.id)}">${U.esc(row.name)}${row.deleted ? ' (삭제)' : ''}</button><span class="att-pill">${row.type}</span></div><p class="att-meta">${floor === 'all' ? '전체 층' : floor + '층'} · ${month.replace('-', '년 ')}월</p><div class="att-payroll-metrics"><div><span>출근 / 근무</span><strong>${row.days}일 / ${row.count}건</strong></div><div><span>유급 근무</span><strong>${U.duration(row.minutes)}</strong></div><div><span>무급 휴게</span><strong>${row.breaks}분</strong></div><div><span>미퇴근</span><strong class="${row.open ? 'att-amber-text' : ''}">${row.open}건</strong></div></div></div>
        <div class="att-payroll-transfer"><div class="att-account-line"><div><span class="att-meta">${U.esc(employee?.privateSummary?.accountHolder || row.name)} · 급여 계좌</span><p>${U.esc(bankLabel(employee))}</p></div><button class="att-copy-button" data-action="copy-bank" data-id="${U.esc(row.id)}" ${employee?.privateSummary?.bankLast4 && !row.deleted ? '' : 'disabled'} aria-label="${U.esc(row.name)} 계좌번호 복사">계좌 복사</button></div>
        <div class="att-payout"><div><span class="att-meta">${row.salaryType === 'salaried' ? '현재 약정 월급' : '시급 근무 기본급'}</span><strong>${payout === null ? (row.type.includes('/') || row.type !== (row.salaryType === 'salaried' ? '월급' : '시급') ? '급여 유형 확인 필요' : '월급 미설정') : U.money(payout)}</strong></div><button class="att-copy-button att-copy-primary" data-action="copy-amount" data-id="${U.esc(row.id)}" ${payout === null ? 'disabled' : ''} aria-label="${U.esc(row.name)} 입금 기준액 복사">금액 복사</button></div>${row.type.includes('/') ? `<p class="att-meta">시급 근무 기본급 ${U.money(row.amount)} · 월급과 별도로 확인해 주세요.</p>` : ''}</div></article>`;
    }).join('') : '<div class="att-empty">등록된 직원과 근무 기록이 없습니다.</div>'}</div><div class="att-payroll-total"><span>시급 직원 기본급 합계</span><strong>${U.money(amount)}</strong></div></section><p class="att-note">복사되는 금액은 원 단위 숫자입니다. 시급 직원은 조회 월·층의 퇴근 완료 기본급, 월급 직원은 현재 약정 월급을 사용합니다. 미퇴근, 주휴·연장·야간·휴일수당, 세금·공제는 포함하지 않습니다.<br>현재 약정 월급은 직원 정보의 최신 설정이며 조회 월의 확정 지급액은 아닙니다. 일할 계산은 하지 않으며, 급여 유형이 바뀐 달은 금액을 직접 확인해 주세요.</p>`;
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
    const e = employee || { name: '', role: '', floor: floor === 'all' ? 1 : Number(floor), payType: 'hourly', hourlyRate: '', monthlySalary: '', breakMinutes: 0, active: true, note: '' };
    const dialog = U.dialog(employee ? '직원 정보 수정' : '새 직원 등록', `<div class="att-form-grid"><label class="att-field">이름<input class="att-input" name="name" value="${U.esc(e.name)}" maxlength="40" required placeholder="예: 김수라"></label><label class="att-field">담당 업무<input class="att-input" name="role" value="${U.esc(e.role)}" maxlength="40" placeholder="예: 조리 / 포장 / 배송"></label></div><div class="att-form-grid"><label class="att-field">급여 유형<select class="att-input" name="payType"><option value="hourly" ${e.payType === 'hourly' ? 'selected' : ''}>시급 아르바이트</option><option value="salaried" ${e.payType === 'salaried' ? 'selected' : ''}>월급 직원</option></select></label><label class="att-field">시급 (원)<input class="att-input" name="hourlyRate" type="number" min="1" max="1000000" step="1" value="${e.hourlyRate || ''}" placeholder="약정 시급 입력" required></label><label class="att-field">월급 (원)<input class="att-input" name="monthlySalary" type="number" min="1" max="100000000" step="1" value="${e.monthlySalary || ''}" placeholder="예: 3000000"><small>한 달 약정 금액을 입력하세요.</small></label></div><label class="att-field">기본 무급 휴게시간 (분)<input class="att-input" name="breakMinutes" type="number" min="0" max="720" step="1" value="${e.breakMinutes}" required><small>매 근무에서 차감할 시간입니다. 자동 차감을 원하지 않으면 0분으로 두세요.</small></label><label class="att-field">관리자 메모<textarea class="att-input" name="note" maxlength="500" placeholder="태블릿에는 표시되지 않습니다">${U.esc(e.note)}</textarea></label><label class="att-check"><input type="checkbox" name="active" ${e.active ? 'checked' : ''}>재직 중 · 태블릿에 이름 표시</label>`, async form => {
      await api('employee.save', { id: employee?.id, version: employee?.version, name: form.get('name'), role: form.get('role'), floor: Number(form.get('floor')), payType: form.get('payType'), hourlyRate: Number(form.get('hourlyRate')), monthlySalary: form.has('monthlySalary') ? Number(form.get('monthlySalary')) : undefined, breakMinutes: Number(form.get('breakMinutes')), note: form.get('note'), active: form.has('active'), privateDetails: { residentNumber: form.get('residentNumber'), bankName: form.get('bankName'), bankAccount: form.get('bankAccount'), accountHolder: form.get('accountHolder') } });
      await load();
    });
    dialog.querySelector('.att-form-grid').insertAdjacentHTML('afterend', `<label class="att-field">근무 층<select class="att-input" name="floor"><option value="1" ${(e.floor ?? 1) === 1 ? 'selected' : ''}>1층</option><option value="2" ${e.floor === 2 ? 'selected' : ''}>2층</option></select><small>지정한 층의 태블릿에만 표시됩니다. 근무 중인 직원은 퇴근 후 층을 변경하세요.</small></label>`);
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
  function bindPayType(dialog) {
    const payType = dialog.querySelector('[name=payType]');
    const sync = () => {
      const hourly = dialog.querySelector('[name=hourlyRate]'), salary = dialog.querySelector('[name=monthlySalary]');
      const isHourly = payType.value === 'hourly';
      hourly.disabled = !isHourly; hourly.required = isHourly;
      if (salary) {
        hourly.closest('.att-field').hidden = !isHourly;
        salary.closest('.att-field').hidden = isHourly;
        salary.disabled = isHourly; salary.required = !isHourly;
      }
    };
    payType.onchange = sync; sync();
    return sync;
  }
  function shiftForm(record = null) {
    const eligible = people().filter(e => (inFloor(e) && !e.deletedAt) || e.id === record?.employeeId);
    if (!eligible.length) return employeeForm();
    const employee = eligible.find(e => e.id === (record?.employeeId || employeeId)) || eligible[0];
    const defaultIn = new Date(`${selectedDate}T09:00:00+09:00`).getTime();
    const s = record || { employeeId: employee.id, checkInAt: Math.min(defaultIn, data.serverNow), checkOutAt: null, breakMinutes: employee.breakMinutes, payType: employee.payType, hourlyRate: employee.hourlyRate, note: '' };
    const dialog = U.dialog(record ? '출퇴근 기록 수정' : '근무 기록 추가', `<label class="att-field">직원<select class="att-input" name="employeeId" ${record ? 'disabled' : ''}>${eligible.map(e => `<option value="${U.esc(e.id)}" ${e.id === s.employeeId ? 'selected' : ''}>${U.esc(e.name)}</option>`).join('')}</select></label><div class="att-form-grid"><label class="att-field">출근 (한국 시간)<input class="att-input" name="checkInAt" type="datetime-local" value="${U.dateTime(s.checkInAt)}" required></label><label class="att-field">퇴근 (한국 시간)<input class="att-input" name="checkOutAt" type="datetime-local" value="${U.dateTime(s.checkOutAt)}"><small>비워두면 근무 중으로 저장됩니다.</small></label></div><div class="att-form-grid"><label class="att-field">급여 유형<select class="att-input" name="payType"><option value="hourly" ${s.payType === 'hourly' ? 'selected' : ''}>시급</option><option value="salaried" ${s.payType === 'salaried' ? 'selected' : ''}>월급 · 근태만</option></select></label><label class="att-field">이 근무의 시급 (원)<input class="att-input" name="hourlyRate" type="number" min="1" max="1000000" step="1" value="${s.hourlyRate}" required></label></div><label class="att-field">이 근무의 무급 휴게시간 (분)<input class="att-input" name="breakMinutes" type="number" min="0" max="720" step="1" value="${s.breakMinutes}" required></label><label class="att-field">수정 사유 / 메모<textarea class="att-input" name="note" maxlength="500" placeholder="예: 퇴근 버튼을 빠뜨려 실제 시간으로 수정">${U.esc(s.note)}</textarea></label>${record ? '<button class="att-link-button" type="button" data-delete-record>이 근무 기록 삭제</button>' : ''}`, async form => {
      // Retain original seconds when only the wage, break or note was changed.
      const parse = (name, original) => form.get(name) === U.dateTime(original) ? original : form.get(name) ? new Date(`${form.get(name)}:00+09:00`).getTime() : null;
      await api('shift.save', { id: record?.id, version: record?.version, employeeId: record?.employeeId || form.get('employeeId'), checkInAt: parse('checkInAt', s.checkInAt), checkOutAt: parse('checkOutAt', s.checkOutAt), payType: form.get('payType'), hourlyRate: Number(form.get('hourlyRate')), breakMinutes: Number(form.get('breakMinutes')), note: form.get('note') });
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
  function devicesDialog() {
    const tablets = data.devices.filter(d => d.enabled);
    const el = U.dialog('연결된 출퇴근 태블릿', `<p class="att-note">태블릿마다 근무 층을 지정하세요. 지정한 층의 직원만 표시됩니다. 분실하거나 사용하지 않는 기기는 연결을 해제할 수 있습니다.</p>
      <div class="att-filters"><a class="att-button" href="./attendance.html?floor=1" target="_blank" rel="noopener">1층 태블릿 연결 ↗</a><a class="att-button" href="./attendance.html?floor=2" target="_blank" rel="noopener">2층 태블릿 연결 ↗</a></div>
      <div>${tablets.length ? tablets.map(d => `<div class="att-shift-item att-row"><div><strong>${U.esc(d.name)}</strong> <span class="att-pill">${d.floor ?? 1}층</span><div class="att-meta">${U.date(d.createdAt)} 연결</div></div><div class="att-filters"><button class="att-button" type="button" data-device-floor="${U.esc(d.id)}">층 변경</button><button class="att-button att-danger" type="button" data-revoke="${U.esc(d.id)}">연결 해제</button></div></div>`).join('') : '<div class="att-empty">연결된 태블릿이 없습니다.</div>'}</div>`, async () => {}, { submitLabel: '닫기' });
    el.querySelectorAll('[data-device-floor]').forEach(button => { button.onclick = () => {
      const device = tablets.find(d => d.id === button.dataset.deviceFloor);
      U.dialog('태블릿 근무 층 변경', `<p>${U.esc(device.name)}</p><label class="att-field">표시할 직원의 층<select class="att-input" name="floor"><option value="1" ${(device.floor ?? 1) === 1 ? 'selected' : ''}>1층 직원만 표시</option><option value="2" ${device.floor === 2 ? 'selected' : ''}>2층 직원만 표시</option></select></label>`, async form => {
        await api('device.floor', { id: device.id, version: device.version || 1, floor: Number(form.get('floor')) }); el.close(); await load();
      });
    }; });
    el.querySelectorAll('[data-revoke]').forEach(button => { button.onclick = () => {
      const device = tablets.find(d => d.id === button.dataset.revoke);
      U.dialog('태블릿 연결 해제', `<p>${U.esc(device.name)}의 출퇴근 기록 권한을 해제할까요?</p>`, async () => {
        await api('device.revoke', { id: device.id }); el.close(); await load();
      }, { submitLabel: '연결 해제' });
    }; });
  }
  function exportPayroll() {
    if (loading) return;
    const rows = payrollRows(records());
    const scope = floor === 'all' ? '전체 층' : `${floor}층`;
    const values = [['조회월', '조회층', '직원명', '급여유형', '현재 약정 월급(원)', '출근일수', '완료근무건수', '유급근무(분)', '무급휴게(분)', '미퇴근건수', '기본급(원, 수당·세금 제외)'], ...rows.map(r => [month, scope, r.name, r.type, r.salaryType === 'salaried' ? r.monthlySalary ?? '미설정' : '', r.days, r.count, r.minutes, r.breaks, r.open, r.type === '월급' ? '' : r.amount])];
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
      const row = payrollRows(records()).find(r => r.id === id), amount = row && transferAmount(row);
      if (amount !== null && amount !== undefined) copyText(String(amount), '입금 기준액을');
    }
    if (action === 'delete-employee') {
      const e = person(id);
      U.dialog('직원 삭제', `<p>${U.esc(e.name)} 님을 직원 목록에서 삭제할까요?</p><p class="att-note">태블릿에서 이름이 사라지고, 지난 근태와 정산 기록은 보존되며 주민등록번호와 계좌정보는 삭제됩니다.</p>`, async () => {
        await api('employee.delete', { id, version: e.version }); await load();
      }, { submitLabel: '직원 삭제' });
    }
    if (action === 'new-shift') shiftForm();
    if (action === 'edit-shift') shiftForm([...data.shifts, ...data.openShifts].find(s => s.id === id));
    if (action === 'employee-calendar') { employeeId = id; $('att-employee-filter').value = id; view = 'calendar'; render(); }
    if (action === 'devices') devicesDialog();
    if (action === 'export') exportPayroll();
  }
  window.AttendanceAdmin = { init, dispose };
})();
