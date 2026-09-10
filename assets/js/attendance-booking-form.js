(function () {
  'use strict';
  const U = window.AttendanceUI;
  const pendingByScope = new Map();
  window.AttendanceBookingForm = { open({ date, menuOptions = [], scope, save, onSaved }) {
    if (document.querySelector('dialog[open]')) return;
    let pending = pendingByScope.get(scope) || null;
    const initial = pending || { name: '', date, time: '', menu: '', seat: '', people: 2 };
    const dialog = U.dialog('간편 예약 등록', `<p class="att-meta">전화·방문으로 받은 예약을 간단히 기록하세요.</p><fieldset class="att-booking-fields" ${pending ? 'disabled' : ''}>
      <div class="att-form-grid"><label class="att-field">이름<input class="att-input" name="name" maxlength="60" value="${U.esc(initial.name)}" placeholder="예약자 이름" autocomplete="off" required></label>
      <label class="att-field">인원<input class="att-input" name="people" type="number" inputmode="numeric" min="1" max="999" value="${initial.people}" required></label>
      <label class="att-field">날짜<input class="att-input" name="date" type="date" value="${U.esc(initial.date)}" min="${U.date(Date.now())}" max="${U.date(Date.now() + 365 * 86400000)}" required></label>
      <label class="att-field">시간<input class="att-input" name="time" type="time" value="${U.esc(initial.time)}" required></label></div>
      <label class="att-field">메뉴<input class="att-input" name="menu" list="att-booking-menus" maxlength="60" value="${U.esc(initial.menu)}" placeholder="메뉴를 선택하거나 입력" required><datalist id="att-booking-menus">${menuOptions.map(menu => `<option value="${U.esc(menu)}"></option>`).join('')}</datalist></label>
      <label class="att-field">좌석 <small>선택 사항</small><input class="att-input" name="seat" maxlength="60" value="${U.esc(initial.seat)}" placeholder="예: 홀 3번, 룸 2"></label></fieldset>`,
    async (form, el) => {
      if (!pending) pending = { requestId: crypto.randomUUID(), name: form.get('name').trim(), date: form.get('date'), time: form.get('time'),
        menu: form.get('menu').trim(), seat: form.get('seat').trim(), people: Number(form.get('people')) };
      pendingByScope.set(scope, pending);
      el.querySelector('fieldset').disabled = true;
      let result;
      try { result = await save(pending); }
      catch (error) {
        if ([400, 401, 403].includes(error.status)) { pending = null; pendingByScope.delete(scope); el.querySelector('fieldset').disabled = false; }
        throw error;
      }
      pending = null; pendingByScope.delete(scope);
      // Save success must stay success even if the subsequent list refresh fails.
      await onSaved(result);
    }, { submitLabel: pending ? '같은 예약 다시 확인' : '예약 등록하기' });
    if (pending) dialog.querySelector('.att-error').textContent = '직전 저장 결과를 확인하지 못했습니다. 같은 내용으로 다시 확인해 주세요.';
  }, clear() { pendingByScope.clear(); } };
})();
