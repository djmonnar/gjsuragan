const { logger } = require('firebase-functions');

const LOGEN_ENDPOINTS = {
  test: 'https://topenapi.ilogen.com/lrm02b-edi/edi',
  prod: 'https://openapi.ilogen.com/lrm02b-edi/edi'
};

function envText(name, fallback = '') {
  return String(process.env[name] || fallback).trim();
}

function config() {
  const env = envText('LOGEN_ENV', 'test').toLowerCase();
  return {
    env,
    baseUrl: envText('LOGEN_API_BASE_URL', LOGEN_ENDPOINTS[env] || LOGEN_ENDPOINTS.test).replace(/\/+$/, ''),
    secretKey: envText('LOGEN_SECRET_KEY'),
    userId: envText('LOGEN_USER_ID', '58020072'),
    custCd: envText('LOGEN_CUST_CD', '58020072'),
    senderName: envText('LOGEN_SENDER_NAME', '궁중수라간'),
    senderPhone: envText('LOGEN_SENDER_PHONE', '01035071278').replace(/\D/g, ''),
    senderCellPhone: envText('LOGEN_SENDER_CELL_PHONE').replace(/\D/g, ''),
    senderAddress: envText('LOGEN_SENDER_ADDRESS', '경상남도 진주시 동진로107번길 8 2층'),
    fareTy: envText('LOGEN_FARE_TY', '030'),
    boxTyCd: envText('LOGEN_BOX_TY_CD'),
    dlvFare: Number(envText('LOGEN_DLV_FARE', '0')) || 0,
    dryRun: envText('LOGEN_DRY_RUN').toLowerCase() === 'true'
  };
}

function required(value, label) {
  const text = String(value || '').trim();
  if (!text) throw new Error(`${label} is required`);
  return text;
}

function ymd(value) {
  return String(value || '').replace(/\D/g, '').slice(0, 8);
}

function dryRunResults(orders, action) {
  return orders.map(order => ({
    customerId: order.customerId,
    orderNum: order.orderNum,
    ok: true,
    status: action === 'inquiry' ? 'slip_ready' : 'logen_registered',
    slipNo: action === 'inquiry' ? `TEST${String(order.orderNum || order.customerId || '').slice(-10)}` : '',
    message: 'LOGEN_DRY_RUN'
  }));
}

