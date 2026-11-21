'use strict';

// 돌담명가 직원 공용 예약장 API (reservationBoardApi).
//
// 링크를 가진 사람은 누구나 예약을 보고 등록·수정·삭제한다. 링크 열쇠(64자)는 주소의 #
// 뒤에만 있어 서버 로그와 다른 사이트로 새지 않고, 서버는 그 SHA-256 만 비교한다.
// 관리자가 새 링크를 만들면 이전 링크는 바로 막힌다.
//
// Firestore 규칙은 이 컬렉션들을 브라우저에 열지 않는다. 모든 읽기·쓰기는 이 함수가 한다.

const crypto = require('node:crypto');
const M = require('./reservationBoardModel');

const ITEMS = 'reservationBoardItems';
const NOTES = 'reservationBoardNaverNotes';
const NOTICES = 'reservationBoardNotices';
const CONFIG = 'reservationBoardConfig';
const SHARE_DOC = 'share';
// 같은 날짜를 여러 직원이 동시에 열어도 오너비스타는 이 간격에 한 번만 부른다.
const NAVER_CACHE_MS = 60000;
const CALENDAR_CACHE_MS = 120000;
const SHARE_CACHE_MS = 30000;
const NOTICE_LIMIT = 30;
const IMPORT_LIMIT = 2000;
const POLL_MS = 120000;

function same(a, b) {
  const left = Buffer.from(String(a)), right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}
async function readText(response, limit = 2 * 1024 * 1024) {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const chunks = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw M.error(400, '시트가 너무 큽니다. 예약 탭만 남긴 사본으로 다시 시도해 주세요.');
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks).toString('utf8');
  } finally { await reader.cancel().catch(() => {}); }
}
function memo(load, ttl, now) {
  const cache = new Map(), pending = new Map();
  return key => {
    const hit = cache.get(key);
    if (hit && now() - hit.at < ttl) return Promise.resolve(hit.value);
    if (!pending.has(key)) {
      pending.set(key, Promise.resolve().then(() => load(key)).then(value => {
        cache.set(key, { at: now(), value });
        if (cache.size > 200) cache.delete(cache.keys().next().value);
        return value;
      }).finally(() => pending.delete(key)));
    }
    return pending.get(key);
  };
}
const settle = promise => promise.then(value => ({ value }), err => ({ error: err?.status ? err.message : '' }));

