// Logen courier integration for the delivery-management courier section.
const LOGEN_DEFAULT_API_BASE = 'https://api-rekpg53hvq-uc.a.run.app';
const LOGEN_STATUS_LABELS = {
  logen_ready: '전송대기',
  logen_registering: '전송중',
  logen_registered: '전송완료',
  logen_failed: '전송실패',
  slip_pending: '송장대기',
  slip_ready: '송장확정',
  printed: '출력완료',
  delivery_done: '배송완료'
};

function logenApiBase(){
  return (localStorage.getItem('gjsLogenApiBase') || LOGEN_DEFAULT_API_BASE).replace(/\/+$/,'');
}

function logenShipment(c, shipDate){
  return (c?.logenShipments && c.logenShipments[shipDate]) || {};
}

function logenStatus(c, shipDate){
  return logenShipment(c, shipDate).status || 'logen_ready';
}

function logenStatusBadgeHtml(c, shipDate){
  const status = logenStatus(c, shipDate);
  const label = LOGEN_STATUS_LABELS[status] || status || '전송대기';
  const style = {
    logen_ready: 'background:#eef2ff;color:#3730a3;border-color:#c7d2fe;',
    logen_registering: 'background:#fff7ed;color:#c2410c;border-color:#fed7aa;',
    logen_registered: 'background:#ecfeff;color:#0e7490;border-color:#a5f3fc;',
    logen_failed: 'background:#fff1f2;color:#be123c;border-color:#fecdd3;',
    slip_pending: 'background:#fefce8;color:#a16207;border-color:#fde68a;',
    slip_ready: 'background:#ecfdf5;color:#047857;border-color:#a7f3d0;',
    printed: 'background:#f5f3ff;color:#6d28d9;border-color:#ddd6fe;',
    delivery_done: 'background:#e8f5e9;color:#1e6e40;border-color:#b7dfc2;'
  }[status] || 'background:#f3f4f6;color:#374151;border-color:#e5e7eb;';
  return `<span class="badge" style="${style}font-weight:800;">${label}</span>`;
}

function logenSlipNoHtml(c, shipDate){
  const slipNo = logenShipment(c, shipDate).slipNo || logenShipment(c, shipDate).invoiceNo || '';
  return slipNo
    ? `<span style="font-size:12px;font-weight:800;color:var(--text);white-space:nowrap;">${slipNo}</span>`
    : '<span style="font-size:12px;color:var(--text3);">-</span>';
}

function logenShipDate(){
  return document.getElementById('todayDate')?.value || todayStr();
}

function checkedCourierCustomerIds(){
  return Array.from(document.querySelectorAll('.ck-courier:checked'))
    .map(el => el.dataset.id)
    .filter(Boolean);
}

function filteredCourierForShipDate(shipDate){
  return filterDeliveryByProduct(listFor(shipDate).filter(c => !c.isDirect), '.today-filter-ck');
}

function isLogenResendable(c, shipDate){
  const status = logenStatus(c, shipDate);
  return !['logen_registered','slip_pending','slip_ready','printed'].includes(status);
}

function unsentCourierCustomerIds(shipDate){
  return filteredCourierForShipDate(shipDate)
    .filter(c => isLogenResendable(c, shipDate))
    .map(c => c.id)
    .filter(Boolean);
}

async function logenIdToken(){
  const user = window.__AUTH?.currentUser;
  if(!user) throw new Error('관리자 로그인이 필요합니다.');
  return user.getIdToken();
}

async function postLogenApi(path, payload){
  const token = await logenIdToken();
  const res = await fetch(`${logenApiBase()}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify(payload)
  });
  const text = await res.text();
  let data;
  try{ data = JSON.parse(text); }catch(e){ data = { ok:false, error:text }; }
  if(!res.ok || data.ok === false) throw new Error(data.error || text || `HTTP ${res.status}`);
  return data;
}

function summarizeLogenResult(data){
  const sent = data.sent ?? data.registered ?? 0;
  const skipped = data.skipped ?? 0;
  const failed = data.failed ?? 0;
  return `성공 ${sent}건 / 건너뜀 ${skipped}건 / 실패 ${failed}건`;
}

async function sendSelectedLogenOrders(){
  const shipDate = logenShipDate();
  const customerIds = checkedCourierCustomerIds();
  if(!customerIds.length){ toast('로젠 전송할 택배를 선택해주세요','er'); return; }
  if(!confirm(`선택한 택배 ${customerIds.length}건을 로젠으로 전송할까요?`)) return;
  try{
    const data = await postLogenApi('/api/logen/register-orders', { shipDate, customerIds, mode:'selected' });
    toast(`로젠 전송 완료: ${summarizeLogenResult(data)}`,'ok');
    renderToday();
  }catch(e){
    toast('로젠 전송 실패: '+(e.message||e),'er');
  }
}

async function sendUnsentLogenOrders(){
  const shipDate = logenShipDate();
  const customerIds = unsentCourierCustomerIds(shipDate);
  if(!customerIds.length){ toast('미전송 택배가 없습니다','info'); return; }
  if(!confirm(`미전송/실패 택배 ${customerIds.length}건을 로젠으로 전송할까요?`)) return;
  try{
    const data = await postLogenApi('/api/logen/register-orders', { shipDate, customerIds, mode:'unsent' });
    toast(`로젠 전송 완료: ${summarizeLogenResult(data)}`,'ok');
    renderToday();
  }catch(e){
    toast('로젠 전송 실패: '+(e.message||e),'er');
  }
}

async function inquireLogenSlipNos(){
  const shipDate = logenShipDate();
  const selected = checkedCourierCustomerIds();
  const customerIds = selected.length
    ? selected
    : filteredCourierForShipDate(shipDate)
        .filter(c => ['logen_registered','slip_pending'].includes(logenStatus(c, shipDate)))
        .map(c => c.id);
  if(!customerIds.length){ toast('송장 조회할 택배가 없습니다','info'); return; }
  try{
    const data = await postLogenApi('/api/logen/inquiry-slip-nos', { shipDate, customerIds, mode:selected.length?'selected':'all' });
    toast(`송장번호 조회 완료: ${summarizeLogenResult(data)}`,'ok');
    renderToday();
  }catch(e){
    toast('송장번호 조회 실패: '+(e.message||e),'er');
  }
}