async function postLogen(path, payload) {
  const cfg = config();
  if (cfg.dryRun) {
    const action = path.includes('inquirySlipNoMulti') ? 'inquiry' : 'register';
    return {
      ok: true,
      sttsCd: 'SUCCESS',
      data: dryRunResults(payload.__orders || [], action)
    };
  }
  required(cfg.baseUrl, 'LOGEN_API_BASE_URL');
  required(cfg.secretKey, 'LOGEN_SECRET_KEY');

  const body = { ...payload };
  delete body.__orders;
  const res = await fetch(`${cfg.baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      secretKey: cfg.secretKey
    },
    body: JSON.stringify(body)
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch (error) {
    data = { error: text };
  }
  if (!res.ok) {
    logger.warn('Logen API HTTP failed', { path, status: res.status, body: text.slice(0, 800) });
    throw new Error(data.error || data.message || `Logen HTTP ${res.status}`);
  }
  return data;
}

function registerRow(order, cfg, context = {}) {
  const takeDt = ymd(context.takeDt || context.shipDate || order.shipDate) || ymd(new Date().toISOString());
  const qty = Math.max(1, Number(order.quantity || order.qty || 1) || 1);
  const row = {
    custCd: cfg.custCd,
    takeDt,
    fixTakeNo: required(order.orderNum || order.fixTakeNo, 'fixTakeNo'),
    sndCustNm: cfg.senderName,
    sndCustAddr: cfg.senderAddress,
    sndTelNo: cfg.senderPhone,
    sndCellNo: cfg.senderCellPhone || cfg.senderPhone,
    rcvCustNm: required(order.receiverName, 'rcvCustNm'),
    rcvCustAddr: required(order.receiverAddress, 'rcvCustAddr'),
    rcvTelNo: required(order.receiverPhone, 'rcvTelNo'),
    rcvCellNo: order.receiverCellPhone || order.receiverPhone || '',
    fareTy: cfg.fareTy,
    qty,
    dlvFare: Number(order.dlvFare || cfg.dlvFare || 0),
    extraFare: Number(order.extraFare || 0),
    goodsNm: order.itemName || '궁중수라간 반찬',
    goodsAmt: Number(order.goodsAmt || 0),
    inQty: Number(order.inQty || qty || 1),
    goodsOpt: order.itemOption || '',
    sndMsg: order.deliveryMessage || ''
  };
  if (!row.dlvFare) {
    throw new Error('LOGEN_DLV_FARE is required before registering Logen orders');
  }
  if (cfg.boxTyCd) row.boxTyCd = cfg.boxTyCd;
  return row;
}

function resultRows(response) {
  if (Array.isArray(response?.data)) return response.data;
  if (Array.isArray(response?.results)) return response.results;
  return [];
}

function normalizeRegisterResults(orders, response) {
  const rows = resultRows(response);
  const byOrder = new Map(rows.map(row => [String(row.fixTakeNo || row.orderNum || ''), row]));
  return orders.map(order => {
    const row = byOrder.get(String(order.orderNum || order.fixTakeNo || '')) || {};
    const resultCd = String(row.resultCd || '').toUpperCase();
    const ok = row.ok === true || row.success === true || resultCd === 'TRUE' || resultCd === 'SUCCESS';
    return {
      customerId: order.customerId,
      orderNum: order.orderNum,
      ok,
      slipNo: row.slipNo || '',
      receiptNo: row.receiptNo || '',
      raw: row,
      message: row.resultMsg || row.sttsMsg || row.message || row.error || ''
    };
  });
}

function normalizeInquiryResults(orders, response) {
  const rows = resultRows(response);
  const byOrder = new Map(rows.map(row => [String(row.fixTakeNo || row.orderNum || ''), row]));
  return orders.map(order => {
    const row = byOrder.get(String(order.orderNum || order.fixTakeNo || '')) || {};
    const resultCd = String(row.resultCd || '').toUpperCase();
    const ok = row.ok === true || row.success === true || resultCd === 'TRUE' || resultCd === 'SUCCESS';
    const slipRows = Array.isArray(row.data1) ? row.data1 : [];
    const slipNo = row.slipNo || row.invoiceNo || row.waybillNo || slipRows.find(item => item?.slipNo)?.slipNo || '';
    return {
      customerId: order.customerId,
      orderNum: order.orderNum,
      ok,
      slipNo,
      receiptNo: row.receiptNo || '',
      raw: row,
      message: row.resultMsg || row.sttsMsg || row.message || row.error || ''
    };
  });
}

async function registerOrders(orders, context = {}) {
  const cfg = config();
  if (cfg.dryRun) return dryRunResults(orders, 'register');
  const payload = {
    userId: cfg.userId,
    data: orders.map(order => registerRow(order, cfg, context)),
    __orders: orders
  };
  const response = await postLogen('/registerOrderData', payload);
  return normalizeRegisterResults(orders, response);
}

async function inquirySlipNos(orders) {
  const cfg = config();
  if (cfg.dryRun) return dryRunResults(orders, 'inquiry');
  const payload = {
    userId: cfg.userId,
    data: orders.map(order => ({
      custCd: cfg.custCd,
      fixTakeNo: required(order.orderNum || order.fixTakeNo, 'fixTakeNo')
    })),
    __orders: orders
  };
  const response = await postLogen('/inquirySlipNoMulti', payload);
  return normalizeInquiryResults(orders, response);
}

module.exports = {
  registerOrders,
  inquirySlipNos
};
