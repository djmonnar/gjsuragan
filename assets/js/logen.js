// Logen courier integration for the delivery-management courier section.
const LOGEN_DEFAULT_API_BASE = 'https://asia-northeast3-gjsuragan-60505.cloudfunctions.net/api';
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
const LOGEN_SENT_STATUSES = ['logen_registered','slip_pending','slip_ready','printed'];

function logenApiBase(){
  return (localStorage.getItem('gjsLogenApiBase') || LOGEN_DEFAULT_API_BASE).replace(/\/+$/,'');
}

function logenShipment(c, shipDate){
  return (c?.logenShipments && c.logenShipments[shipDate]) || {};
}

function logenStatus(c, shipDate){
  return logenShipment(c, shipDate).status || 'logen_ready';
}

function logenDigits(value){
  return String(value || '').replace(/\D/g, '');
}

function logenComparableSnapshot(c){
  const prod = c?.productId || c?.set || '';
  const qty = Math.max(1, Number(c?.qty || c?.total || c?.quantity || 1) || 1);
  return {
    orderNum: String(c?.orderNum || c?.syncKey || c?.id || ''),
    receiverName: String(c?.name || c?.businessName || ''),
    receiverPhone: logenDigits(c?.phone || c?.contactPhone),
    receiverAddress: String(c?.addr || c?.address || c?.deliveryPlace || ''),
    itemName: typeof productLabel === 'function' ? productLabel(prod) : (prod || '궁중수라간 반찬'),
    itemOption: c?.orderType === 'sub' ? '정기배송' : '선택주문',
    quantity: qty,
    deliveryMessage: [
      c?.request || c?.requestNote || '',
      c?.door ? `현관 ${c.door}` : ''
    ].map(v => String(v || '').trim()).filter(Boolean).join(' / ')
  };
}

function logenSnapshotChanged(c, shipDate){
  const shipment = logenShipment(c, shipDate);
  const saved = shipment.snapshot || null;
  if(!saved) return false;
  const current = logenComparableSnapshot(c);
  return Object.keys(current).some(key => String(saved[key] ?? '') !== String(current[key] ?? ''));
}

function logenNeedsChange(c, shipDate){
  const shipment = logenShipment(c, shipDate);
  const status = logenStatus(c, shipDate);
  return LOGEN_SENT_STATUSES.includes(status) && (shipment.changeNeeded === true || logenSnapshotChanged(c, shipDate));
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
  const change = logenNeedsChange(c, shipDate)
    ? '<span class="badge" style="background:#fff1f2;color:#be123c;border-color:#fecdd3;font-weight:900;">변경필요</span>'
    : '';
  return `<span class="badge" style="${style}font-weight:800;">${label}</span>${change}`;
}

