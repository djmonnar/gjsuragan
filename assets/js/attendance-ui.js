(function (root) {
  'use strict';
  const ENDPOINT = 'https://asia-northeast3-gjsuragan-60505.cloudfunctions.net/attendanceApi';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const date = ms => new Date(ms + 9 * 3600000).toISOString().slice(0, 10);
  const dateTime = ms => ms == null ? '' : new Date(ms + 9 * 3600000).toISOString().slice(0, 16);
  const time = ms => ms == null ? '—' : new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(ms);
  const money = value => `${Number(value || 0).toLocaleString('ko-KR')}원`;
  const duration = minutes => `${Math.floor(minutes / 60)}시간 ${minutes % 60}분`;
  async function request(action, data = {}, credential = {}) {
    if (navigator.onLine === false) throw new Error('인터넷 연결을 확인해 주세요. 연결 후 다시 눌러야 기록됩니다.');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (credential.token) headers.Authorization = `Bearer ${credential.token}`;
      if (credential.device) headers['X-Attendance-Device'] = credential.device;
      const response = await fetch(ENDPOINT, { method: 'POST', headers, body: JSON.stringify({ ...data, action }), signal: controller.signal, cache: 'no-store' });
      const result = await response.json();
      if (!response.ok) {
        const error = new Error(result.error || '요청을 처리하지 못했습니다.');
        error.status = response.status;
        throw error;
      }
      return result;
    } catch (error) {
      if (error.name === 'AbortError' || error instanceof TypeError) throw new Error(action === 'kiosk.punch'
        ? '응답을 확인하지 못했습니다. 연결을 확인하고 다시 눌러 주세요. 같은 요청은 중복 저장되지 않습니다.'
        : '응답을 확인하지 못했습니다. 새로고침으로 반영 여부를 확인한 뒤 다시 시도해 주세요.');
      throw error;
    } finally { clearTimeout(timer); }
  }
  function dialog(title, body, onSubmit, options = {}) {
    const el = document.createElement('dialog');
    el.className = 'att-dialog';
    el.setAttribute('aria-label', title);
    el.innerHTML = `<form><div class="att-dialog-head"><h2>${esc(title)}</h2><button type="button" class="att-icon-button" data-close aria-label="닫기">×</button></div>${body}<p class="att-error" role="alert"></p><div class="att-dialog-actions"><button class="att-button" type="button" data-close>취소</button><button class="att-button att-primary" type="submit">${esc(options.submitLabel || '저장하기')}</button></div></form>`;
    let busy = false;
    el.querySelectorAll('[data-close]').forEach(button => button.onclick = () => { if (!busy) el.close(); });
    el.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
    el.addEventListener('close', () => el.remove());
    el.querySelector('form').onsubmit = async event => {
      event.preventDefault();
      if (busy) return;
      busy = true;
      const buttons = el.querySelectorAll('button');
      buttons.forEach(button => { button.disabled = true; });
      const submit = el.querySelector('[type=submit]');
      const oldText = submit.textContent;
      submit.textContent = '저장 중…';
      el.querySelector('.att-error').textContent = '';
      try { await onSubmit(new FormData(event.target), el); el.close(); }
      catch (error) { el.querySelector('.att-error').textContent = error.message; }
      finally { busy = false; buttons.forEach(button => { button.disabled = false; }); submit.textContent = oldText; }
    };
    document.body.append(el);
    el.showModal();
    return el;
  }
  root.AttendanceUI = { esc, date, dateTime, time, money, duration, request, dialog };
})(window);
