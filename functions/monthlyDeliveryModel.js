'use strict';

const crypto = require('node:crypto');
const catering = require('./cateringCatalog');

const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const DEFAULT_LANES = Object.freeze([
  { id: 'center', name: '하대 · 시내 · 초전', driver: '1호차' },
  { id: 'west', name: '평거', driver: '2호차' },
  { id: 'east', name: '혁신 · 문산 · 사천', driver: '3호차' },
  { id: 'unassigned', name: '미배정', driver: '' }
]);
const POLL_MS = 20000;
const MAX_STOPS = 2000;

function error(status, message) { return Object.assign(new Error(message), { status }); }
function count(value, fallback = 0, max = 999) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? Math.max(0, Math.min(max, n)) : fallback;
}
function money(value, fallback = 0) {
  const n = Number(value ?? fallback);
  return Number.isFinite(n) ? Math.max(0, n) : fallback;
}
function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}
function requireDate(value) {
  if (!validDate(value) || value < '2020-01-01' || value > '2100-12-31') throw error(400, '배송 날짜를 확인해주세요.');
  return value;
}
function weekday(date) { return WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()]; }
function kstDate(now = new Date()) { return new Date(now.getTime() + 9 * 3600000).toISOString().slice(0, 10); }
function dateOfTimestamp(value) {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate();
  if (typeof value.seconds === 'number') return new Date(value.seconds * 1000);
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}
function paused(user, date) {
  return user.mealPaused === true && (!user.mealPauseStartDate || date >= user.mealPauseStartDate)
    && (!user.mealResumeDate || date < user.mealResumeDate);
}
function activeDefault(user, date, deadline = {}) {
  if (validDate(user.serviceStartDate) && date < user.serviceStartDate) return false;
  const created = dateOfTimestamp(user.createdAt || user.registeredAt || user.joinedAt);
  if (created) {
    const joined = kstDate(created);
    if (joined > date) return false;
    const t = new Date(created.getTime() + 9 * 3600000);
    if (joined === date && t.getUTCHours() * 60 + t.getUTCMinutes() >= (deadline.closeHour ?? 9) * 60 + (deadline.closeMinute ?? 20)) return false;
  }
  return !paused(user, date);
}
function defaultsFor(user, date) {
  const saved = user.weekdayMeals || user.weekdayMealCounts || {};
  const value = saved[weekday(date)] || {};
  return {
    lunchCount: count(value.lunch ?? value.lunchCount, count(user.defaultLunch, 2, 50), 50),
    saladCount: count(value.salad ?? value.saladCount, count(user.defaultSalad, 0, 50), 50)
  };
}
function isDeleted(record) { return Boolean(record?.deleted || record?.orderDeleted); }
function mergeRecord(previous, next) {
  if (!previous) return next;
  if (!next) return previous;
  if (isDeleted(previous) && !isDeleted(next)) return next;
  return isDeleted(next) ? next : { ...previous, ...next };
}
function legacyRecords(admin = {}) {
  const result = {};
  Object.entries(admin).forEach(([key, value]) => {
    if (!key.startsWith('deliveryRecords.')) return;
    const rest = key.slice('deliveryRecords.'.length), date = rest.slice(0, 10), uid = rest.slice(11);
    if (validDate(date) && uid) (result[date] ||= {})[uid] = mergeRecord(result[date]?.[uid], value);
  });
  Object.entries(admin.deliveryRecords || {}).forEach(([date, rows]) => {
    Object.entries(rows || {}).forEach(([uid, record]) => { (result[date] ||= {})[uid] = mergeRecord(result[date]?.[uid], record); });
  });
  return result;
}
function mergeRecords(legacy = {}, fresh = {}, archive = {}) {
  const merged = { ...legacy };
  // Same archive precedence as admin.loadDeliveryRecordsForDates.
  const sources = Object.keys(fresh).length === 0 && Object.keys(legacy).length === 0 ? [archive, fresh] : [fresh];
  sources.forEach(source => Object.entries(source).forEach(([uid, record]) => { merged[uid] = mergeRecord(merged[uid], record); }));
  Object.keys(merged).forEach(uid => { if (merged[uid]?.deleted) delete merged[uid]; });
  return merged;
}
function quantities(record, user) {
  let lunch = count(record.lunchQty ?? record.lunchCount ?? record.lunch);
  const salad = count(record.saladQty ?? record.saladCount ?? record.salad);
  let event = count(record.eventLunchQty ?? record.eventLunchCount ?? record.eventLunch);
  const flags = ['disposableLunch', 'useDisposableLunch', 'disposableLunchCustomer'];
  const key = flags.find(k => record[k] !== undefined && record[k] !== null);
  const disposable = key ? Boolean(record[key]) : flags.some(k => user[k]);
  if (disposable) { event += lunch; lunch = 0; }
  return { lunch, salad, event, disposable };
}
function toRow(uid, record, user = {}, date, deliveredRecord = null) {
  const q = quantities(record, user);
  const extra = catering.summarize(record.cateringItems || [], { preserveSnapshot: true, date });
  const lunchPrice = money(record.lunchPrice, money(user.lunchPrice ?? user.priceLunch, 8000));
  const saladPrice = money(record.saladPrice, money(user.saladPrice ?? user.priceSalad, 8000));
  const eventPrice = money(record.eventLunchPrice ?? record.eventPrice) || lunchPrice;
  const row = {
    uid, businessName: user.businessName || record.businessName || record.name || uid,
    phone: user.phone || record.phone || '',
    address: record.deliveryPlace || user.deliveryPlace || user.address || record.address || '',
    addressDetail: record.deliveryPlaceDetail || user.deliveryPlaceDetail || '',
    mealTime: record.deliveryTime || user.deliveryTime || user.mealTime || '',
    note: user.adminMemo || record.note || '',
    lunchCount: q.lunch, saladCount: q.salad, eventLunchCount: q.event,
    disposableLunch: q.disposable, cateringItems: extra.items,
    cateringTotal: extra.totalQty, cateringAmount: extra.totalAmount,
    lunchPrice, saladPrice, eventLunchPrice: eventPrice,
    totalQty: q.lunch + q.salad + q.event + extra.totalQty,
    delivered: Boolean(deliveredRecord?.delivered), adminManual: Boolean(record.adminManual),
    source: record.adminManual ? 'adminManual' : (record.source || 'default')
  };
  row.signature = signature(row);
  return row;
}
function signature(row) {
  return crypto.createHash('sha256').update(JSON.stringify([
    row.uid, row.lunchCount, row.saladCount, row.eventLunchCount, row.disposableLunch,
    row.cateringItems, row.lunchPrice, row.saladPrice, row.eventLunchPrice,
    row.address, row.addressDetail, row.mealTime, row.note
  ])).digest('hex');
}
// Default meals, date overrides, paused members, frozen defaults and manual deliveries
// follow admin.mergeOrdersWithDefaults. Prices are retained only for server completion.
function resolveRows({ date, users = {}, orders = {}, snapshots = {}, locked = false, records = {}, settings = {}, noDelivery = false }) {
  if (noDelivery) return [];
  const rows = new Map();
  Object.entries({ ...users, ...(locked ? snapshots : {}) }).forEach(([uid]) => {
    const user = locked && snapshots[uid] ? { ...(users[uid] || {}), ...snapshots[uid] } : (users[uid] || {});
    if (user.deleted || user.disabled || !activeDefault(user, date, settings) || isDeleted(records[uid])) return;
    const saved = locked && snapshots[uid] ? { ...user, ...snapshots[uid] } : defaultsFor(user, date);
    const base = records[uid] || saved;
    // A frozen zero default stays a holiday even if a later profile changes its amount.
    const defaultQty = quantities(saved, user);
    if (defaultQty.lunch + defaultQty.salad + defaultQty.event <= 0 && !catering.summarize(records[uid]?.cateringItems || []).totalQty) return;
    const row = toRow(uid, base, user, date, records[uid]);
    if (row.totalQty > 0) rows.set(uid, row);
  });
  Object.entries(orders).forEach(([uid, order]) => {
    if (order.kind === 'eventLunch' || uid.startsWith('event_')) return;
    const user = users[uid] || {}, record = records[uid];
    const override = record && !isDeleted(record) && (record.delivered || record.adminAdjusted || record.adminManual);
    if (users[uid] && !user.deleted && !user.disabled && paused(user, date) && !override) { rows.delete(uid); return; }
    if (order.selfHoliday || isDeleted(order)) { rows.delete(uid); return; }
    const rawQty = quantities(order, user);
    if (rawQty.lunch + rawQty.salad + rawQty.event + catering.summarize(order.cateringItems || [], { date }).totalQty <= 0) { rows.delete(uid); return; }
    const chosen = override ? { ...order, ...record } : order;
    const row = toRow(uid, { ...chosen, deliveryPlace: order.deliveryPlace || user.deliveryPlace || chosen.deliveryPlace }, user, date, override ? record : null);
    if (row.totalQty > 0) rows.set(uid, row);
  });
  Object.entries(records).forEach(([uid, record]) => {
    if (!record?.adminManual || isDeleted(record)) return;
    const order = orders[uid];
    if (order) {
      const q = quantities(order, users[uid] || {});
      if (order.selfHoliday || isDeleted(order) || q.lunch + q.salad + q.event + catering.summarize(order.cateringItems || [], { date }).totalQty <= 0) return;
    }
    const row = toRow(uid, record, users[uid] || {}, date, record);
    if (row.totalQty > 0) rows.set(uid, row);
  });
  return [...rows.values()].sort((a, b) => a.businessName.localeCompare(b.businessName, 'ko'));
}
function validUid(uid) { return typeof uid === 'string' && uid.length > 0 && uid.length <= 200 && !/[/.\[\]~*]/.test(uid); }
function normalizePlan(value = {}, rows = []) {
  const lanes = (Array.isArray(value.lanes) && value.lanes.length ? value.lanes : DEFAULT_LANES)
    .filter(l => l && validLaneId(l.id))
    .map(l => ({ id: l.id, name: String(l.name || '').trim().slice(0, 60), driver: String(l.driver || '').trim().slice(0, 60) }));
  if (!lanes.some(l => l.id === 'unassigned')) lanes.push({ ...DEFAULT_LANES.at(-1) });
  const order = {}, seen = new Set();
  lanes.forEach(l => {
    order[l.id] = (Array.isArray(value.order?.[l.id]) ? value.order[l.id] : [])
      .filter(uid => { if (!validUid(uid) || seen.has(uid)) return false; seen.add(uid); return true; });
  });
  rows.forEach(row => { if (!seen.has(row.uid)) { order.unassigned.push(row.uid); seen.add(row.uid); } });
  return { lanes, order };
}
function validatePlan(value) {
  if (!value || !Array.isArray(value.lanes) || value.lanes.length < 1 || value.lanes.length > 15) throw error(400, '배송코스를 확인해주세요.');
  const ids = value.lanes.map(l => l?.id);
  if (new Set(ids).size !== ids.length || !ids.includes('unassigned') || ids.some(id => !validLaneId(id))) throw error(400, '배송코스 ID가 올바르지 않습니다.');
  const all = ids.flatMap(id => Array.isArray(value.order?.[id]) ? value.order[id] : [null]);
  if (all.length > MAX_STOPS || new Set(all).size !== all.length || all.some(uid => !validUid(uid))) throw error(400, '업체는 한 코스에 한 번만 배정해주세요.');
  if (value.lanes.some(l => typeof l.name !== 'string' || !l.name.trim() || l.name.length > 60 || typeof l.driver !== 'string' || l.driver.length > 60)) throw error(400, '코스명과 담당 차량을 확인해주세요.');
  return normalizePlan(value);
}
function planWithSource(value, rows, sourcePlan) {
  const plan = normalizePlan(value), seen = new Set(Object.values(plan.order).flat());
  // Existing assignments (including an explicitly unassigned stop), deleted
  // categories and manual visit order win over the reference sheet.
  Object.entries(sourcePlan.order).forEach(([id, uids]) => {
    if (!plan.order[id]) return;
    uids.forEach(uid => { if (!seen.has(uid)) { plan.order[id].push(uid); seen.add(uid); } });
  });
  rows.forEach(row => { if (!seen.has(row.uid)) { plan.order.unassigned.push(row.uid); seen.add(row.uid); } });
  return plan;
}
function samePlan(left, right) {
  // Firestore map keys need not retain JavaScript insertion order. The lane
  // array and each stop array define the order; object key order does not.
  const ordered = value => (value.lanes || []).map(lane => [lane.id,lane.name,lane.driver,value.order?.[lane.id] || []]);
  return JSON.stringify(ordered(left)) === JSON.stringify(ordered(right));
}
function validLaneId(id) { return typeof id === 'string' && /^[a-zA-Z0-9_-]{1,40}$/.test(id) && !['__proto__', 'prototype', 'constructor'].includes(id); }
function publicRow(row) {
  const { uid, businessName, phone, address, addressDetail, mealTime, note, lunchCount, saladCount, eventLunchCount, delivered, signature: stamp } = row;
  return { uid, businessName, phone, address, addressDetail, mealTime, note, lunchCount, saladCount, eventLunchCount, delivered, signature: stamp,
    cateringLabel: row.cateringItems.map(item => `${item.name} ${item.qty}개`).join(' · ') };
}
function completionRecord(row, previous, date, delivered, actor, timestamp) {
  if (!delivered) return { ...previous, delivered: false, deliveredAt: null, cancelledAt: timestamp, cancelledBy: actor, updatedAt: timestamp };
  const items = [
    { kind: 'lunch', name: '일반도시락', qty: row.lunchCount, unitPrice: row.lunchPrice, amount: row.lunchCount * row.lunchPrice },
    { kind: 'salad', name: '샐러드', qty: row.saladCount, unitPrice: row.saladPrice, amount: row.saladCount * row.saladPrice },
    { kind: 'eventLunch', name: '일회용도시락', qty: row.eventLunchCount, unitPrice: row.eventLunchPrice, amount: row.eventLunchCount * row.eventLunchPrice },
    ...row.cateringItems
  ].filter(item => item.qty > 0);
  return {
    ...previous, uid: row.uid, businessName: row.businessName, phone: row.phone,
    lunchCount: row.lunchCount, lunchQty: row.lunchCount, lunchPrice: row.lunchPrice,
    saladCount: row.saladCount, saladQty: row.saladCount, saladPrice: row.saladPrice,
    eventLunchCount: row.eventLunchCount, eventLunchQty: row.eventLunchCount, eventLunchPrice: row.eventLunchPrice, eventPrice: row.eventLunchPrice,
    cateringItems: row.cateringItems, cateringTotal: row.cateringTotal, cateringAmount: row.cateringAmount,
    disposableLunch: row.disposableLunch, totalQty: row.totalQty, totalAmount: items.reduce((sum, item) => sum + item.amount, 0), items,
    targetDate: date, note: row.note, deliveryPlace: row.address, deliveryPlaceDetail: row.addressDetail, deliveryTime: row.mealTime,
    delivered: true, deliveredAt: timestamp, deliveredBy: actor, adminAdjusted: true, adminManual: row.adminManual,
    source: row.source, orderDeleted: false, deleted: false, updatedAt: timestamp
  };
}
function paidTotal(saved) {
  const paid = (Array.isArray(saved.payments) ? saved.payments : []).reduce((sum, p) => sum + (parseInt(p.amount, 10) || 0), 0);
  if (paid > 0) return paid;
  if (money(saved.paidAmount) > 0) return money(saved.paidAmount);
  return saved.status === '입금완료' ? money(saved.amount) + (parseInt(saved.adjust, 10) || 0) + money(saved.carryover) : 0;
}
function buildSettlement({ uid, month, records, user, saved = {}, invoiceNo, noDelivery, now = new Date() }) {
  if (saved.type === 'manualMonthly') throw error(409, '엑셀 정산 업체는 관리자 정산 화면에서 확인해주세요.');
  const totals = { lunch: 0, salad: 0, eventLunch: 0, catering: 0, cateringAmount: 0 }, daily = {}, extras = new Map();
  const registered = Boolean(user);
  let lunchPrice = registered ? money(user.lunchPrice ?? user.priceLunch, 8000) : money(saved.lunchPrice ?? saved.priceLunch);
  let saladPrice = registered ? money(user.saladPrice ?? user.priceSalad, 8000) : money(saved.saladPrice ?? saved.priceSalad);
  let eventPrice = registered ? lunchPrice : money(saved.eventPrice ?? saved.eventLunchPrice);
  let last = {};
  Object.entries(records).sort(([a], [b]) => a.localeCompare(b)).forEach(([date, record]) => {
    if (!record || !record.delivered || isDeleted(record) || noDelivery(date)) return;
    last = record;
    const lunch = count(record.lunchQty ?? record.lunchCount), salad = count(record.saladQty ?? record.saladCount), eventLunch = count(record.eventLunchQty ?? record.eventLunchCount);
    const extra = catering.summarize(record.cateringItems || [], { preserveSnapshot: true, date });
    if (!registered) {
      if (lunch) lunchPrice = money(record.lunchPrice, 8000);
      if (salad) saladPrice = money(record.saladPrice, 8000);
      if (eventLunch) eventPrice = money(record.eventLunchPrice ?? record.eventPrice) || money(record.lunchPrice, 8000);
    }
    if (record.eventLunchPrice || record.eventPrice) eventPrice = money(record.eventLunchPrice ?? record.eventPrice);
    totals.lunch += lunch; totals.salad += salad; totals.eventLunch += eventLunch; totals.catering += extra.totalQty; totals.cateringAmount += extra.totalAmount;
    extra.items.forEach(item => { const old = extras.get(item.menuId); extras.set(item.menuId, old ? { ...old, qty: old.qty + item.qty, amount: old.amount + item.amount } : { ...item }); });
    if (lunch + salad + eventLunch + extra.totalQty > 0) daily[date] = { lunch, salad, eventLunch, catering: extra.totalQty, cateringAmount: extra.totalAmount, cateringItems: extra.items };
  });
  const paid = paidTotal(saved), held = saved.status === '보류';
  if (totals.lunch + totals.salad + totals.eventLunch + totals.catering === 0 && paid <= 0 && !money(saved.carryover) && !saved.carriedOverTo && !held) return null;
  const amount = totals.lunch * lunchPrice + totals.salad * saladPrice + totals.eventLunch * eventPrice + totals.cateringAmount;
  const adjust = parseInt(saved.adjust, 10) || 0;
  const status = held || saved.status === '이월' ? saved.status : (paid > 0 && paid >= amount + adjust + money(saved.carryover) ? '입금완료' : '청구완료');
  const due = new Date(`${month}-01T00:00:00Z`); due.setUTCMonth(due.getUTCMonth() + 1); due.setUTCDate(10);
  return {
    ...saved, uid, type: registered ? 'customerMonthly' : 'manualOrderMonthly', manualOrder: !registered,
    businessName: user?.businessName || last.businessName || saved.businessName || uid,
    ...(!registered ? { phone: last.phone || saved.phone || '', source: 'adminManualDelivery' } : {}),
    ...totals, lunchTotal: totals.lunch, saladTotal: totals.salad, eventLunchTotal: totals.eventLunch, cateringTotal: totals.catering,
    lunchPrice, saladPrice, eventPrice, cateringItems: [...extras.values()], daily, amount, adjust, status,
    invoiceNo: saved.invoiceNo || invoiceNo, dueDate: saved.dueDate || due.toISOString().slice(0, 10),
    note: saved.note || '', payments: saved.payments || [], paidAmount: paid, paidDate: saved.paidDate || '',
    autoBilled: true, autoBilledAt: now.toISOString(), updatedAt: now.toISOString()
  };
}

module.exports = { DEFAULT_LANES, POLL_MS, MAX_STOPS, error, count, money, validDate, requireDate, weekday, kstDate, paused, activeDefault,
  defaultsFor, mergeRecord, legacyRecords, mergeRecords, quantities, resolveRows, normalizePlan, validatePlan, planWithSource, samePlan, validUid, publicRow,
  completionRecord, buildSettlement, signature };