function logenSlipNoHtml(c, shipDate){
  const slipNo = logenShipment(c, shipDate).slipNo || logenShipment(c, shipDate).invoiceNo || '';
  return slipNo
    ? `<button class="btn btn-g sm" style="font-size:11px;padding:4px 8px;" onclick="copyLogenSlipNo('${c.id}','${shipDate}')">${slipNo}</button>`
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
  return !LOGEN_SENT_STATUSES.includes(status);
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

function logenActionHtml(c, shipDate){
  const status = logenStatus(c, shipDate);
  const needsChange = logenNeedsChange(c, shipDate);
  const slipNo = logenShipment(c, shipDate).slipNo || logenShipment(c, shipDate).invoiceNo || '';
  const parts = [];
  if(status === 'logen_failed' || status === 'logen_ready'){
    parts.push(`<button class="btn btn-p sm" onclick="sendSingleLogenOrder('${c.id}','${shipDate}')">로젠전송</button>`);
  }
  if(['logen_registered','slip_pending'].includes(status)){
    parts.push(`<button class="btn btn-g sm" onclick="inquireSingleLogenSlipNo('${c.id}','${shipDate}')">송장조회</button>`);
  }
  if(needsChange){
    parts.push(`<button class="btn btn-d sm" onclick="ackLogenChange('${c.id}','${shipDate}')">확인완료</button>`);
  }
  if(slipNo){
    parts.push(`<button class="btn btn-g sm" onclick="copyLogenSlipNo('${c.id}','${shipDate}')">복사</button>`);
  }
  return parts.length
    ? `<div style="display:flex;gap:4px;flex-wrap:wrap;justify-content:center;">${parts.join('')}</div>`
    : '';
}

function logenCourierSummaryHtml(list, shipDate){
  const sent = list.filter(c => LOGEN_SENT_STATUSES.includes(logenStatus(c, shipDate))).length;
  const failed = list.filter(c => logenStatus(c, shipDate) === 'logen_failed').length;
  const slips = list.filter(c => !!(logenShipment(c, shipDate).slipNo || logenShipment(c, shipDate).invoiceNo)).length;
  const changes = list.filter(c => logenNeedsChange(c, shipDate)).length;
  const changeBadge = changes
    ? `<span style="color:#be123c;font-weight:900;">변경필요 ${changes}건</span>`
    : '<span style="color:var(--ok);font-weight:800;">변경 없음</span>';
  return `로젠 전송 ${sent}건 · 송장 ${slips}건 · 실패 ${failed}건 · ${changeBadge}`;
}

function selectedLogenShipmentsForChange(current, next){
  const shipments = current?.logenShipments || {};
  const changed = [];
  const comparableKeys = ['name','phone','addr','door','request','orderNum','productId','set','qty','total','isDirect'];
  const hasImportantChange = comparableKeys.some(key => String(current?.[key] ?? '') !== String(next?.[key] ?? ''));
  if(!hasImportantChange) return {};
  Object.entries(shipments).forEach(([shipDate, shipment]) => {
    const status = shipment?.status || '';
    if(!LOGEN_SENT_STATUSES.includes(status)) return;
    changed.push(shipDate);
  });
  const update = {};
  changed.forEach(shipDate => {
    update[`logenShipments.${shipDate}.changeNeeded`] = true;
    update[`logenShipments.${shipDate}.changeReason`] = '고객 정보 수정';
    update[`logenShipments.${shipDate}.changedAt`] = new Date().toISOString();
  });
  return update;
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

async function sendSingleLogenOrder(customerId, shipDate){
  if(!customerId) return;
  if(!confirm('이 택배 주문을 로젠으로 전송할까요?')) return;
  try{
    const data = await postLogenApi('/api/logen/register-orders', { shipDate: shipDate || logenShipDate(), customerIds:[customerId], mode:'single' });
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

async function inquireSingleLogenSlipNo(customerId, shipDate){
  if(!customerId) return;
  try{
    const data = await postLogenApi('/api/logen/inquiry-slip-nos', { shipDate: shipDate || logenShipDate(), customerIds:[customerId], mode:'single' });
    toast(`송장번호 조회 완료: ${summarizeLogenResult(data)}`,'ok');
    renderToday();
  }catch(e){
    toast('송장번호 조회 실패: '+(e.message||e),'er');
  }
}

async function ackLogenChange(customerId, shipDate){
  const c = custs.find(x => x.id === customerId);
  if(!c) return;
  const shipment = logenShipment(c, shipDate);
  const msg = shipment.slipNo
    ? '송장번호가 이미 있습니다. iLOGEN 쪽 변경 확인까지 끝났나요?'
    : 'iLOGEN 쪽 변경 확인까지 끝났나요?';
  if(!confirm(msg)) return;
  try{
    await window.__DB.collection('customers').doc(customerId).update({
      [`logenShipments.${shipDate}.changeNeeded`]: false,
      [`logenShipments.${shipDate}.snapshot`]: logenComparableSnapshot(c),
      [`logenShipments.${shipDate}.changeResolvedAt`]: new Date().toISOString(),
      [`logenShipments.${shipDate}.changeResolvedBy`]: window.__AUTH?.currentUser?.email || ''
    });
    toast('로젠 변경 확인 처리됨','ok');
    renderToday();
  }catch(e){
    toast('변경 확인 처리 실패: '+(e.message||e),'er');
  }
}

function copyLogenSlipNo(customerId, shipDate){
  const c = custs.find(x => x.id === customerId);
  const slipNo = logenShipment(c, shipDate).slipNo || logenShipment(c, shipDate).invoiceNo || '';
  if(!slipNo){ toast('복사할 송장번호가 없습니다','er'); return; }
  navigator.clipboard.writeText(String(slipNo))
    .then(()=>toast('송장번호 복사됨','ok'))
    .catch(()=>toast('송장번호 복사 실패','er'));
}
