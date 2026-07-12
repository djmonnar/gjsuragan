// ════════════════════════════════════════
// 주문 금액 정규화 · 월별 매출 정산
// ════════════════════════════════════════
const ORDER_SOURCE_LABELS = {
  imweb_auto:'아임웹 자동',
  imweb_api:'아임웹 API',
  imweb_excel:'아임웹 엑셀',
  imweb_text:'아임웹 붙여넣기',
  manual:'전화·카톡',
  excel_import:'엑셀',
  unknown:'기타',
};

function normalizeOrderAmount(value){
  if(value === null || value === undefined || value === '') return null;
  if(typeof value === 'number') return Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
  const cleaned = String(value).replace(/[₩원,\s]/g, '').trim();
  if(!/^\d+(?:\.\d+)?$/.test(cleaned)) return null;
  const amount = Number(cleaned);
  return Number.isFinite(amount) && amount >= 0 ? Math.round(amount) : null;
}

function imwebOrderAmount(order){
  const candidates = [
    order?.payment?.payment_amount,
    order?.payment?.pay_price,
    order?.payment?.total_price,
    order?.payment?.total_amount,
    order?.payment?.amount,
    order?.payment?.price,
    order?.order_info?.payment?.payment_amount,
    order?.order_info?.payment?.pay_price,
    order?.order_info?.payment?.total_price,
    order?.payment_amount,
    order?.pay_price,
    order?.total_price,
    order?.total_amount,
    order?.order_price,
  ];
  for(const candidate of candidates){
    const amount = normalizeOrderAmount(candidate);
    if(amount !== null) return amount;
  }
  return null;
}

function orderAmountValue(order){
  return normalizeOrderAmount(order?.orderAmount);
}

