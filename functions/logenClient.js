const { logger } = require('firebase-functions');

const LOGEN_ENDPOINTS = {
  test: 'https://topenapi.ilogen.com/lrm02b-edi/edi',
  prod: 'https://openapi.ilogen.com/lrm02b-edi/edi'
};

function envText(name, fallback = '') {
  return String(process.env[name] || fallback).trim();
}

// 배포 과정에서 한글 환경변수가 CP949로 잘못 읽히면 '궁중수라간'이 '沅곸쨷...'처럼 깨진다.
// 깨진 값이 그대로 송장에 찍히지 않도록, 한자가 섞여 있으면 코드 기본값을 쓴다.
function looksMojibake(text) {
  return /[一-鿿]/.test(String(text || ''));
}

function koreanEnvText(name, fallback) {
  const value = envText(name, '');
  if (!value || looksMojibake(value)) {
    if (value) {
      logger.warn('Logen sender field looks corrupted; using built-in default', { name });
    }
    return fallback;
  }
  return value;
}

function config() {
  const env = envText('LOGEN_ENV', 'test').toLowerCase();
  return {
    env,
    baseUrl: envText('LOGEN_API_BASE_URL', LOGEN_ENDPOINTS[env] || LOGEN_ENDPOINTS.test).replace(/\/+$/, ''),
    secretKey: envText('LOGEN_SECRET_KEY'),
    userId: envText('LOGEN_USER_ID', '58020072'),
    custCd: envText('LOGEN_CUST_CD', '58020072'),
    senderName: koreanEnvText('LOGEN_SENDER_NAME', '궁중수라간'),
    senderPhone: envText('LOGEN_SENDER_PHONE', '01035071278').replace(/\D/g, ''),
    senderCellPhone: envText('LOGEN_SENDER_CELL_PHONE').replace(/\D/g, ''),
    senderAddress: koreanEnvText('LOGEN_SENDER_ADDRESS', '경상남도 진주시 동진로107번길 8 2층'),
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
  // 로젠에 문의할 때 '무엇을 보냈는지' 근거가 필요하므로 라우팅 관련 필드만 남긴다.
  // 수령인 이름·주소·연락처는 개인정보라 기록하지 않는다.
  logger.info('Logen API request', {
    path,
    env: cfg.env,
    url: `${cfg.baseUrl}${path}`,
    userId: body.userId,
    rows: (Array.isArray(body.data) ? body.data : []).slice(0, 10).map(row => ({
      custCd: row?.custCd,
      takeDt: row?.takeDt,
      fixTakeNo: row?.fixTakeNo,
      slipNo: row?.slipNo,
      qty: row?.qty,
      inQty: row?.inQty,
      fareTy: row?.fareTy,
      dlvFare: row?.dlvFare,
      boxTyCd: row?.boxTyCd,
      goodsNm: row?.goodsNm
    }))
  });
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
  // HTTP 200이어도 로젠이 업무 레벨 사유(송장 미발번 등)를 돌려주는 경우가 있어
  // 응답 요약을 남긴다. 송장번호가 안 나올 때 원인을 추적하려면 이 로그가 필요하다.
  logger.info('Logen API response', {
    path,
    env: cfg.env,
    sttsCd: data?.sttsCd || '',
    sttsMsg: String(data?.sttsMsg || '').slice(0, 200),
    rows: (Array.isArray(data?.data) ? data.data : []).slice(0, 10).map(row => ({
      fixTakeNo: row?.fixTakeNo || '',
      resultCd: row?.resultCd || '',
      resultMsg: String(row?.resultMsg || '').slice(0, 120),
      slipNo: row?.slipNo || '',
      slipRows: Array.isArray(row?.data1) ? row.data1.length : 0,
      // data1 안에서 운송장번호를 못 찾는 경우가 있어 실제 키·값을 남긴다
      slipSample: (Array.isArray(row?.data1) ? row.data1 : []).slice(0, 3)
        .map(item => JSON.stringify(item).slice(0, 200))
    }))
  });
  return data;
}

function registerRow(order, cfg, context = {}) {
  const takeDt = ymd(context.takeDt || context.shipDate || order.shipDate) || ymd(new Date().toISOString());
  const qty = Math.max(1, Number(order.quantity || order.qty || 1) || 1);
  // 필드명·타입은 로젠 bulk-order 명세표를 따른다.
  // 이 데이터는 로젠 "주문등록출력(복수건)" 화면에 쌓이며, 송장 출력은 로젠 쪽에서 한다.
  const row = {
    custCd: cfg.custCd,
    takeDt,
    slipNo: String(order.slipNo || ''),      // 빈 값 = 로젠이 운송장번호 발번
    fixTakeNo: required(order.orderNum || order.fixTakeNo, 'fixTakeNo'),
    sndCustNm: cfg.senderName,
    sndZipCd: String(order.senderZipCode || ''),
    sndCustAddr: cfg.senderAddress,
    sndTelNo: cfg.senderPhone,
    sndCellNo: cfg.senderCellPhone || cfg.senderPhone,
    rcvCustNm: required(order.receiverName, 'rcvCustNm'),
    rcvZipCd: String(order.receiverZipCode || ''),
    rcvCustAddr: required(order.receiverAddress, 'rcvCustAddr'),
    rcvTelNo: required(order.receiverPhone, 'rcvTelNo'),
    rcvCellNo: order.receiverCellPhone || order.receiverPhone || '',
    fareTy: cfg.fareTy,
    boxTyCd: cfg.boxTyCd || null,
    qty,
    // dlvFare는 박스 1개 운임이 아니라 '이번 접수 건의 총 운임'이다.
    // 명세 예시도 qty 2 → dlvFare 6000(=2×3000). 박스당 계약운임 미만이면
    // 로젠이 "택배운임이 계약운임보다 낮아 등록 불가"로 반려한다.
    dlvFare: Number(order.dlvFare || (cfg.dlvFare || 0) * qty),
    extraFare: Number(order.extraFare || 0),
    goodsNm: order.itemName || '궁중수라간 반찬',
    // 명세표 기준: goodsAmt·inQty는 Integer, 필드명은 inQty(대문자 Q).
    // 문서의 JSON 샘플에는 "inqty"(소문자)·문자열로 적혀 있으나 명세표를 따른다.
    goodsAmt: Number(order.goodsAmt || 0),
    inQty: Number(order.inQty || qty || 1),
    goodsOpt: order.itemOption || null,
    addOpt: '',
    sndMsg: order.deliveryMessage || '',
    mrgInQty: '',
    mrgItemCd: '',
    mrgItemNm: '',
    mrgItemOpt: '',
    mrgGoodsAmt: '',
    mrgAddOpt: '',
    mrgYn: ''
  };
  if (!row.dlvFare) {
    throw new Error('LOGEN_DLV_FARE is required before registering Logen orders');
  }
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
    // data1에는 운송장이 여러 장 올 수 있고 delYn='Y'는 취소된 송장이므로 제외한다.
    const slipRows = (Array.isArray(row.data1) ? row.data1 : [])
      .filter(item => item && item.slipNo && String(item.delYn || '').toUpperCase() !== 'Y');
    const slipNo = row.slipNo || row.invoiceNo || row.waybillNo || slipRows[0]?.slipNo || '';
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

async function contractFares() {
  const cfg = config();
  const response = await postLogen('/contPickFares', {
    userId: cfg.userId,
    data: [{
      custCd: cfg.custCd,
      fareTy: cfg.fareTy
    }]
  });
  const rows = resultRows(response);
  const fareRows = rows.flatMap(row => Array.isArray(row.data1) ? row.data1 : []);
  return {
    ok: String(response?.sttsCd || '').toUpperCase() === 'SUCCESS' || fareRows.length > 0,
    env: cfg.env,
    baseUrl: cfg.baseUrl,
    sttsCd: response?.sttsCd || '',
    sttsMsg: response?.sttsMsg || '',
    resultCd: rows[0]?.resultCd || '',
    resultMsg: rows[0]?.resultMsg || '',
    fareTy: cfg.fareTy,
    fareCount: fareRows.length,
    fares: fareRows.slice(0, 10).map(row => ({
      boxTyCd: row.boxTyCd || '',
      boxTyNm: row.boxTyNm || '',
      dlvFare: row.dlvFare || 0
    }))
  };
}

module.exports = {
  registerOrders,
  inquirySlipNos,
  contractFares
};
