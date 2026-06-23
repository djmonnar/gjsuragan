const { logger } = require('firebase-functions');

function config() {
  return {
    baseUrl: (process.env.LOGEN_API_BASE_URL || '').replace(/\/+$/, ''),
    apiKey: process.env.LOGEN_API_KEY || '',
    secretKey: process.env.LOGEN_SECRET_KEY || '',
    dryRun: String(process.env.LOGEN_DRY_RUN || '').toLowerCase() === 'true'
  };
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

async function postJson(path, payload) {
  const cfg = config();
  if (cfg.dryRun) {
    return { ok: true, results: dryRunResults(payload.orders || [], path.includes('inquiry') ? 'inquiry' : 'register') };
  }
  if (!cfg.baseUrl) {
    throw new Error('LOGEN_API_BASE_URL is not configured');
  }

  const res = await fetch(`${cfg.baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(cfg.apiKey ? { 'X-Logen-Api-Key': cfg.apiKey } : {}),
      ...(cfg.secretKey ? { 'X-Logen-Secret-Key': cfg.secretKey } : {})
    },
    body: JSON.stringify(payload)
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch (error) {
    data = { ok: false, error: text };
  }
  if (!res.ok || data.ok === false) {
    logger.warn('Logen API call failed', { path, status: res.status, body: text.slice(0, 500) });
    throw new Error(data.error || data.message || `Logen HTTP ${res.status}`);
  }
  return data;
}

function normalizeResults(orders, response) {
  const list = Array.isArray(response?.results)
    ? response.results
    : Array.isArray(response?.data)
      ? response.data
      : [];
  const byCustomer = new Map(list.map(row => [String(row.customerId || ''), row]));
  const byOrder = new Map(list.map(row => [String(row.orderNum || row.ordNo || ''), row]));
  return orders.map(order => {
    const row = byCustomer.get(String(order.customerId)) || byOrder.get(String(order.orderNum)) || {};
    const ok = row.ok !== false && row.success !== false && !row.error;
    return {
      customerId: order.customerId,
      orderNum: order.orderNum,
      ok,
      slipNo: row.slipNo || row.invoiceNo || row.waybillNo || '',
      receiptNo: row.receiptNo || row.registerNo || row.logenReceiptNo || '',
      raw: row,
      message: row.message || row.error || ''
    };
  });
}

async function registerOrders(orders, context = {}) {
  const response = await postJson('/register-orders', { ...context, orders });
  return normalizeResults(orders, response);
}

async function inquirySlipNos(orders, context = {}) {
  const response = await postJson('/inquiry-slip-nos', { ...context, orders });
  return normalizeResults(orders, response);
}

module.exports = {
  registerOrders,
  inquirySlipNos
};
