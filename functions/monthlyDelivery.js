'use strict';

const crypto = require('node:crypto');
const { FieldPath } = require('firebase-admin/firestore');
const M = require('./monthlyDeliveryModel');
const Sheet = require('./monthlyDeliverySheet');

const BOARDS = 'monthlyDeliveryBoards';
const TEMPLATES = 'monthlyDeliveryTemplates';
const SHARES = 'monthlyDeliveryShares';
const SHARE_TTL_DAYS = 2;

function mapSnapshot(snapshot) {
  return Object.fromEntries(snapshot.docs.map(doc => [doc.id, doc.data() || {}]));
}
function revision(value) { return Number.isSafeInteger(value) && value >= 0 ? value : 0; }
function expectRevision(actual, expected) {
  if (!Number.isSafeInteger(expected) || expected < 0) throw M.error(400, '저장할 코스 버전을 확인해주세요.');
  if (revision(actual) !== expected) throw M.error(409, '다른 화면에서 코스가 바뀌었습니다. 최신 보드를 확인한 뒤 다시 옮겨주세요.');
}
function shareHash(token) {
  if (!/^[a-f0-9]{64}$/.test(String(token || ''))) throw M.error(403, '기사님 링크가 올바르지 않습니다. 관리자에게 새 링크를 요청해주세요.');
  return crypto.createHash('sha256').update(token).digest('hex');
}
function monthDates(month) {
  const length = new Date(`${month}-01T00:00:00Z`); length.setUTCMonth(length.getUTCMonth() + 1); length.setUTCDate(0);
  return Array.from({ length: length.getUTCDate() }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
}
function invoiceNumber(month, settlements, users, administrators) {
  const prefix = `GJS-${month.replace('-', '')}-`;
  let seq = 0;
  const visit = value => { const inv = value?.invoiceNo || ''; if (inv.startsWith(prefix)) seq = Math.max(seq, parseInt(inv.slice(prefix.length), 10) || 0); };
  Object.values(settlements).forEach(visit);
  Object.values(users).forEach(user => visit(user.settlements?.[month]));
  administrators.forEach(admin => {
    Object.values(admin.adminEvents || {}).forEach(event => visit(event.settlement));
    Object.values(admin.manualMonthlySettlements?.[month] || {}).forEach(visit);
  });
  return `${prefix}${String(seq + 1).padStart(3, '0')}`;
}

function createMonthlyDeliveryService({ db, timestamp, isNoDeliveryDate, adminEmails, now = () => new Date(), sourceLoader = Sheet.loadSource }) {
  const get = (reader, ref) => reader === db ? ref.get() : reader.get(ref);
  const boardRef = date => db.collection(BOARDS).doc(date);
  const templateRef = date => db.collection(TEMPLATES).doc(M.weekday(date));

  async function load(date, reader = db, targetUid = '') {
    const refs = [
      db.collection('orderLocks').doc(date), db.collection('config').doc('holidays'), db.collection('config').doc('settings'),
      db.collection('deliveryRecords').doc(date), db.collection('deliveryRecordArchive').doc(date)
    ];
    const reads = refs.map(ref => get(reader, ref));
    let users, privateUsers, orders, snapshots, administrators;
    if (Array.isArray(targetUid)) {
      const ids = [...new Set(targetUid.filter(M.validUid))], groups = [];
      for (let i = 0; i < ids.length; i += 30) groups.push(ids.slice(i, i + 30));
      const select = async collection => ({ docs:(await Promise.all(groups.map(group => get(reader, collection.where(FieldPath.documentId(), 'in', group))))).flatMap(snapshot => snapshot.docs) });
      const [lock, holidays, settings, fresh, archive, userSnap, privateSnap, orderSnap, snapshotSnap, admins] = await Promise.all([
        ...reads, select(db.collection('users')), select(db.collection('userPrivate')),
        select(db.collection('orders').doc(date).collection('items')),
        select(db.collection('orderDefaultSnapshots').doc(date).collection('items')),
        get(reader, db.collection('users').where('email', 'in', adminEmails()))
      ]);
      users = mapSnapshot(userSnap); privateUsers = mapSnapshot(privateSnap);
      Object.keys(users).forEach(uid => {
        if (adminEmails().includes(String(users[uid].email || '').toLowerCase())) delete users[uid];
        else users[uid] = { ...users[uid], ...(privateUsers[uid] || {}) };
      });
      return makeData(date, lock, holidays, settings, fresh, archive, users, mapSnapshot(orderSnap), mapSnapshot(snapshotSnap), admins.docs.map(doc => doc.data() || {}));
    }
    if (targetUid) {
      const values = await Promise.all([
        ...reads, get(reader, db.collection('users').doc(targetUid)), get(reader, db.collection('userPrivate').doc(targetUid)),
        get(reader, db.collection('orders').doc(date).collection('items').doc(targetUid)),
        get(reader, db.collection('orderDefaultSnapshots').doc(date).collection('items').doc(targetUid)),
        get(reader, db.collection('users').where('email', 'in', adminEmails()))
      ]);
      const [lock, holidays, settings, fresh, archive, user, priv, order, snapshot, admins] = values;
      users = user.exists ? { [targetUid]: { ...user.data(), ...(priv.exists ? priv.data() : {}) } } : {};
      orders = order.exists ? { [targetUid]: order.data() } : {};
      snapshots = snapshot.exists ? { [targetUid]: snapshot.data() } : {};
      administrators = admins.docs.map(doc => doc.data() || {});
      return makeData(date, lock, holidays, settings, fresh, archive, users, orders, snapshots, administrators);
    }
    const [lock, holidays, settings, fresh, archive, userSnap, privateSnap, orderSnap, snapshotSnap] = await Promise.all([
      ...reads, get(reader, db.collection('users')), get(reader, db.collection('userPrivate')),
      get(reader, db.collection('orders').doc(date).collection('items')),
      get(reader, db.collection('orderDefaultSnapshots').doc(date).collection('items'))
    ]);
    privateUsers = mapSnapshot(privateSnap); users = mapSnapshot(userSnap); orders = mapSnapshot(orderSnap); snapshots = mapSnapshot(snapshotSnap);
    administrators = [];
    Object.keys(users).forEach(uid => {
      if (adminEmails().includes(String(users[uid].email || '').toLowerCase())) { administrators.push(users[uid]); delete users[uid]; }
      else if (users[uid].adminEvents && !users[uid].businessName) delete users[uid];
      else users[uid] = { ...users[uid], ...(privateUsers[uid] || {}) };
    });
    return makeData(date, lock, holidays, settings, fresh, archive, users, orders, snapshots, administrators);
  }
  function makeData(date, lock, holidays, settings, fresh, archive, users, orders, snapshots, administrators) {
    const legacy = {};
    administrators.forEach(admin => Object.entries(M.legacyRecords(admin)).forEach(([day, records]) => { legacy[day] = { ...(legacy[day] || {}), ...records }; }));
    const data = {
      date, users, orders, snapshots, administrators, legacy, locked: lock.exists,
      settings: settings.exists ? settings.data() : {},
      customHolidays: holidays.exists ? (holidays.data().custom || {}) : {},
      records: M.mergeRecords(legacy[date], fresh.exists ? fresh.data().records || {} : {}, archive.exists ? archive.data().records || {} : {})
    };
    data.noDelivery = isNoDeliveryDate(date, data.customHolidays);
    data.rows = M.resolveRows(data);
    return data;
  }
  async function ensureWeekTemplates(users, sources) {
    if (!Object.values(sources).some(source => source.routes.length)) return;
    const seeds = Sheet.weekPlans(sources, users);
    await db.runTransaction(async tx => {
      const days = Object.keys(Sheet.TABS), snapshots = await Promise.all(days.map(day => tx.get(db.collection(TEMPLATES).doc(day))));
      days.forEach((day, index) => {
        if (!sources[day].routes.length) return;
        const saved = snapshots[index].exists ? snapshots[index].data() : {}, seed = seeds[day];
        const plan = M.planWithSource(saved.lanes && !saved.sourceSeeded ? saved : seed, Object.values(seed.order).flat().map(uid => ({ uid })), seed);
        if (M.samePlan(saved, plan)) return;
        tx.set(db.collection(TEMPLATES).doc(day), { ...plan,weekday:day,revision:revision(saved.revision) + 1,
          sourceSeeded:saved.lanes ? Boolean(saved.sourceSeeded) : true,updatedAt:timestamp(),updatedBy:'sheet-auto' }, { merge:true });
      });
    });
  }
  async function readBoard(date) {
    M.requireDate(date);
    const [board, data, sources] = await Promise.all([boardRef(date).get(), load(date),
      Promise.all(Object.keys(Sheet.TABS).map(async day => [day,await sourceLoader(day)])).then(Object.fromEntries)]);
    await ensureWeekTemplates(data.users, sources);
    const template = await templateRef(date).get(), source = sources[M.weekday(date)] || { routes:[],tab:'',url:Sheet.SOURCE_URL };
    let stored = board.exists ? board.data() : {};
    const defaults = template.exists ? template.data() : {}, matched = Sheet.matchRoutes(source.routes, data.users, data.rows);
    const additions = M.planWithSource(defaults.lanes ? defaults : matched.plan, [], matched.plan);
    let plan = M.planWithSource(stored.lanes ? stored : additions, data.rows, additions);
    // A shared/saved board must also include newly matched members, so drivers
    // can see and complete them. Reads of an unedited date stay unsaved and keep
    // following the weekday template. Never overwrite an administrator's edit.
    if (board.exists && !M.samePlan(stored, plan)) {
      const synced = await db.runTransaction(async tx => {
        const [current, currentTemplate] = await Promise.all([tx.get(boardRef(date)), tx.get(templateRef(date))]);
        const saved = current.exists ? current.data() : {}, weekdayDefault = currentTemplate.exists ? currentTemplate.data() : matched.plan;
        const seed = M.planWithSource(weekdayDefault, [], matched.plan), base = saved.lanes ? saved : seed;
        const next = M.planWithSource(base, data.rows, seed);
        if (current.exists && !M.samePlan(saved, next)) {
          saved.revision = revision(saved.revision) + 1;
          tx.set(boardRef(date), { ...next,revision:saved.revision,updatedAt:timestamp(),updatedBy:'sheet-auto' }, { merge:true });
        }
        return { stored:saved,plan:next };
      });
      stored = synced.stored; plan = synced.plan;
    }
    return {
      date, revision: revision(stored.revision), templateRevision: revision(defaults.revision), plan,
      rows: data.rows.map(M.publicRow), noDelivery: data.noDelivery, pollMs: M.POLL_MS,
      updatedAt: stored.updatedAt?.toDate?.().toISOString() || '',
      routeSource: { tab:source.tab,url:source.url,weekReady:Object.values(sources).every(value => value.routes.length > 0),warning:source.warning || '',unmatched:matched.unmatched,ambiguous:matched.ambiguous },
      excluded: Object.entries(data.orders).filter(([, order]) => order.selfHoliday).map(([uid, order]) => ({ uid, businessName: data.users[uid]?.businessName || order.businessName || uid, reason: '자체 휴무' }))
    };
  }
  async function saveBoard(body, actor) {
    const date = M.requireDate(body.date), plan = M.validatePlan(body.plan);
    return db.runTransaction(async tx => {
      const ref = boardRef(date), snapshot = await tx.get(ref), stored = snapshot.exists ? snapshot.data() : {};
      expectRevision(stored.revision, body.revision);
      const nextRevision = revision(stored.revision) + 1;
      const removedShares = {};
      (stored.lanes || []).filter(lane => !plan.lanes.some(next => next.id === lane.id)).forEach(lane => {
        const previous = stored.shares?.[lane.id];
        if (previous?.hash) {
          tx.set(db.collection(SHARES).doc(previous.hash), { revoked:true,revokedAt:timestamp(),revokedBy:actor.uid }, { merge:true });
          removedShares[lane.id] = { token:'',hash:'',expiresAt:0 };
        }
      });
      tx.set(ref, { ...plan, date, revision: nextRevision, ...(Object.keys(removedShares).length ? { shares:removedShares } : {}), updatedAt: timestamp(), updatedBy: actor.uid }, { merge: true });
      return { revision: nextRevision };
    });
  }
  async function saveTemplate(body, actor) {
    const date = M.requireDate(body.date), plan = M.validatePlan(body.plan);
    if (['sat', 'sun'].includes(M.weekday(date))) throw M.error(400, '평일의 기본 코스를 저장해주세요.');
    return db.runTransaction(async tx => {
      const ref = templateRef(date), snapshot = await tx.get(ref), stored = snapshot.exists ? snapshot.data() : {};
      expectRevision(stored.revision, body.templateRevision);
      const nextRevision = revision(stored.revision) + 1;
      tx.set(ref, { ...plan, weekday: M.weekday(date), revision: nextRevision, updatedAt: timestamp(), updatedBy: actor.uid });
      return { templateRevision: nextRevision };
    });
  }
  async function share(body, actor) {
    const date = M.requireDate(body.date);
    if (date < M.kstDate(now())) throw M.error(400, '오늘 또는 앞으로 배송할 날짜의 링크를 만들어주세요.');
    const source = await sourceLoader(M.weekday(date));
    return db.runTransaction(async tx => {
      const [board, template, data] = await Promise.all([tx.get(boardRef(date)), tx.get(templateRef(date)), load(date, tx)]);
      const stored = board.exists ? board.data() : {}, seeded = Sheet.matchRoutes(source.routes, data.users, data.rows).plan;
      const plan = M.planWithSource(stored.lanes ? stored : (template.exists ? template.data() : seeded), data.rows, seeded);
      expectRevision(stored.revision, body.revision);
      const lane = plan.lanes.find(l => l.id === body.laneId && l.id !== 'unassigned');
      if (!lane) throw M.error(400, '배정된 배송코스를 선택해주세요.');
      const previous = stored.shares?.[lane.id];
      if (previous?.token && previous.expiresAt > now().getTime()) return { token: previous.token, expiresAt: previous.expiresAt, revision: revision(stored.revision) };
      const token = crypto.randomBytes(32).toString('hex'), hash = shareHash(token);
      const expiresAt = new Date(`${date}T23:59:59+09:00`).getTime() + SHARE_TTL_DAYS * 86400000;
      const nextRevision = board.exists ? revision(stored.revision) : 1;
      tx.set(db.collection(SHARES).doc(hash), { date, laneId: lane.id, expiresAt, createdBy: actor.uid, createdAt: timestamp(), revoked: false });
      tx.set(boardRef(date), { ...plan, date, revision: nextRevision, shares: { [lane.id]: { token, hash, expiresAt } }, updatedAt: timestamp(), updatedBy: actor.uid }, { merge: true });
      return { token, expiresAt, revision: nextRevision };
    });
  }
  async function scope(token, reader = db) {
    const hash = shareHash(token), snapshot = await get(reader, db.collection(SHARES).doc(hash));
    const value = snapshot.exists ? snapshot.data() : null;
    if (!value || value.revoked || value.expiresAt <= now().getTime()) throw M.error(403, '만료되거나 해제된 기사님 링크입니다. 관리자에게 새 링크를 요청해주세요.');
    return { ...value, hash };
  }
  function checkScope(link, board) {
    if (board.shares?.[link.laneId]?.hash !== link.hash) throw M.error(403, '해제된 기사님 링크입니다. 관리자에게 새 링크를 요청해주세요.');
  }
  async function driverRead(body) {
    const link = await scope(body.token);
    const data = await readBoard(link.date);
    const boardSnapshot = await boardRef(link.date).get();
    const board = boardSnapshot.exists ? boardSnapshot.data() : {};
    checkScope(link, board);
    const lane = board.lanes?.find(l => l.id === link.laneId && l.id !== 'unassigned');
    if (!lane) throw M.error(403, '이 배송코스가 해제되었습니다.');
    const byUid = new Map(data.rows.map(row => [row.uid, row]));
    return { date: link.date, lane, rows: (board.order?.[lane.id] || []).filter(uid => byUid.has(uid)).map(uid => byUid.get(uid)),
      canComplete: link.date === M.kstDate(now()) && !data.noDelivery, noDelivery: data.noDelivery, pollMs: M.POLL_MS };
  }
  async function revoke(body, actor) {
    const date = M.requireDate(body.date);
    await db.runTransaction(async tx => {
      const ref = boardRef(date), snapshot = await tx.get(ref), stored = snapshot.exists ? snapshot.data() : {};
      const previous = stored.shares?.[body.laneId];
      if (!previous?.hash) return;
      tx.set(db.collection(SHARES).doc(previous.hash), { revoked: true, revokedAt: timestamp(), revokedBy: actor.uid }, { merge: true });
      tx.set(ref, { shares: { [body.laneId]: { token: '', hash: '', expiresAt: 0 } } }, { merge: true });
    });
    return { revoked: true };
  }
  async function pause(body, actor) {
    const date = M.requireDate(body.date);
    if (!M.validUid(body.uid)) throw M.error(400, '업체를 확인해주세요.');
    await db.runTransaction(async tx => {
      const data = await load(date, tx, body.uid), row = data.rows.find(r => r.uid === body.uid);
      if (!row) throw M.error(409, '오늘 배송 대상이 바뀌었습니다. 최신 보드를 확인해주세요.');
      if (row.delivered) throw M.error(409, '이미 배송완료한 업체입니다. 주문 화면에서 완료 취소 후 휴무로 변경해주세요.');
      if (body.signature !== row.signature) throw M.error(409, '주문이 바뀌었습니다. 최신 보드를 확인해주세요.');
      tx.set(db.collection('orders').doc(date).collection('items').doc(body.uid), {
        uid: body.uid, targetDate: date, businessName: row.businessName, selfHoliday: true,
        lunchCount: 0, lunchQty: 0, saladCount: 0, saladQty: 0, eventLunchCount: 0, eventLunchQty: 0, cateringItems: [],
        adminInput: true, source: 'adminHoliday', submittedBy: actor.uid, updatedAt: timestamp()
      }, { merge: true });
    });
    return { paused: true };
  }
  async function complete(body, actor = null) {
    if (!M.validUid(body.uid) || typeof body.delivered !== 'boolean') throw M.error(400, '업체와 완료 상태를 확인해주세요.');
    return db.runTransaction(async tx => {
      const link = actor ? null : await scope(body.token, tx), date = M.requireDate(link ? link.date : body.date);
      if (date > M.kstDate(now()) || (!actor && date !== M.kstDate(now()))) throw M.error(400, '기사님은 오늘 배송만 완료 체크할 수 있습니다.');
      const [boardSnapshot, data] = await Promise.all([tx.get(boardRef(date)), load(date, tx, body.uid)]);
      if (link) {
        const board = boardSnapshot.exists ? boardSnapshot.data() : {};
        checkScope(link, board);
        if (!board.lanes?.some(l => l.id === link.laneId && l.id !== 'unassigned') || !board.order?.[link.laneId]?.includes(body.uid)) throw M.error(403, '담당 코스의 업체만 완료 체크할 수 있습니다.');
      }
      const row = data.rows.find(r => r.uid === body.uid);
      if (!row || data.noDelivery) throw M.error(409, '취소·휴무 또는 배송 없는 날입니다. 최신 배송 목록을 확인해주세요.');
      if (row.delivered === body.delivered) return { changed: false, delivered: body.delivered };
      if (body.signature !== row.signature) throw M.error(409, '주문 수량이나 배송 정보가 바뀌었습니다. 최신 목록을 확인한 뒤 다시 체크해주세요.');
      const month = date.slice(0, 7), dates = monthDates(month);
      const [fresh, archived, settlementSnap, invoiceUsers] = await Promise.all([
        Promise.all(dates.map(day => tx.get(db.collection('deliveryRecords').doc(day)))),
        Promise.all(dates.map(day => tx.get(db.collection('deliveryRecordArchive').doc(day)))),
        tx.get(db.collection('settlements').doc(month).collection('items')),
        tx.get(db.collection('users'))
      ]);
      const settlements = mapSnapshot(settlementSnap), users = mapSnapshot(invoiceUsers);
      const saved = settlements[body.uid] || data.users[body.uid]?.settlements?.[month] || {};
      const actorId = actor?.uid || `monthlyDriver:${link.hash.slice(0, 16)}`;
      const record = M.completionRecord(row, data.records[body.uid] || {}, date, body.delivered, actorId, timestamp());
      const monthRecords = {};
      dates.forEach((day, index) => {
        const merged = M.mergeRecords(data.legacy[day], fresh[index].exists ? fresh[index].data().records || {} : {}, archived[index].exists ? archived[index].data().records || {} : {});
        if (merged[body.uid]) monthRecords[day] = merged[body.uid];
      });
      monthRecords[date] = record;
      // Completion skips a held bill like admin.autoBillCompletedDeliveries. Cancellation
      // recalculates its totals but retains hold, payments, carryover and other saved fields.
      const settlement = saved.status === '보류' && body.delivered ? undefined : M.buildSettlement({
        uid: body.uid, month, records: monthRecords, user: data.users[body.uid], saved,
        invoiceNo: invoiceNumber(month, settlements, users, data.administrators),
        noDelivery: day => isNoDeliveryDate(day, data.customHolidays), now: now()
      });
      tx.set(db.collection('deliveryRecords').doc(date), { date, records: { [body.uid]: record }, updatedAt: timestamp() }, { merge: true });
      const billRef = db.collection('settlements').doc(month).collection('items').doc(body.uid);
      if (settlement === null && settlements[body.uid]) tx.delete(billRef);
      else if (settlement) tx.set(billRef, settlement); // Replace daily map, preserving saved fields in the payload.
      return { changed: true, delivered: body.delivered, settlementHeld: saved.status === '보류' };
    });
  }
  return { readBoard, saveBoard, saveTemplate, share, driverRead, revoke, pause, complete };
}

function createMonthlyDeliveryHandler({ service, authorize, logError = () => {} }) {
  return async (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.set('Cache-Control', 'no-store');
    if (req.method === 'OPTIONS') return res.status(204).send('');
    if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });
    const body = req.body || {};
    try {
      let result;
      if (body.action === 'driverRead') result = await service.driverRead(body);
      else if (body.action === 'driverComplete') result = await service.complete(body);
      else {
        const actor = await authorize(req);
        switch (body.action) {
          case 'read': result = await service.readBoard(body.date); break;
          case 'save': result = await service.saveBoard(body, actor); break;
          case 'template': result = await service.saveTemplate(body, actor); break;
          case 'share': result = await service.share(body, actor); break;
          case 'revoke': result = await service.revoke(body, actor); break;
          case 'pause': result = await service.pause(body, actor); break;
          case 'complete': result = await service.complete(body, actor); break;
          default: throw M.error(400, '지원하지 않는 작업입니다.');
        }
      }
      return res.status(200).json({ ok: true, ...result });
    } catch (err) {
      // Never log share tokens, addresses or request bodies.
      if (!err.status || err.status >= 500) logError('Monthly delivery request failed', { action: String(body.action || '').slice(0, 40) });
      return res.status(err.status || 500).json({ ok: false, error: err.status ? err.message : '배송 정보를 처리하지 못했습니다. 잠시 후 다시 시도해주세요.' });
    }
  };
}

module.exports = { BOARDS, TEMPLATES, SHARES, SHARE_TTL_DAYS, createMonthlyDeliveryService, createMonthlyDeliveryHandler, shareHash };