function createReservationBoardService({ db, timestamp, naver, now = () => Date.now(), fetchImpl = fetch }) {
  const items = () => db.collection(ITEMS);
  const shareRef = () => db.collection(CONFIG).doc(SHARE_DOC);
  let share = { at: 0, hash: '' };
  const naverDay = memo(date => naver.day(date), NAVER_CACHE_MS, now);
  const naverCalendar = memo(month => naver.calendar(month), CALENDAR_CACHE_MS, now);
  const naverCancellations = memo(() => naver.cancellations(), NAVER_CACHE_MS, now);

  async function authorize(token) {
    const hash = M.shareHash(token);
    for (const fresh of [false, true]) {
      if (fresh || now() - share.at > SHARE_CACHE_MS) {
        const snapshot = await shareRef().get();
        share = { at: now(), hash: snapshot.exists ? String(snapshot.get('hash') || '') : '' };
      }
      if (share.hash && same(hash, share.hash)) return;
    }
    throw M.error(403, '사용이 끝난 예약장 링크입니다. 관리자에게 새 링크를 받아 주세요.');
  }
  async function rangeRows(collection, from, to) {
    const snapshot = await db.collection(collection).where('date', '>=', from).where('date', '<=', to).get();
    return snapshot.docs.map(doc => ({ id: doc.id, data: doc.data() || {} }));
  }
  async function notices() {
    const snapshot = await db.collection(NOTICES).orderBy('createdAt', 'desc').limit(NOTICE_LIMIT).get();
    return snapshot.docs.map(doc => {
      const data = doc.data() || {};
      return { id: doc.id, text: String(data.text || ''), author: String(data.author || ''), pinned: data.pinned === true,
        revision: Number.isSafeInteger(data.revision) ? data.revision : 0,
        createdAt: data.createdAt?.toDate?.().toISOString() || '', updatedAt: data.updatedAt?.toDate?.().toISOString() || '' };
    }).sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.createdAt.localeCompare(a.createdAt));
  }

  async function read(body) {
    await authorize(body.token);
    const dates = M.requireRange(body.from, body.to);
    const from = dates[0], to = dates.at(-1);
    const [manualRows, noteRows, noticeList, cancelled, ...feeds] = await Promise.all([
      rangeRows(ITEMS, from, to), rangeRows(NOTES, from, to), notices(), settle(naverCancellations(M.kstDate(now()))),
      ...dates.map(date => settle(naverDay(date))),
    ]);
    const notes = Object.fromEntries(noteRows.map(row => [row.id, row.data]));
    const cancelledFeed = cancelled.value;
    const cancellations = cancelledFeed?.state === 'ready' ? M.cancellationItems(cancelledFeed) : [];
    const cancelledAt = Object.fromEntries(cancellations.map(item => [item.id, item.cancelledAt]));
    const storeName = feeds.map(feed => feed.value?.storeName).find(Boolean) || '돌담명가';
    const menuOptions = [...new Set(feeds.flatMap(feed => feed.value?.menuOptions || []))].slice(0, 25);
    return { today: M.kstDate(now()), from, to, storeName, pollMs: POLL_MS, notices: noticeList, menuOptions,
      cancellations: { state: cancelledFeed ? cancelledFeed.state : 'error', date: cancelledFeed?.date || M.kstDate(now()), items: cancellations },
      days: dates.map((date, index) => M.dayView(date, manualRows, feeds[index], notes, cancelledAt)) };
  }
  async function month(body) {
    await authorize(body.token);
    const { from, to } = M.requireMonth(body.month);
    const [manualRows, calendar] = await Promise.all([rangeRows(ITEMS, from, to), settle(naverCalendar(body.month))]);
    const naverState = calendar.value ? calendar.value.state : 'error';
    return { month: body.month, today: M.kstDate(now()), naverState,
      days: M.monthView(body.month, manualRows, naverState === 'calendar' ? calendar.value : null) };
  }

  // 같은 예약을 두 직원이 동시에 고치면 나중 사람의 저장을 막는다(revision). 덮어쓰면
  // 먼저 고친 사람의 인원·시간이 소리 없이 사라진다.
  async function save(body) {
    await authorize(body.token);
    const value = M.reservationInput(body.item, now());
    const by = M.actorName(body.by);
    const at = new Date(now()).toISOString();
    if (body.id === undefined || body.id === null || body.id === '') {
      const ref = items().doc(`r_${M.requireRequestId(body.requestId).replace(/-/g, '')}`);
      return db.runTransaction(async tx => {
        const snapshot = await tx.get(ref);
        // 응답이 늦어 같은 등록을 다시 누른 경우: 새로 만들지 않고 처음 결과를 돌려준다.
        if (snapshot.exists) return { item: M.manualItem(ref.id, snapshot.data()) };
        const data = { ...value, source: 'board', deleted: false, revision: 1, createdAt: timestamp(), updatedAt: timestamp(), createdBy: by, updatedBy: by };
        tx.create(ref, data);
        return { item: M.manualItem(ref.id, { ...data, updatedAt: at }) };
      });
    }
    const ref = items().doc(M.requireId(body.id));
    const expected = M.requireRevision(body.revision);
    return db.runTransaction(async tx => {
      const snapshot = await tx.get(ref);
      if (!snapshot.exists || snapshot.get('deleted') === true) throw M.error(404, '이미 삭제된 예약입니다. 새로고침해 주세요.');
      const revision = Number(snapshot.get('revision')) || 0;
      if (revision !== expected) throw M.error(409, `다른 직원(${snapshot.get('updatedBy') || '이름 없음'})이 먼저 고쳤습니다. 새로고침해서 바뀐 내용을 확인한 뒤 다시 저장해 주세요.`);
      const data = { ...value, revision: revision + 1, updatedAt: timestamp(), updatedBy: by };
      tx.update(ref, data);
      return { item: M.manualItem(ref.id, { ...snapshot.data(), ...data, updatedAt: at }) };
    });
  }
  // 삭제는 숨김이다. 링크를 가진 누구나 지울 수 있으니, 실수로 지운 예약을 관리자가 되살릴 수 있게 남긴다.
  async function remove(body) {
    await authorize(body.token);
    const ref = items().doc(M.requireId(body.id));
    const expected = M.requireRevision(body.revision);
    const by = M.actorName(body.by);
    return db.runTransaction(async tx => {
      const snapshot = await tx.get(ref);
      if (!snapshot.exists || snapshot.get('deleted') === true) return { id: ref.id, deleted: true };
      const revision = Number(snapshot.get('revision')) || 0;
      if (revision !== expected) throw M.error(409, '다른 직원이 방금 이 예약을 고쳤습니다. 새로고침해서 확인한 뒤 다시 삭제해 주세요.');
      tx.update(ref, { deleted: true, deletedAt: timestamp(), deletedBy: by, revision: revision + 1, updatedAt: timestamp(), updatedBy: by });
      return { id: ref.id, deleted: true };
    });
  }
  // 네이버 예약은 네이버가 원본이라 고치지 않는다. 직원은 룸·비고만 덧붙인다.
  async function saveNaverNote(body) {
    await authorize(body.token);
    const value = M.noteInput(body);
    const expected = M.requireRevision(body.revision);
    const by = M.actorName(body.by);
    const ref = db.collection(NOTES).doc(value.bookingId);
    return db.runTransaction(async tx => {
      const snapshot = await tx.get(ref);
      const revision = snapshot.exists ? Number(snapshot.get('revision')) || 0 : 0;
      if (revision !== expected) throw M.error(409, `다른 직원(${snapshot.get('updatedBy') || '이름 없음'})이 먼저 적었습니다. 새로고침해서 확인한 뒤 다시 저장해 주세요.`);
      tx.set(ref, { date: value.date, room: value.room, memo: value.memo, revision: revision + 1, updatedAt: timestamp(), updatedBy: by });
      return { bookingId: value.bookingId, room: value.room, memo: value.memo, revision: revision + 1 };
    });
  }
  async function saveNotice(body) {
    await authorize(body.token);
    const value = M.noticeInput(body);
    if (!body.id) {
      const ref = db.collection(NOTICES).doc(`n_${M.requireRequestId(body.requestId).replace(/-/g, '')}`);
      await db.runTransaction(async tx => {
        if ((await tx.get(ref)).exists) return;
        tx.create(ref, { ...value, revision: 1, createdAt: timestamp(), updatedAt: timestamp() });
      });
      return { id: ref.id };
    }
    const ref = db.collection(NOTICES).doc(M.requireId(body.id, '공지를 다시 선택해 주세요.'));
    const expected = M.requireRevision(body.revision);
    await db.runTransaction(async tx => {
      const snapshot = await tx.get(ref);
      if (!snapshot.exists) throw M.error(404, '이미 지운 공지입니다. 새로고침해 주세요.');
      const revision = Number(snapshot.get('revision')) || 0;
      if (revision !== expected) throw M.error(409, '다른 직원이 이 공지를 먼저 고쳤습니다. 새로고침해 주세요.');
      tx.update(ref, { ...value, revision: revision + 1, updatedAt: timestamp() });
    });
    return { id: ref.id };
  }
  async function deleteNotice(body) {
    await authorize(body.token);
    await db.collection(NOTICES).doc(M.requireId(body.id, '공지를 다시 선택해 주세요.')).delete();
    return { id: body.id };
  }

  // ── 관리자 ──
  async function shareStatus() {
    const snapshot = await shareRef().get();
    const token = snapshot.exists ? String(snapshot.get('token') || '') : '';
    return { token, createdAt: snapshot.exists ? snapshot.get('createdAt')?.toDate?.().toISOString() || '' : '' };
  }
  async function rotateShare(actor) {
    const token = crypto.randomBytes(32).toString('hex');
    await shareRef().set({ token, hash: M.shareHash(token), createdAt: timestamp(), createdBy: String(actor?.email || actor?.uid || '') });
    share = { at: 0, hash: '' };
    return { token, createdAt: new Date(now()).toISOString() };
  }
  // 시트 줄마다 정해진 문서 이름을 쓴다. 두 번 눌러도, 나중에 시트에 줄이 늘어 다시 눌러도
  // 이미 가져온 예약은 건너뛰고 새 줄만 들어온다. 가져온 뒤 고친 내용도 덮어쓰지 않는다.
  async function importSheet(body, actor) {
    const source = M.sheetSource(body.url);
    let response;
    try {
      response = await fetchImpl(source.url, { redirect: 'error', signal: AbortSignal.timeout(15000), headers: { Accept: 'application/json' } });
    } catch (_) {
      throw M.error(400, '시트를 열지 못했습니다. 구글 시트의 공유를 「링크가 있는 모든 사용자 · 뷰어」로 바꾼 뒤 다시 눌러 주세요.');
    }
    if (!response.ok) throw M.error(400, '시트를 열지 못했습니다. 주소와 공유 설정(링크가 있는 모든 사용자)을 확인해 주세요.');
    const { rows, skipped } = M.sheetRows(M.parseGviz(await readText(response)), source, now());
    if (rows.length > IMPORT_LIMIT) throw M.error(400, `한 번에 ${IMPORT_LIMIT}건까지 가져올 수 있습니다.`);
    const existing = new Set();
    for (let i = 0; i < rows.length; i += 100) {
      const snapshots = await db.getAll(...rows.slice(i, i + 100).map(row => items().doc(row.id)));
      snapshots.forEach(snapshot => { if (snapshot.exists) existing.add(snapshot.id); });
    }
    const fresh = rows.filter(row => !existing.has(row.id));
    const by = `관리자 가져오기${actor?.email ? ` (${actor.email})` : ''}`.slice(0, 60);
    if (body.dryRun !== true) {
      for (let i = 0; i < fresh.length; i += 400) {
        const batch = db.batch();
        fresh.slice(i, i + 400).forEach(row => batch.create(items().doc(row.id), { ...row.value, source: 'sheet', sheetId: source.id,
          deleted: false, revision: 1, createdAt: timestamp(), updatedAt: timestamp(), createdBy: by, updatedBy: by }));
        await batch.commit();
      }
    }
    const warnings = rows.filter(row => row.value.people === null).map(row => `${row.value.date} ${row.value.name}: 인원이 비어 있습니다. 숫자가 아닌 값(예: 15+@)은 시트에서 읽히지 않으니 가져온 뒤 고쳐 주세요.`);
    return { dryRun: body.dryRun === true, total: rows.length, created: body.dryRun === true ? 0 : fresh.length,
      newCount: fresh.length, existing: existing.size, skipped, warnings,
      rows: rows.slice(0, 300).map(row => ({ ...row.value, id: row.id, exists: existing.has(row.id) })) };
  }

  return { read, month, save, remove, saveNaverNote, saveNotice, deleteNotice, shareStatus, rotateShare, importSheet };
}

