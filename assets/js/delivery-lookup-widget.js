// 홈페이지(gjsuragan.co.kr, 아임웹)에 넣는 '남은 배송 회차 조회' 창.
// 손님은 받는 분 이름과 전화번호로 조회한다. 네이버페이 주문도 같은 방법으로 찾는다.
// 아임웹 HTML 코드 위젯에 아래 두 줄만 넣으면 그 자리에 조회창이 그려진다.
//   <div data-gjs-delivery-lookup></div>
//   <script src="https://djmonnar.github.io/gjsuragan/assets/js/delivery-lookup-widget.js"></script>
// 이 파일을 고치면 아임웹을 다시 건드리지 않아도 GitHub Pages 배포로 바로 바뀐다.
// 아임웹 화면의 글꼴·색과 섞이지 않게 클래스 이름은 모두 gjs-dl- 로 시작한다.
(function(){
  'use strict';
  if(window.__gjsDeliveryLookupLoaded) return;
  window.__gjsDeliveryLookupLoaded = true;

  const DEFAULT_API = 'https://asia-northeast3-gjsuragan-60505.cloudfunctions.net/api/api/delivery/lookup';
  const STATUS_TEXT = { active:'배송 진행 중', pause:'일시정지 · 일정 확인 중', done:'배송 완료' };

  const CSS = `
.gjs-dl{box-sizing:border-box;max-width:460px;margin:0 auto;padding:22px 18px;border:1px solid #eadfd6;border-radius:16px;background:#fffdfa;color:#2b2119;font-family:inherit;line-height:1.5;text-align:left}
.gjs-dl *{box-sizing:border-box}
.gjs-dl-title{margin:0 0 4px;font-size:18px;font-weight:700;color:#7B3F1A}
.gjs-dl-desc{margin:0 0 16px;font-size:13px;color:#7a6a5d}
.gjs-dl-label{display:block;margin:0 0 4px;font-size:13px;font-weight:600}
.gjs-dl-input{display:block;width:100%;height:44px;margin:0 0 12px;padding:0 12px;border:1px solid #d9cabd;border-radius:10px;background:#fff;color:#2b2119;font-size:16px}
.gjs-dl-input:focus{outline:2px solid #c9925f;outline-offset:1px}
.gjs-dl-btn{display:block;width:100%;height:46px;border:0;border-radius:10px;background:#7B3F1A;color:#fff;font-size:16px;font-weight:700;cursor:pointer}
.gjs-dl-btn:disabled{opacity:.6;cursor:default}
.gjs-dl-msg{margin:12px 0 0;font-size:14px;color:#b3261e}
.gjs-dl-result{margin-top:18px}
.gjs-dl-card{margin:0 0 12px;padding:16px;border-radius:12px;background:#fff;border:1px solid #eadfd6}
.gjs-dl-head{display:flex;justify-content:space-between;gap:8px;align-items:flex-start}
.gjs-dl-product{font-size:16px;font-weight:700}
.gjs-dl-schedule{font-size:13px;color:#7a6a5d}
.gjs-dl-badge{flex:none;padding:2px 8px;border-radius:999px;font-size:12px;font-weight:600;background:#f3e7dc;color:#7B3F1A;white-space:nowrap}
.gjs-dl-badge.is-done{background:#e8eee8;color:#2f6b3a}
.gjs-dl-badge.is-pause{background:#f6efd8;color:#8a6200}
.gjs-dl-remain{margin:12px 0 6px;font-size:15px}
.gjs-dl-remain strong{font-size:28px;color:#7B3F1A}
.gjs-dl-bar{height:8px;border-radius:999px;background:#f1e8e0;overflow:hidden}
.gjs-dl-bar span{display:block;height:100%;background:#c9925f}
.gjs-dl-meta{margin:8px 0 0;padding:0;list-style:none;font-size:13px;color:#7a6a5d}
.gjs-dl-note{margin:4px 0 0;font-size:12px;color:#9a8b7f}
`;

  function escapeHtml(value){
    return String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({
      '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
    })[ch]);
  }

  function formatDate(value){
    const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if(!match) return '';
    const date = new Date(Date.UTC(+match[1], +match[2] - 1, +match[3]));
    const day = '일월화수목금토'[date.getUTCDay()];
    return `${+match[2]}월 ${+match[3]}일(${day})`;
  }

  function count(value){
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
  }

  function renderLine(line){
    const total = count(line.total);
    const remain = Math.min(count(line.remain), total);
    const used = total - remain;
    const status = STATUS_TEXT[line.status] ? line.status : 'active';
    const percent = total > 0 ? Math.round(used / total * 100) : 0;
    const meta = [];
    const ordered = formatDate(line.orderDate);
    if(ordered) meta.push(`주문일 ${ordered}`);
    meta.push(`받으신 배송 ${used}회`);
    const last = formatDate(line.lastDeliveredDate);
    if(last) meta.push(`최근 배송 ${last}`);
    else if(line.startDate && status !== 'done') meta.push(`첫 배송 예정 ${formatDate(line.startDate)}`);
    return `
      <div class="gjs-dl-card">
        <div class="gjs-dl-head">
          <div>
            <div class="gjs-dl-product">${escapeHtml(line.product || '궁중수라간 배송')}</div>
            ${line.scheduleName && line.scheduleName !== line.product ? `<div class="gjs-dl-schedule">${escapeHtml(line.scheduleName)}</div>` : ''}
          </div>
          <span class="gjs-dl-badge is-${status}">${STATUS_TEXT[status]}</span>
        </div>
        <div class="gjs-dl-remain">남은 배송 <strong>${remain}</strong>회 <span>/ 전체 ${total}회</span></div>
        <div class="gjs-dl-bar" aria-hidden="true"><span style="width:${percent}%"></span></div>
        <ul class="gjs-dl-meta">${meta.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
      </div>`;
  }

  function renderResult(data){
    const lines = Array.isArray(data.lines) ? data.lines : [];
    if(!lines.length) return '';
    const hidden = count(data.hiddenCount);
    return lines.map(renderLine).join('') +
      (hidden ? `<p class="gjs-dl-note">이전 주문 ${hidden}건이 더 있습니다. 자세한 내용은 매장으로 문의해주세요.</p>` : '') +
      '<p class="gjs-dl-note">배송을 마친 뒤 매장에서 확인 처리하면 횟수가 줄어듭니다. 당일 배송분은 조금 늦게 반영될 수 있어요.</p>';
  }

  function mount(root){
    if(root.getAttribute('data-gjs-mounted') === '1') return;
    root.setAttribute('data-gjs-mounted', '1');
    const api = root.getAttribute('data-api') || DEFAULT_API;
    root.innerHTML = `
      <form class="gjs-dl" novalidate>
        <p class="gjs-dl-title">남은 배송 회차 조회</p>
        <p class="gjs-dl-desc">배송지에 적은 받는 분 이름과 전화번호를 넣어주세요. 네이버페이로 주문하셨어도 똑같이 조회됩니다.</p>
        <label class="gjs-dl-label">받는 분 이름
          <input class="gjs-dl-input" name="name" autocomplete="name" placeholder="예) 홍길동" required>
        </label>
        <label class="gjs-dl-label">받는 분 전화번호
          <input class="gjs-dl-input" name="phone" type="tel" inputmode="numeric" autocomplete="tel" placeholder="예) 010-1234-5678" required>
        </label>
        <button class="gjs-dl-btn" type="submit">조회하기</button>
        <p class="gjs-dl-msg" role="alert" hidden></p>
        <div class="gjs-dl-result" aria-live="polite"></div>
      </form>`;
    const form = root.querySelector('form');
    const button = form.querySelector('button');
    const message = form.querySelector('.gjs-dl-msg');
    const result = form.querySelector('.gjs-dl-result');

    function showError(text){
      message.textContent = text;
      message.hidden = false;
    }

    form.addEventListener('submit', async event => {
      event.preventDefault();
      message.hidden = true;
      result.innerHTML = '';
      const name = form.elements.name.value.trim();
      const phone = form.elements.phone.value.replace(/\D/g, '');
      if(!name) return showError('받는 분 이름을 입력해주세요.');
      if(phone.length < 10) return showError('전화번호를 010부터 모두 입력해주세요.');
      button.disabled = true;
      button.textContent = '조회 중…';
      try{
        const response = await fetch(api, {
          method:'POST',
          headers:{ 'Content-Type':'application/json' },
          body:JSON.stringify({ name, phone })
        });
        const data = await response.json().catch(() => ({}));
        if(!response.ok || !data.ok) {
          showError(data.error || '지금은 조회할 수 없습니다. 잠시 뒤 다시 시도해주세요.');
          return;
        }
        result.innerHTML = renderResult(data);
      }catch(error){
        showError('인터넷 연결을 확인한 뒤 다시 시도해주세요.');
      }finally{
        button.disabled = false;
        button.textContent = '조회하기';
      }
    });
  }

  function init(){
    if(!document.getElementById('gjs-dl-style')){
      const style = document.createElement('style');
      style.id = 'gjs-dl-style';
      style.textContent = CSS;
      document.head.appendChild(style);
    }
    document.querySelectorAll('[data-gjs-delivery-lookup], #gjs-delivery-lookup').forEach(mount);
  }

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
