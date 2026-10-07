'use strict';

const M = require('./monthlyDeliveryModel');

const SOURCE_ID = '1XlFWqDD_6N-S8Dvr-4gdh_usx9kOgSzXbAnhKx2rGu4';
const SOURCE_URL = `https://docs.google.com/spreadsheets/d/${SOURCE_ID}/edit`;
// The current route blocks at the top of each verified tab. Friday also has an
// older route list below row 19; it must not override the current list.
const TABS = Object.freeze({
  mon: { title:'월', gid:1559617652, starts:[0,6,10] },
  tue: { title:'화', gid:1031551462, starts:[0,4,8] },
  wed: { title:'수', gid:0, starts:[0,4,8] },
  thu: { title:'목', gid:1722274844, starts:[0,4,8] },
  fri: { title:'금', gid:1525211932, starts:[0,4,8] }
});

function parseCsv(text) {
  const rows = [], row = []; let cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') { cell += '"'; i++; }
      else if (!cell || quoted) quoted = !quoted;
      else cell += c;
    } else if (!quoted && (c === ',' || c === '\n' || c === '\r')) {
      row.push(cell.trim()); cell = '';
      if (c !== ',') { rows.push(row.splice(0)); if (c === '\r' && text[i + 1] === '\n') i++; }
    } else cell += c;
  }
  if (quoted) throw new Error('배달동선 시트의 CSV 형식을 확인해주세요.');
  if (cell || row.length) { row.push(cell.trim()); rows.push(row); }
  return rows;
}
function parseRoutes(rows, weekday) {
  const tab = TABS[weekday];
  if (!tab) return [];
  if (!String(rows[tab.starts[1]]?.[0] || '').includes('평거')) throw new Error('배달동선 시트의 코스 행 위치가 바뀌었습니다.');
  const third = String(rows[tab.starts[2]]?.[0] || '').trim();
  if (third && !/혁신|사천/.test(third)) throw new Error('배달동선 시트의 마지막 코스 행을 확인해주세요.');
  return tab.starts.map((start, index) => ({ laneId:M.DEFAULT_LANES[index].id,
    names:rows.slice(start, start + 2).flatMap(row => row.slice(1)).map(value => String(value || '').trim())
      .filter(value => value && /[가-힣a-z]/i.test(value) && !/^(행사|기사님|언니|재영|투싼|레이)(도시락)?$/.test(value))
  }));
}
function nameKey(value) {
  return String(value || '').normalize('NFKC').toLowerCase().replace(/주식회사|\(주\)|㈜/g, '').replace(/[^a-z0-9가-힣]/g, '');
}
// Abbreviations and spelling variants observed in the source, rather than
// guessing delivery areas from a road address or a business name.
const ALIASES = Object.freeze({
  레디콜:['래디콜'], 코앰:['코엠'], 티엠바이크:['tm바이크'],
  진주어린이치과:['진주어린e치과'], 어린이치과:['진주어린e치과'],
  하나기공소:['하나치과기공소'], 멘토스스터디카페:['멘토즈스터디카페'],
  본인테리어:['본건축인테리어'], 제이엘시티파트너스:['제이엘티씨파트너스'],
  에스엔지:['에스앤지'], 에스앤지:['에스엔지'], 애스앤지:['에스앤지','에스엔지'],
  진양호625:['김세은진양호625'], 평거우체국:['평거동우체국'],
  도동초:['서부거점형다문화교육센터']
});
// Operator confirmed that this is a separate office on the same route. Keep
// two stops and two independent delivery/quantity records, adjacent in the seed.
const LINKED_STOPS = Object.freeze({ 동북관세법인:['진주관세사무소'],동북관세:['진주관세사무소'] });
function matchRoutes(routes, users = {}, rows = []) {
  const candidates = new Map();
  Object.entries(users).forEach(([uid, user]) => {
    if (!user.deleted && !user.disabled && user.businessName && M.validUid(uid)) candidates.set(uid, nameKey(user.businessName));
  });
  rows.forEach(row => { if (!candidates.has(row.uid)) candidates.set(row.uid, nameKey(row.businessName)); });
  const plan = M.normalizePlan(), assigned = new Set(), unmatched = [], ambiguous = [];
  for (const route of routes) for (const name of route.names) {
    const key = nameKey(name), variants = [key, ...(Object.hasOwn(ALIASES, key) ? ALIASES[key] : []).map(nameKey)];
    // Exact names beat abbreviations. Every fuzzy/alias match must be unique.
    let matches = [...candidates].filter(([, candidate]) => variants.includes(candidate));
    if (!matches.length) matches = [...candidates].filter(([, candidate]) => variants.some(v => v.length >= 2 && candidate.includes(v)));
    if (matches.length !== 1) { (matches.length ? ambiguous : unmatched).push(name); continue; }
    const uid = matches[0][0];
    if (!assigned.has(uid)) { plan.order[route.laneId].push(uid); assigned.add(uid); }
    for (const sibling of (Object.hasOwn(LINKED_STOPS, key) ? LINKED_STOPS[key] : [])) {
      const related = [...candidates].filter(([, candidate]) => candidate === nameKey(sibling));
      if (related.length === 1 && !assigned.has(related[0][0])) { plan.order[route.laneId].push(related[0][0]); assigned.add(related[0][0]); }
      else if (related.length > 1) ambiguous.push(sibling);
    }
  }
  return { plan, unmatched:[...new Set(unmatched)], ambiguous:[...new Set(ambiguous)] };
}
function weekPlans(sources, users) {
  const matched = Object.fromEntries(Object.keys(TABS).map(day => [day,matchRoutes(sources[day]?.routes || [],users).plan]));
  let usual = M.normalizePlan();
  for (const day of Object.keys(TABS)) usual = M.planWithSource(usual,[],matched[day]);
  const customers = Object.entries(users).filter(([uid,user]) => M.validUid(uid) && user.businessName && !user.deleted && !user.disabled).map(([uid]) => ({ uid }));
  // A customer's explicit weekday route wins. For customers omitted from that
  // tab, keep their known route from the other weekday tabs until admin edits.
  return Object.fromEntries(Object.keys(TABS).map(day => [day,M.planWithSource(matched[day],customers,usual)]));
}
function createSourceLoader({ fetchImpl = fetch, now = Date.now, ttlMs = 300000 } = {}) {
  const cache = new Map(), pending = new Map();
  return async weekday => {
    const tab = TABS[weekday];
    if (!tab) return { routes:[], tab:'', url:SOURCE_URL };
    const previous = cache.get(weekday);
    if (previous && previous.expiresAt > now()) return previous.value;
    if (pending.has(weekday)) return pending.get(weekday);
    const task = (async () => {
      const abort = new AbortController(), timeout = setTimeout(() => abort.abort(), 8000);
      try {
        const response = await fetchImpl(`https://docs.google.com/spreadsheets/d/${SOURCE_ID}/export?format=csv&gid=${tab.gid}`, { signal:abort.signal });
        if (!response.ok || !String(response.headers.get('content-type')).includes('text/csv')) throw new Error('배달동선 시트를 읽지 못했습니다.');
        const text = await response.text();
        if (text.length > 250000) throw new Error('배달동선 시트가 너무 큽니다.');
        const value = { routes:parseRoutes(parseCsv(text), weekday), tab:tab.title, url:`${SOURCE_URL}#gid=${tab.gid}` };
        cache.set(weekday, { value, expiresAt:now() + ttlMs });
        return value;
      } catch (e) {
        // Keep the last successful routing when Google is temporarily down.
        const value = { ...(previous?.value || { routes:[], tab:tab.title, url:SOURCE_URL }), warning:e.name === 'AbortError' ? '배달동선 시트 연결이 늦어지고 있습니다.' : e.message };
        cache.set(weekday, { value,expiresAt:now() + 30000 });
        return value;
      } finally { clearTimeout(timeout); pending.delete(weekday); }
    })();
    pending.set(weekday, task);
    return task;
  };
}
const loadSource = createSourceLoader();
module.exports = { SOURCE_ID, SOURCE_URL, TABS, parseCsv, parseRoutes, nameKey, matchRoutes, weekPlans, createSourceLoader, loadSource };