function createReservationBoardHandler({ service, authorizeAdmin, logError = () => {} }) {
  const shared = { read: 'read', month: 'month', save: 'save', delete: 'remove', naverNote: 'saveNaverNote',
    noticeSave: 'saveNotice', noticeDelete: 'deleteNotice' };
  return async (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.set('Cache-Control', 'no-store');
    if (req.method === 'OPTIONS') return res.status(204).send('');
    if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST 요청만 지원합니다.' });
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    try {
      let result;
      if (Object.hasOwn(shared, body.action)) result = await service[shared[body.action]](body);
      else if (['adminShare', 'adminShareRotate', 'adminImport'].includes(body.action)) {
        let actor;
        try { actor = await authorizeAdmin(req); } catch (err) { throw M.error(err?.status === 403 ? 403 : 401, err?.status === 403 ? '관리자만 이용할 수 있습니다.' : '관리자 로그인이 필요합니다.'); }
        if (body.action === 'adminShare') result = await service.shareStatus();
        else if (body.action === 'adminShareRotate') result = await service.rotateShare(actor);
        else result = await service.importSheet(body, actor);
      } else throw M.error(400, '지원하지 않는 요청입니다.');
      return res.status(200).json({ ok: true, ...result });
    } catch (err) {
      // 링크 열쇠·손님 이름·전화번호가 든 요청 본문은 기록하지 않는다.
      if (!err.status || err.status >= 500) logError('Reservation board request failed', { action: String(body.action || '').slice(0, 30), message: String(err?.message || '').slice(0, 200) });
      return res.status(err.status || 500).json({ ok: false, error: err.status ? err.message : '예약장을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.' });
    }
  };
}

module.exports = { ITEMS, NOTES, NOTICES, CONFIG, SHARE_DOC, NAVER_CACHE_MS, SHARE_CACHE_MS, POLL_MS, createReservationBoardService, createReservationBoardHandler };
