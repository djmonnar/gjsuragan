function digits(value) {
  return String(value || '').replace(/\D/g, '');
}

function productLabel(code) {
  return {
    A: 'A세트',
    B: 'B세트',
    C: 'C세트',
    pork_rib: '수제 돼지양념갈비',
    beef_la: '양념 LA갈비',
    beef_soup: '소고기무국'
  }[code] || code || '궁중수라간 반찬';
}

function orderQuantity(customer) {
  return Math.max(1, Number(customer.qty || customer.total || 1) || 1);
}

function orderNumber(customer) {
  return String(customer.orderNum || customer.syncKey || customer.id || '').trim();
}

function mapCustomerToLogenOrder(customer, shipDate) {
  const product = productLabel(customer.productId || customer.set || '');
  const qty = orderQuantity(customer);
  const request = [customer.request || '', customer.door ? `현관 ${customer.door}` : '']
    .filter(Boolean)
    .join(' / ');

  // 로젠 실제 필드명은 문서 확인 후 여기만 교체하면 된다.
  return {
    customerId: customer.id,
    shipDate,
    orderNum: orderNumber(customer),
    receiverName: customer.name || '',
    receiverPhone: digits(customer.phone),
    receiverPhoneRaw: customer.phone || '',
    receiverAddress: customer.addr || '',
    itemName: product,
    itemOption: customer.orderType === 'sub' ? '정기배송' : '선택주문',
    quantity: qty,
    deliveryMessage: request,
    raw: {
      name: customer.name || '',
      phone: customer.phone || '',
      addr: customer.addr || '',
      door: customer.door || '',
      request: customer.request || '',
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