function orderSalesDateValue(order){
  if(typeof customerOrderDateInputValue === 'function') return customerOrderDateInputValue(order);
  const values = [order?.orderDate, order?.orderNum, order?.syncKey, order?.createdAt, order?.updatedAt, order?.onceDate, order?.startDate];
  for(const value of values){
    const raw = String(value || '').trim();
    let match = raw.match(/^(\d{4})(\d{2})(\d{2})/);
    if(match) return `${match[1]}-${match[2]}-${match[3]}`;
    match = raw.match(/^(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
    if(match) return `${match[1]}-${String(match[2]).padStart(2,'0')}-${String(match[3]).padStart(2,'0')}`;
  }
  return '';
}

function orderSalesRootNumber(value){
  return String(value || '').trim().replace(/-D\d+$/i, '').replace(/-\d{3}$/,'');
}

function orderSalesGroupKey(order){
  const orderNo = orderSalesRootNumber(order?.orderNum);
  if(orderNo) return `order:${orderNo}`;
  const syncKey = String(order?.syncKey || '').trim().replace(/-\d+$/,'');
  if(syncKey) return `sync:${syncKey}`;
  return `doc:${order?.id || [order?.name, order?.phone, orderSalesDateValue(order)].join('|')}`;
}

function orderSalesSource(order){
  const explicit = String(order?.orderSource || '').trim();
  if(ORDER_SOURCE_LABELS[explicit]) return explicit;
  const memo = String(order?.memo || '');
  if(/아임웹\s*자동등록/i.test(memo)) return 'imweb_auto';
  if(/아임웹/i.test(memo)) return 'imweb_text';
  if(/엑셀/i.test(memo)) return 'excel_import';
  if(/전화|카톡|수동|텍스트\s*파싱/i.test(memo)) return 'manual';
  return 'unknown';
}

function orderSalesSourceGroup(source){
  if(String(source).startsWith('imweb_')) return 'imweb';
  if(source === 'manual') return 'manual';
  if(source === 'excel_import') return 'excel';
  return 'other';
}

function buildOrderSalesRows(customers, month){
  const groups = new Map();
  (customers || []).forEach(order => {
    const date = orderSalesDateValue(order);
    if(!date || (month && !date.startsWith(month + '-'))) return;
    const key = orderSalesGroupKey(order);
    if(!groups.has(key)) groups.set(key, []);
    groups.get(key).push(order);
  });

  return [...groups.entries()].map(([key, items]) => {
    const amounts = items.map(orderAmountValue).filter(value => value !== null);
    const uniqueAmounts = [...new Set(amounts)];
    const amountConflict = uniqueAmounts.length > 1;
    const representative = items.find(item => orderAmountValue(item) !== null) || items[0];
    const products = [...new Set(items.map(item => {
      const product = item?.productId || item?.set || '';
      return typeof productLabel === 'function' ? productLabel(product) : product;
    }).filter(Boolean))];
    const source = orderSalesSource(representative);
    return {
      key,
      items,
      representative,
      date:orderSalesDateValue(representative),
      orderNum:orderSalesRootNumber(representative?.orderNum),
      name:representative?.name || '',
      products,
      source,
      sourceGroup:orderSalesSourceGroup(source),
      amount:amountConflict || uniqueAmounts.length === 0 ? null : uniqueAmounts[0],
      amountConflict,
    };
  }).sort((a,b) => b.date.localeCompare(a.date) || a.name.localeCompare(b.name,'ko'));
}

function summarizeOrderSales(rows){
  const summary = {
    orders:rows.length,
    knownOrders:0,
    missingOrders:0,
    sales:0,
    imwebSales:0,
    manualSales:0,
    excelSales:0,
    otherSales:0,
  };
  rows.forEach(row => {
    if(row.amount === null){
      summary.missingOrders++;
      return;
    }
    summary.knownOrders++;
    summary.sales += row.amount;
    const key = `${row.sourceGroup}Sales`;
    if(Object.prototype.hasOwnProperty.call(summary,key)) summary[key] += row.amount;
  });
  return summary;
}

function orderSalesWon(value){
  return `${Number(value || 0).toLocaleString('ko-KR')}원`;
}

function orderSalesSourceLabel(source){
  return ORDER_SOURCE_LABELS[source] || ORDER_SOURCE_LABELS.unknown;
}

function resetOrderSettlementMonth(){
  const input = document.getElementById('salesMonth');
  if(input) input.value = todayStr().slice(0,7);
  renderOrderSettlement();
}

function resetOrderSettlementFilters(){
  ['salesSource','salesAmountState','salesSort'].forEach(id => {
    const el = document.getElementById(id);
    if(el) el.value = id === 'salesSort' ? 'date' : '';
  });
  const query = document.getElementById('salesQuery');
  if(query) query.value = '';
  renderOrderSettlement();
}

function renderOrderSettlement(){
  const body = document.getElementById('salesList');
  const summaryWrap = document.getElementById('salesSummary');
  if(!body || !summaryWrap) return;

  const monthInput = document.getElementById('salesMonth');
  if(monthInput && !monthInput.value) monthInput.value = todayStr().slice(0,7);
  const month = monthInput?.value || todayStr().slice(0,7);
  const allRows = buildOrderSalesRows(typeof custs !== 'undefined' ? custs : [], month);
  const summary = summarizeOrderSales(allRows);
  const sourceFilter = document.getElementById('salesSource')?.value || '';
  const amountFilter = document.getElementById('salesAmountState')?.value || '';
  const sort = document.getElementById('salesSort')?.value || 'date';
  const query = String(document.getElementById('salesQuery')?.value || '').trim().toLowerCase();

  summaryWrap.innerHTML = `
    <div class="sum-card sales-total-card"><div class="sum-label">확인된 총 매출</div><div class="sum-val">${orderSalesWon(summary.sales)}</div><div class="sum-sub">금액 입력 ${summary.knownOrders}건 기준</div></div>
    <div class="sum-card"><div class="sum-label">전체 주문</div><div class="sum-val">${summary.orders}건</div><div class="sum-sub">주문번호 중복 제외</div></div>
    <div class="sum-card sales-missing-card"><div class="sum-label">금액 확인 필요</div><div class="sum-val">${summary.missingOrders}건</div><div class="sum-sub">총매출에서 제외됨</div></div>
    <div class="sum-card"><div class="sum-label">아임웹 매출</div><div class="sum-val">${orderSalesWon(summary.imwebSales)}</div><div class="sum-sub">자동·API·엑셀·붙여넣기</div></div>
    <div class="sum-card"><div class="sum-label">전화·카톡 매출</div><div class="sum-val">${orderSalesWon(summary.manualSales)}</div><div class="sum-sub">수동 등록 주문</div></div>`;

  let rows = allRows.filter(row => {
    if(sourceFilter && row.sourceGroup !== sourceFilter) return false;
    if(amountFilter === 'known' && row.amount === null) return false;
    if(amountFilter === 'missing' && row.amount !== null) return false;
    if(!query) return true;
    return [row.name,row.orderNum,row.products.join(' '),orderSalesSourceLabel(row.source)]
      .join(' ').toLowerCase().includes(query);
  });

  if(sort === 'amount') rows.sort((a,b) => (b.amount ?? -1) - (a.amount ?? -1) || b.date.localeCompare(a.date));
  if(sort === 'name') rows.sort((a,b) => a.name.localeCompare(b.name,'ko') || b.date.localeCompare(a.date));

  const count = document.getElementById('salesCount');
  if(count) count.textContent = `${rows.length}건 / 전체 ${summary.orders}건`;
  if(!rows.length){
    body.innerHTML = '<tr><td colspan="8"><div class="empty"><div class="empty-mark">₩</div><div>조건에 맞는 주문이 없습니다</div></div></td></tr>';
    return;
  }

  body.innerHTML = rows.map(row => {
    const c = row.representative;
    const amountHtml = row.amount === null
      ? `<span class="badge sales-amount-missing" title="${row.amountConflict ? '같은 주문번호에 서로 다른 금액이 있습니다' : '주문 금액이 입력되지 않았습니다'}">${row.amountConflict ? '금액 상이' : '미입력'}</span>`
      : `<strong class="sales-amount">${orderSalesWon(row.amount)}</strong>`;
    return `<tr>
      <td>${escHtml(row.date)}</td>
      <td><span class="badge sales-source sales-source-${row.sourceGroup}">${escHtml(orderSalesSourceLabel(row.source))}</span></td>
      <td><strong>${escHtml(row.name || '-')}</strong>${row.items.length > 1 ? `<div class="sales-row-sub">상품 문서 ${row.items.length}개 묶음</div>` : ''}</td>
      <td>${escHtml(row.products.join(', ') || '-')}</td>
      <td class="sales-order-no">${escHtml(row.orderNum || '-')}</td>
      <td>${escHtml(typeof statusLabel === 'function' ? statusLabel(c) : (c?.status || '-'))}</td>
      <td>${amountHtml}</td>
      <td><button class="btn btn-g sm" onclick="openEdit('${customerJsArg(c.id)}')">수정</button></td>
    </tr>`;
  }).join('');
}
