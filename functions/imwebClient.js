// 아임웹 v2 API 호출만 담당한다. 파싱은 imwebParser.js, 저장은 imwebSync.js 가 맡는다.

const BASE_URL = 'https://api.imweb.me/v2';
const PAGE_LIMIT = 100;
const MAX_PAGES = 20;

function config(env = process.env) {
  return {
    apiKey: String(env.IMWEB_API_KEY || '').trim(),
    secretKey: String(env.IMWEB_SECRET_KEY || '').trim()
  };
}

async function readJson(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    // 아임웹이 장애 페이지(HTML)를 돌려줄 때가 있다. 본문 전체를 로그에 남기지 않는다.
    throw new Error(`아임웹 응답을 해석할 수 없습니다 (HTTP ${response.status})`);
  }
}

async function getToken(env = process.env) {
  const { apiKey, secretKey } = config(env);
  if (!apiKey || !secretKey) throw new Error('IMWEB_API_KEY / IMWEB_SECRET_KEY 가 설정되지 않았습니다.');
  const response = await fetch(`${BASE_URL}/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: apiKey, secret: secretKey })
  });
  const json = await readJson(response);
  if (json.code !== 200) throw new Error(`아임웹 토큰 발급 실패: ${json.msg || json.code}`);
  return json.access_token || json.data?.access_token || '';
}

async function fetchOrderPage(token, status, page) {
  const params = new URLSearchParams({ limit: String(PAGE_LIMIT), page: String(page) });
  if (status) params.set('status', status);
  const response = await fetch(`${BASE_URL}/shop/orders?${params}`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json', 'access-token': token }
  });
  return readJson(response);
}

// 같은 주문이 상태별 조회에 중복으로 나오므로 주문번호로 한 번만 담는다.
// 어디서 왜 멈췄는지 한 줄로 남긴다. 목록이 잘려서 뒤쪽 주문이 통째로 안 보이는 일을
// 숫자만 보고는 알 수가 없기 때문이다.
async function appendOrders(token, status, all, seen, log) {
  const label = status ? `상태 '${status}'` : '전체';
  let lastFirstOrderNo = '';
  let added = 0;
  let pages = 0;
  let stopReason = '';

  for (let page = 1; page <= MAX_PAGES; page++) {
    pages = page;
    const json = await fetchOrderPage(token, status, page);
    if (json.code !== 200) {
      log(`주문 조회 오류${status ? ` (${status})` : ''}: ${json.msg || json.code}`);
      stopReason = '오류로 중단';
      break;
    }
    const list = json.data?.list || [];
    if (!list.length) { stopReason = '빈 페이지'; break; }

    // 아임웹이 마지막 페이지 이후로도 같은 목록을 계속 돌려주는 경우가 있어 끊는다.
    const firstOrderNo = String(list[0]?.order_no || '');
    if (page > 1 && firstOrderNo && firstOrderNo === lastFirstOrderNo) {
      stopReason = '앞 페이지와 같은 목록이 와서 중단';
      break;
    }
    lastFirstOrderNo = firstOrderNo;

    for (const order of list) {
      const key = String(order.order_no || '');
      if (key && !seen.has(key)) {
        seen.add(key);
        all.push(order);
        added++;
      }
    }

    if (list.length < PAGE_LIMIT) { stopReason = `마지막 페이지(${list.length}건)`; break; }
    if (page === MAX_PAGES) stopReason = `최대 ${MAX_PAGES}페이지까지만 읽음 — 뒤에 더 있을 수 있다`;
  }

  log(`아임웹 조회 ${label}: ${pages}페이지 / 새로 담은 ${added}건 / ${stopReason}`);
}

async function getOrders(token, holdStatuses = [], log = () => {}) {
  const all = [];
  const seen = new Set();
  await appendOrders(token, '', all, seen, log);
  for (const status of holdStatuses) {
    await appendOrders(token, status, all, seen, log);
  }
  return all;
}

async function getProdOrders(token, orderNo) {
  const response = await fetch(`${BASE_URL}/shop/orders/${encodeURIComponent(orderNo)}/prod-orders`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json', 'access-token': token }
  });
  const json = await readJson(response);
  if (json.code !== 200) return [];
  return json.data || [];
}

function itemsFromProdOrders(prodOrders) {
  const items = [];
  for (const prodOrder of prodOrders || []) {
    for (const item of prodOrder?.items || []) items.push(item);
  }
  return items;
}

module.exports = {
  config,
  getOrders,
  getProdOrders,
  getToken,
  itemsFromProdOrders
};
