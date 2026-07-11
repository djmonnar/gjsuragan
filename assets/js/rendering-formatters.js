function escHtml(v){
  return String(v ?? '').replace(/[&<>"']/g, ch => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
  }[ch]));
}

function firstOrderBadgeHtml(){
  return '<span class="badge" title="이 고객의 첫 배송 전 주문" style="background:#ecfdf5;color:#047857;border-color:#86efac;font-weight:900;letter-spacing:.2px;">첫주문</span>';
}

function customerText(v){
  return escHtml(v ?? '');
}

function customerJsArg(v){
  return customerText(String(v ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r?\n/g, ' '));
}

function customerPhoneDigits(phone){
  return String(phone || '').replace(/\D/g, '');
}

function customerTimestampMs(value){
  if(!value) return 0;
  if(value instanceof Date){
    const t = value.getTime();
    return Number.isNaN(t) ? 0 : t;
  }
  if(typeof value?.toDate === 'function'){
    const t = value.toDate().getTime();
    return Number.isNaN(t) ? 0 : t;
  }
  if(typeof value?.seconds === 'number'){
    return (value.seconds * 1000) + Math.floor((value.nanoseconds || 0) / 1000000);
  }
  const t = new Date(value).getTime();
  return Number.isNaN(t) ? 0 : t;
}

function customerNewBadgeHtml(){
  return '<span class="badge" title="최근 24시간 이내 신규 주문" style="background:#fff3bf;color:#9a6700;border-color:#d9a441;font-weight:900;letter-spacing:.2px;">NEW</span>';
}

function customerProductKey(c){
  return c ? (c.productId || c.set || '') : '';
}

function customerOrderTypeLabel(c){
  if(c?.orderType === 'sub') return '정기';
  return ['pork_rib','beef_la','beef_soup'].includes(customerProductKey(c)) ? '단품' : '선택';
}

function customerOrderTypeBadge(c){
  return c?.orderType === 'sub' ? 'b-sub' : 'b-once';
}
