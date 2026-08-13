(function(root, factory){
  const api = factory(root);
  if(typeof module === 'object' && module.exports) module.exports = api;
  if(root) Object.assign(root, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function(root){
  'use strict';

  const editorStates = {
    add:{ dates:[], deliveredDates:[], month:'' },
    edit:{ dates:[], deliveredDates:[], month:'' }
  };

  const editorConfig = {
    add:{
      wrap:'af-manual-dates', monthLabel:'a-manual-month-label', calendar:'a-manual-calendar',
      summary:'a-manual-summary', count:'ato', schedule:'af-sched', start:'af-start',
      direct:'a-direct', hint:'a-manual-hint'
    },
    edit:{
      wrap:'ef-manual-dates', monthLabel:'e-manual-month-label', calendar:'e-manual-calendar',
      summary:'e-manual-summary', count:'erem', schedule:'ef-sched-sel', start:'ef-start-wrap',
      pending:'ef-sched-from-wrap',
      direct:'e-direct', hint:'e-manual-hint'
    }
  };

  function validManualDeliveryDate(value){
    const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if(!match) return false;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(year, month - 1, day);
    return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
  }

  function normalizeManualDeliveryDates(values){
    return [...new Set((Array.isArray(values) ? values : [])
      .map(value => String(value || '').trim())
      .filter(validManualDeliveryDate))].sort();
  }

  function isManualDeliverySchedule(customer){
    return customer?.scheduleMode === 'manual' || Array.isArray(customer?.manualDeliveryDates);
  }

  function manualScheduleIncludes(customer, dateStr){
    return isManualDeliverySchedule(customer)
      && normalizeManualDeliveryDates(customer.manualDeliveryDates).includes(dateStr);
  }

  function manualScheduledFutureDates(dates, deliveredDates, fromDate){
    const delivered = new Set(normalizeManualDeliveryDates(deliveredDates));
    return normalizeManualDeliveryDates(dates)
      .filter(date => date >= fromDate && !delivered.has(date));
  }

  function manualUpcomingDeliveryDates(customer, fromDate){
    if(!isManualDeliverySchedule(customer)) return [];
    return manualScheduledFutureDates(
      customer.manualDeliveryDates,
      customer.deliveredDates,
      fromDate
    );
  }

  function manualScheduleSelectionValid(dates, deliveredDates, fromDate, requiredCount){
    const required = Math.max(0, Number(requiredCount) || 0);
    return manualScheduledFutureDates(dates, deliveredDates, fromDate).length === required;
  }

  function manualDeliveryOrderNumber(dates, dateStr){
    const index = normalizeManualDeliveryDates(dates).indexOf(dateStr);
    return index >= 0 ? index + 1 : 0;
  }

  function manualDeliveryOrderLabel(orderNumber){
    const labels = ['', '①','②','③','④','⑤','⑥','⑦','⑧','⑨','⑩','⑪','⑫','⑬','⑭','⑮','⑯','⑰','⑱','⑲','⑳'];
    const order = Math.max(0, Number(orderNumber) || 0);
    return labels[order] || (order ? String(order) : '');
  }

  function localToday(){
    if(root && typeof root.todayStr === 'function') return root.todayStr();
    const date = new Date();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  function monthKey(dateStr){
    return validManualDeliveryDate(dateStr) ? dateStr.slice(0, 7) : localToday().slice(0, 7);
  }

  function shiftMonth(value, amount){
    const match = String(value || '').match(/^(\d{4})-(\d{2})$/);
    const base = match ? new Date(Number(match[1]), Number(match[2]) - 1, 1) : new Date();
    base.setMonth(base.getMonth() + amount);
    return `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, '0')}`;
  }

  function editorRequiredCount(mode){
    const config = editorConfig[mode];
    const input = config && root?.document?.getElementById(config.count);
    return Math.max(0, parseInt(input?.value, 10) || 0);
  }

  function editorFutureDates(mode){
    const state = editorStates[mode];
    return manualScheduledFutureDates(state.dates, state.deliveredDates, localToday());
  }

  // 캘린더에 넣는 날짜는 조리·출고일이다.
  // 직배송은 그날 바로 배달하지만, 택배는 그날 발송해서 고객은 다음날 받는다.
  function manualArrivalDate(dateStr){
    if(!validManualDeliveryDate(dateStr)) return '';
    const [year, month, day] = dateStr.split('-').map(Number);
    const arrival = new Date(year, month - 1, day + 1);
    return `${arrival.getFullYear()}-${String(arrival.getMonth() + 1).padStart(2, '0')}-${String(arrival.getDate()).padStart(2, '0')}`;
  }

  function isSundayDate(dateStr){
    if(!validManualDeliveryDate(dateStr)) return false;
    const [year, month, day] = dateStr.split('-').map(Number);
    return new Date(year, month - 1, day).getDay() === 0;
  }

  function editorIsDirect(mode){
    const config = editorConfig[mode];
    const input = config?.direct && root?.document?.getElementById(config.direct);
    return input?.checked === true;
  }

  function formatCalendarDate(dateStr){
    const [year, month, day] = dateStr.split('-').map(Number);
    const weekday = ['일','월','화','수','목','금','토'][new Date(year, month - 1, day).getDay()];
    return `${month}.${String(day).padStart(2, '0')}(${weekday})`;
  }

  function renderManualScheduleEditor(mode){
    const config = editorConfig[mode];
    const state = editorStates[mode];
    if(!config || !state || !root?.document) return;
    const calendar = root.document.getElementById(config.calendar);
    const label = root.document.getElementById(config.monthLabel);
    const summary = root.document.getElementById(config.summary);
    if(!calendar || !label || !summary) return;

    const [year, month] = state.month.split('-').map(Number);
    const first = new Date(year, month - 1, 1);
    const firstOffset = (first.getDay() + 6) % 7;
    const daysInMonth = new Date(year, month, 0).getDate();
    const selected = new Set(state.dates);
    const delivered = new Set(state.deliveredDates);
    const today = localToday();
    const cells = [];

    for(let index = 0; index < 42; index += 1){
      const day = index - firstOffset + 1;
      if(day < 1 || day > daysInMonth){
        cells.push('<span class="manual-calendar-empty" aria-hidden="true"></span>');
        continue;
      }
      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const isDelivered = delivered.has(dateStr);
      const isSelected = selected.has(dateStr) && !isDelivered;
      const orderNumber = (isSelected || isDelivered) ? manualDeliveryOrderNumber(state.dates, dateStr) : 0;
      const orderLabel = manualDeliveryOrderLabel(orderNumber);
      const isPast = dateStr < today;
      const disabled = isDelivered || (isPast && !isSelected);
      const classes = [
        'manual-calendar-day',
        isSelected ? 'is-selected' : '',
        isDelivered ? 'is-complete' : '',
        dateStr === today ? 'is-today' : '',
        disabled ? 'is-disabled' : ''
      ].filter(Boolean).join(' ');
      const status = isDelivered ? `, ${orderNumber}회차 배송완료` : (isSelected ? `, ${orderNumber}회차 선택됨` : '');
      cells.push(`<button type="button" class="${classes}" data-manual-date="${dateStr}" aria-label="${year}년 ${month}월 ${day}일${status}" aria-pressed="${isSelected}"${disabled ? ' disabled' : ''}><span class="manual-calendar-date">${day}</span>${orderLabel ? `<span class="manual-calendar-order" aria-hidden="true">${orderLabel}</span>` : ''}</button>`);
    }

    label.textContent = `${year}년 ${month}월`;
    calendar.innerHTML = `<div class="manual-calendar-weekdays">${['월','화','수','목','금','토','일'].map(day => `<span>${day}</span>`).join('')}</div><div class="manual-calendar-days">${cells.join('')}</div>`;

    const futureDates = editorFutureDates(mode);
    const required = editorRequiredCount(mode);
    const completeCount = state.deliveredDates.length;
    const countClass = futureDates.length === required ? 'is-ready' : 'is-pending';
    const direct = editorIsDirect(mode);
    const datesText = futureDates.length
      ? futureDates.map(date => {
        const order = manualDeliveryOrderLabel(manualDeliveryOrderNumber(state.dates, date));
        const detail = direct
          ? `<span class="manual-calendar-arrive">${formatCalendarDate(date)} 배송</span>`
          : `<span class="manual-calendar-arrive">${formatCalendarDate(date)} 출고 → <b>${formatCalendarDate(manualArrivalDate(date))} 도착</b>${isSundayDate(manualArrivalDate(date)) ? '<span class="manual-calendar-warn" title="일요일은 택배 배송이 없을 수 있습니다">!</span>' : ''}</span>`;
        return `<span class="manual-calendar-summary-item"><span class="manual-calendar-summary-order">${order}</span>${detail}</span>`;
      }).join('')
      : '선택된 출고일 없음';
    summary.innerHTML = `<div class="manual-calendar-summary-head"><strong class="${countClass}">출고일 ${futureDates.length} / ${required}</strong>${completeCount ? `<span>완료 ${completeCount}회</span>` : ''}</div><div class="manual-calendar-selected">${datesText}</div>`;

    const hint = config.hint && root.document.getElementById(config.hint);
    if(hint){
      hint.textContent = direct
        ? '직배송 고객입니다. 선택한 날짜에 조리해서 그날 바로 배달합니다.'
        : '택배 고객입니다. 선택한 날짜는 조리·발송일이며, 고객은 다음날 받습니다.';
    }
  }

  function handleManualScheduleClick(mode, event){
    const state = editorStates[mode];
    const monthButton = event.target.closest('[data-manual-month]');
    if(monthButton){
      const action = monthButton.dataset.manualMonth;
      state.month = action === 'today' ? localToday().slice(0, 7) : shiftMonth(state.month, Number(action));
      renderManualScheduleEditor(mode);
      return;
    }

    const dayButton = event.target.closest('[data-manual-date]');
    if(!dayButton || dayButton.disabled) return;
    const dateStr = dayButton.dataset.manualDate;
    const index = state.dates.indexOf(dateStr);
    if(index >= 0){
      state.dates.splice(index, 1);
    } else {
      const required = editorRequiredCount(mode);
      if(editorFutureDates(mode).length >= required){
        if(root && typeof root.toast === 'function') root.toast(`배송일은 ${required}개까지 선택할 수 있습니다`, 'er');
        return;
      }
      state.dates.push(dateStr);
      state.dates = normalizeManualDeliveryDates(state.dates);
    }
    renderManualScheduleEditor(mode);
  }

  function initManualScheduleEditor(mode){
    const config = editorConfig[mode];
    const wrap = config && root?.document?.getElementById(config.wrap);
    if(!wrap || wrap.dataset.manualReady === 'true') return;
    wrap.dataset.manualReady = 'true';
    wrap.addEventListener('click', event => handleManualScheduleClick(mode, event));
    const countInput = root.document.getElementById(config.count);
    if(countInput) countInput.addEventListener('input', () => renderManualScheduleEditor(mode));
    const directInput = config.direct && root.document.getElementById(config.direct);
    if(directInput) directInput.addEventListener('change', () => renderManualScheduleEditor(mode));
  }

  function loadManualScheduleEditor(mode, customer){
    const state = editorStates[mode];
    if(!state) return;
    const deliveredDates = normalizeManualDeliveryDates(customer?.deliveredDates);
    const delivered = new Set(deliveredDates);
    const today = localToday();
    const plannedDates = normalizeManualDeliveryDates(customer?.manualDeliveryDates)
      .filter(date => delivered.has(date) || date >= today);
    state.deliveredDates = deliveredDates;
    state.dates = normalizeManualDeliveryDates([...deliveredDates, ...plannedDates]);
    const firstFuture = manualScheduledFutureDates(state.dates, deliveredDates, today)[0];
    state.month = monthKey(firstFuture || today);
    initManualScheduleEditor(mode);
    renderManualScheduleEditor(mode);
  }

  function resetManualScheduleEditor(mode){
    loadManualScheduleEditor(mode, null);
  }

  function syncManualScheduleMode(mode, frequency, isSubscription){
    const config = editorConfig[mode];
    if(!config || !root?.document) return;
    const manual = isSubscription !== false && frequency === 'manual';
    const toggle = (id, visible) => {
      const element = id && root.document.getElementById(id);
      if(element) element.style.display = visible ? '' : 'none';
    };
    toggle(config.wrap, manual);
    toggle(config.schedule, isSubscription !== false && !manual);
    toggle(config.start, isSubscription !== false && !manual);
    toggle(config.pending, isSubscription !== false && !manual);
    if(manual){
      if(!editorStates[mode].month) loadManualScheduleEditor(mode, null);
      else {
        initManualScheduleEditor(mode);
        renderManualScheduleEditor(mode);
      }
    }
  }

  function manualScheduleDatesForSave(mode){
    const state = editorStates[mode];
    if(!state) return [];
    const delivered = new Set(state.deliveredDates);
    const today = localToday();
    return normalizeManualDeliveryDates(state.dates)
      .filter(date => delivered.has(date) || date >= today);
  }

  return {
    validManualDeliveryDate,
    normalizeManualDeliveryDates,
    isManualDeliverySchedule,
    manualScheduleIncludes,
    manualScheduledFutureDates,
    manualUpcomingDeliveryDates,
    manualScheduleSelectionValid,
    manualDeliveryOrderNumber,
    manualDeliveryOrderLabel,
    loadManualScheduleEditor,
    resetManualScheduleEditor,
    syncManualScheduleMode,
    renderManualScheduleEditor,
    manualScheduleDatesForSave,
    manualArrivalDate
  };
});
