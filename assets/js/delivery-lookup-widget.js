// 홈페이지(gjsuragan.co.kr, 아임웹)에 넣는 '남은 배송 회차 조회' 창.
// 손님은 주문자 이름과 전화번호로 조회한다. 네이버페이 주문도 같은 방법으로 찾는다.
// 선물 받은 분은 받는 분 이름·번호로도 찾을 수 있다.
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

  // 아임웹 테마 CSS 가 p·label·input 에 여백과 글꼴을 입히므로 여기서 모두 다시 정한다.
  // 코드 위젯은 PC 에서도 좁은 칸에 놓일 수 있어서 화면 폭이 아니라 위젯 칸의 폭(@container)으로 배치를 바꾼다.
  const CSS = `
.gjs-dl-wrap{container-type:inline-size;width:100%}
.gjs-dl{box-sizing:border-box;max-width:780px;margin:0 auto;padding:24px 18px;border:1px solid #eadfd6;border-radius:18px;background:#fffdfa;color:#2b2119;font-family:inherit;font-size:15px;line-height:1.55;text-align:left;word-break:keep-all;overflow-wrap:anywhere}
.gjs-dl *{box-sizing:border-box;font-family:inherit;letter-spacing:normal}
.gjs-dl p,.gjs-dl ul,.gjs-dl li,.gjs-dl label{margin:0;padding:0;line-height:1.55}
.gjs-dl [hidden]{display:none!important}
.gjs-dl .gjs-dl-title{margin:0 0 6px;font-size:21px;font-weight:800;line-height:1.3;color:#7B3F1A}
.gjs-dl .gjs-dl-desc{margin:0 0 18px;font-size:14.5px;color:#6f5f52}
.gjs-dl-fields{display:grid;gap:14px}
.gjs-dl .gjs-dl-label{display:block;margin:0;font-size:14.5px;font-weight:700;color:#3d2f24}
.gjs-dl .gjs-dl-input{display:block;width:100%;height:50px;margin:6px 0 0;padding:0 14px;border:1.5px solid #d9cabd;border-radius:12px;background:#fff;color:#2b2119;font-size:17px;line-height:normal;-webkit-appearance:none;appearance:none;box-shadow:none}
.gjs-dl .gjs-dl-input::placeholder{color:#b3a497}
.gjs-dl .gjs-dl-input:focus{border-color:#7B3F1A;outline:3px solid rgba(123,63,26,.15);outline-offset:0}
.gjs-dl .gjs-dl-btn{display:block;width:100%;height:52px;margin:4px 0 0;padding:0 24px;border:0;border-radius:12px;background:#7B3F1A;color:#fff;font-size:17px;font-weight:800;cursor:pointer;-webkit-appearance:none;appearance:none}
.gjs-dl .gjs-dl-btn:hover{background:#673414}
.gjs-dl .gjs-dl-btn:disabled{opacity:.6;cursor:default}
.gjs-dl .gjs-dl-msg{margin:14px 0 0;padding:12px 14px;border-radius:10px;background:#fdecea;color:#a1231b;font-size:15px;font-weight:600}
.gjs-dl-result{margin-top:20px}
.gjs-dl-result:empty{display:none}
.gjs-dl-cards{display:grid;gap:12px}
.gjs-dl-card{padding:18px;border-radius:14px;background:#fff;border:1px solid #eadfd6}
.gjs-dl-head{display:flex;justify-content:space-between;gap:10px;align-items:flex-start}
.gjs-dl-product{font-size:18px;font-weight:800;line-height:1.35}
.gjs-dl-schedule{margin-top:2px;font-size:14px;color:#6f5f52}
.gjs-dl-badge{flex:none;padding:4px 10px;border-radius:999px;font-size:13px;font-weight:700;background:#f3e7dc;color:#7B3F1A;white-space:nowrap}
.gjs-dl-badge.is-done{background:#e5efe6;color:#2f6b3a}
.gjs-dl-badge.is-pause{background:#f8efd4;color:#7d5800}
.gjs-dl-remain{margin:14px 0 8px;font-size:16px;color:#3d2f24}
.gjs-dl-remain strong{font-size:34px;font-weight:800;line-height:1;color:#7B3F1A}
.gjs-dl-remain span{color:#6f5f52}
.gjs-dl-bar{height:10px;border-radius:999px;background:#f1e8e0;overflow:hidden}
.gjs-dl-bar span{display:block;height:100%;border-radius:999px;background:#c9925f}
.gjs-dl .gjs-dl-meta{margin:12px 0 0;padding:12px 0 0;border-top:1px dashed #eadfd6;list-style:none;display:grid;gap:3px;font-size:14.5px;color:#4d3f34}
.gjs-dl .gjs-dl-note{margin:12px 0 0;font-size:13.5px;color:#8a7a6d}
@container (min-width:640px){
  .gjs-dl{padding:34px 36px}
  .gjs-dl .gjs-dl-title{font-size:26px}
  .gjs-dl .gjs-dl-desc{font-size:15.5px;margin-bottom:22px}
  .gjs-dl-fields{grid-template-columns:1fr 1fr auto;align-items:end}
  .gjs-dl .gjs-dl-btn{width:auto;min-width:130px;height:50px;margin:0}
  .gjs-dl-cards{grid-template-columns:repeat(auto-fit,minmax(290px,1fr));gap:16px}
  .gjs-dl-card{padding:22px}
  .gjs-dl-product{font-size:19px}
}
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
    return `<div class="gjs-dl-cards">${lines.map(renderLine).join('')}</div>` +
      (hidden ? `<p class="gjs-dl-note">이전 주문 ${hidden}건이 더 있습니다. 자세한 내용은 매장으로 문의해주세요.</p>` : '') +
      '<p class="gjs-dl-note">배송을 마친 뒤 매장에서 확인 처리하면 횟수가 줄어듭니다. 당일 배송분은 조금 늦게 반영될 수 있어요.</p>';
  }

  function mount(root){
    if(root.getAttribute('data-gjs-mounted') === '1') return;
    root.setAttribute('data-gjs-mounted', '1');
    const api = root.getAttribute('data-api') || DEFAULT_API;
    root.innerHTML = `
      <div class="gjs-dl-wrap"><form class="gjs-dl" novalidate>
        <p class="gjs-dl-title">남은 배송 회차 조회</p>
        <p class="gjs-dl-desc">주문하실 때 적은 주문자 이름과 전화번호를 넣어주세요. 네이버페이로 주문하셨어도 똑같이 조회됩니다.</p>
        <div class="gjs-dl-fields">
        <label class="gjs-dl-label">주문자 이름
          <input class="gjs-dl-input" name="name" autocomplete="name" placeholder="예) 홍길동" required>
        </label>
        <label class="gjs-dl-label">주문자 전화번호
          <input class="gjs-dl-input" name="phone" type="tel" inputmode="numeric" autocomplete="tel" placeholder="예) 010-1234-5678" required>
        </label>
        <button class="gjs-dl-btn" type="submit">조회하기</button>
        </div>
        <p class="gjs-dl-msg" role="alert" hidden></p>
        <div class="gjs-dl-result" aria-live="polite"></div>
      </form></div>`;
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
      if(!name) return showError('주문자 이름을 입력해주세요.');
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
