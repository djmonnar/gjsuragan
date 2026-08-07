function digits(value) {
  return String(value || '').replace(/\D/g, '');
}

function compactAddress(customer) {
  return [
    customer.addr || customer.address || customer.deliveryPlace || '',
    customer.addrDetail || customer.addressDetail || customer.deliveryPlaceDetail || ''
  ]
    .map(value => String(value || '').trim())
    .filter(Boolean)
    .join(' ');
}

function productLabel(code) {
  return {
    A: 'A세트',
    B: 'B세트',
    C: 'C세트',
    pork_rib: '수제 양념돼지갈비',
    beef_la: '양념 LA갈비',
    beef_soup: '소고기무국'
  }[code] || code || '궁중수라간 반찬';
}

// 로젠 qty는 이번 회차에 보낼 '박스 수'다.
// total(총 구독 횟수)을 여기에 쓰면 정기배송 12회 고객이 12박스로 접수되므로 절대 참조하지 않는다.
function orderQuantity(customer) {
  const explicit = Number(customer.qty ?? customer.quantity);
  if (Number.isFinite(explicit) && explicit >= 1) return Math.floor(explicit);
  return 1;
}

function orderNumber(customer) {
  return String(customer.orderNum || customer.syncKey || customer.id || '').trim();
}

function deliveryMessage(customer) {
  return [
    customer.request || customer.requestNote || '',
    customer.door ? `현관 ${customer.door}` : ''
  ]
    .map(value => String(value || '').trim())
    .filter(Boolean)
    .join(' / ');
}

function mapCustomerToLogenOrder(customer, shipDate) {
  const product = productLabel(customer.productId || customer.set || '');
  const qty = orderQuantity(customer);

  return {
    customerId: customer.id,
    shipDate,
    orderNum: orderNumber(customer),
    receiverName: customer.name || customer.businessName || '',
    receiverPhone: digits(customer.phone || customer.contactPhone),
    receiverPhoneRaw: customer.phone || customer.contactPhone || '',
    receiverAddress: compactAddress(customer),
    itemName: product,
    itemOption: customer.orderType === 'sub' ? '정기배송' : '선택주문',
    quantity: qty,
    deliveryMessage: deliveryMessage(customer),
    raw: {
      name: customer.name || customer.businessName || '',
      phone: customer.phone || customer.contactPhone || '',
      addr: compactAddress(customer),
      door: customer.door || '',
      request: customer.request || customer.requestNote || '',
      set: customer.set || '',
      productId: customer.productId || '',
      orderType: customer.orderType || '',
      qty
    }
  };
}

module.exports = {
  mapCustomerToLogenOrder,
  orderNumber
};
