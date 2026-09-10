'use strict';

const crypto = require('crypto');
const model = require('./attendanceModel');

// All attendance writes go through this service. Browser Firestore writes are denied.
function createAttendanceService({ db, now = Date.now }) {
  const employees = db.collection('staffEmployees');
  const shifts = db.collection('staffShifts');
  const devices = db.collection('attendanceDevices');
  const requests = db.collection('attendanceRequests');
  const audit = db.collection('attendanceAudit');
  const serialize = snap => ({ ...snap.data(), id: snap.id });
  const digest = token => crypto.createHash('sha256').update(token).digest('hex');
  const lastShift = shift => shift ? { id: shift.id, checkInAt: shift.checkInAt, checkOutAt: shift.checkOutAt } : null;
  function log(tx, actor, action, targetId, before, after) {
    tx.create(audit.doc(), { actor, action, targetId, before: before || null, after: after || null, at: now() });
  }
  function existing(snap, label) {
    if (!snap.exists) model.fail(`${label}을(를) 찾을 수 없습니다.`, 404);
    return serialize(snap);
  }
  function revision(input, previous) {
    if (input.version !== previous.version) model.fail('다른 화면에서 변경되었습니다. 새로고침 후 다시 시도해 주세요.', 409);
  }
  function deviceRef(token) {
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) model.fail('관리자에게 태블릿 연결을 요청해 주세요.', 401);
    return devices.doc(digest(token));
  }
  function checkDevice(snap) {
    if (!snap.exists || !snap.data().enabled) model.fail('태블릿 연결이 해제되었습니다. 관리자에게 다시 연결을 요청해 주세요.', 401);
    return serialize(snap);
  }
  async function listAdmin(month) {
    const range = model.monthRange(month);
    const [people, records, active, tablets] = await Promise.all([
      employees.get(), shifts.where('workDate', '>=', range.start).where('workDate', '<', range.end).get(),
      shifts.where('checkOutAt', '==', null).get(), devices.get()
    ]);
    return {
      employees: people.docs.map(serialize),
      shifts: records.docs.map(serialize).filter(s => !s.voided).map(s => ({ ...s, ...model.totals(s) })),
      openShifts: active.docs.map(serialize).filter(s => !s.voided),
      devices: tablets.docs.map(serialize).map(d => ({ id: d.id, name: d.name, enabled: d.enabled, createdAt: d.createdAt })),
      serverNow: now()
    };
  }
  async function saveEmployee(input, actor) {
    const data = model.employeeInput(input);
    const ref = input.id ? employees.doc(model.id(input.id)) : employees.doc();
    return db.runTransaction(async tx => {
      const snap = await tx.get(ref);
      const before = snap.exists ? serialize(snap) : null;
      if (input.id) { existing(snap, '직원'); revision(input, before); }
      if (before?.deletedAt) model.fail('삭제된 직원은 수정할 수 없습니다.');
      if (before?.currentShiftId && !data.active) model.fail('퇴근 처리 후 재직 상태를 변경해 주세요.');
      const after = { ...data, currentShiftId: before?.currentShiftId || null, lastShift: before?.lastShift || null,
        createdAt: before?.createdAt ?? now(), updatedAt: now(), deletedAt: null, version: (before?.version || 0) + 1 };
      tx.set(ref, after);
      log(tx, actor, 'employee.save', ref.id, before, after);
      return { id: ref.id };
    });
  }
  async function deleteEmployee(input, actor) {
    const ref = employees.doc(model.id(input.id));
    return db.runTransaction(async tx => {
      const before = existing(await tx.get(ref), '직원');
      revision(input, before);
      if (before.currentShiftId) model.fail('퇴근 처리 후 직원을 삭제해 주세요.');
      const after = { ...before, active: false, deletedAt: now(), version: before.version + 1, updatedAt: now() };
      tx.set(ref, after);
      log(tx, actor, 'employee.delete', ref.id, before, after);
      return { id: ref.id };
    });
  }
  async function createDevice(input, actor) {
    const name = model.text(input.name, '태블릿 이름', 50, true);
    const token = crypto.randomBytes(32).toString('hex');
    const ref = deviceRef(token);
    await db.runTransaction(async tx => {
      tx.create(ref, { name, enabled: true, createdAt: now(), createdBy: actor });
      log(tx, actor, 'device.create', ref.id, null, { name });
    });
    return { token, name };
  }
  async function revokeDevice(input, actor) {
    const ref = devices.doc(model.id(input.id));
    await db.runTransaction(async tx => {
      const before = existing(await tx.get(ref), '태블릿');
      tx.update(ref, { enabled: false, revokedAt: now() });
      log(tx, actor, 'device.revoke', ref.id, { name: before.name }, { enabled: false });
    });
    return {};
  }
  async function listKiosk(token) {
    const device = checkDevice(await deviceRef(token).get());
    const snap = await employees.where('active', '==', true).get();
    return { employees: snap.docs.map(serialize).filter(e => !e.deletedAt).map(model.kioskEmployee), deviceName: device.name, serverNow: now() };
  }
  async function authorizeDevice(token) {
    return checkDevice(await deviceRef(token).get()).id;
  }
  async function punch(input, token) {
    const tabletRef = deviceRef(token);
    const employeeRef = employees.doc(model.id(input.employeeId));
    const requestId = model.id(input.requestId);
    if (!['in', 'out'].includes(input.kind)) model.fail('출근 또는 퇴근을 선택해 주세요.');
    const expectedShiftId = input.kind === 'out' ? model.id(input.shiftId) : null;
    const requestRef = requests.doc(digest(`${tabletRef.id}:${requestId}`));
    const newShiftRef = shifts.doc();
    const payload = `${input.employeeId}:${input.kind}:${expectedShiftId || ''}`;
    return db.runTransaction(async tx => {
      const [tabletSnap, employeeSnap, requestSnap] = await Promise.all([tx.get(tabletRef), tx.get(employeeRef), tx.get(requestRef)]);
      checkDevice(tabletSnap);
      if (requestSnap.exists) {
        if (requestSnap.data().payload !== payload) model.fail('다른 요청에 사용된 기록 번호입니다.', 409);
        return requestSnap.data().result;
      }
      const employee = existing(employeeSnap, '직원');
      if (!employee.active || employee.deletedAt) model.fail('출퇴근 대상 직원이 아닙니다.', 409);
      const at = now();
      let ref, record;
      if (input.kind === 'in') {
        if (employee.currentShiftId) model.fail('이미 출근한 상태입니다. 화면을 새로고침해 주세요.', 409);
        ref = newShiftRef;
        record = { employeeId: employee.id, employeeName: employee.name, workDate: model.workDate(at),
          checkInAt: at, checkOutAt: null, payType: employee.payType, hourlyRate: employee.hourlyRate,
          breakMinutes: employee.breakMinutes, note: '', source: 'kiosk', deviceId: tabletRef.id,
          version: 1, voided: false, createdAt: at, updatedAt: at };
        // Employee document serializes concurrent punches and admin corrections.
        if (employee.lastShift && employee.lastShift.checkOutAt > at) model.fail('마지막 퇴근 이후에 출근해 주세요.', 409);
      } else {
        if (!employee.currentShiftId || employee.currentShiftId !== expectedShiftId) model.fail('근무 상태가 변경되었습니다. 화면을 새로고침해 주세요.', 409);
        ref = shifts.doc(employee.currentShiftId);
        const before = existing(await tx.get(ref), '출근 기록');
        if (before.voided || before.checkOutAt !== null) model.fail('이미 처리된 근무입니다.', 409);
        if (at - before.checkInAt > model.MAX_SHIFT_MS) model.fail('출근 후 36시간이 지났습니다. 관리자에게 시간 수정을 요청해 주세요.', 409);
        if (at <= before.checkInAt) model.fail('출근 시간 이후에 퇴근할 수 있습니다.', 409);
        record = { ...before, checkOutAt: at, updatedAt: at, version: before.version + 1 };
        if (record.breakMinutes > Math.floor((at - before.checkInAt) / model.MINUTE)) model.fail('설정된 휴게시간보다 근무시간이 짧습니다. 관리자에게 수정을 요청해 주세요.', 409);
      }
      const result = { kind: input.kind, employeeId: employee.id, name: employee.name, at, shiftId: ref.id };
      tx.set(ref, record);
      tx.update(employeeRef, { currentShiftId: input.kind === 'in' ? ref.id : null, lastShift: lastShift({ ...record, id: ref.id }), updatedAt: at });
      tx.create(requestRef, { payload, result, createdAt: at });
      log(tx, `device:${tabletRef.id}`, `punch.${input.kind}`, ref.id, null, result);
      return result;
    });
  }
  async function saveShift(input, actor, remove = false) {
    const ref = input.id ? shifts.doc(model.id(input.id)) : shifts.doc();
    if (remove && !input.id) model.fail('삭제할 기록을 선택해 주세요.');
    const data = remove ? null : model.shiftInput(input, now());
    return db.runTransaction(async tx => {
      const snap = await tx.get(ref);
      const before = snap.exists ? serialize(snap) : null;
      if (input.id) { existing(snap, '근무 기록'); revision(input, before); }
      if (before?.voided) model.fail('삭제된 기록입니다.', 409);
      const employeeId = before?.employeeId || model.id(input.employeeId);
      const employeeRef = employees.doc(employeeId);
      const [employeeSnap, recordsSnap] = await Promise.all([tx.get(employeeRef), tx.get(shifts.where('employeeId', '==', employeeId))]);
      const employee = existing(employeeSnap, '직원');
      if (!before && employee.deletedAt) model.fail('삭제된 직원에게 새 기록을 추가할 수 없습니다.');
      if (!remove && data.checkOutAt === null && (!employee.active || employee.deletedAt)) model.fail('재직 중인 직원만 근무 중으로 설정할 수 있습니다.');
      const others = recordsSnap.docs.map(serialize).filter(s => s.id !== ref.id && !s.voided);
      if (!remove && others.some(s => model.overlaps(data, s))) model.fail('이 직원의 다른 근무시간과 겹칩니다. 기존 기록을 확인해 주세요.', 409);
      const after = remove ? { ...before, voided: true, updatedAt: now(), version: before.version + 1 } : {
        ...before, ...data, employeeId, employeeName: before?.employeeName || employee.name,
        source: before?.source || 'admin', voided: false, createdAt: before?.createdAt ?? now(),
        updatedAt: now(), version: (before?.version || 0) + 1
      };
      const all = [...others, ...(!remove ? [{ ...after, id: ref.id }] : [])].sort((a, b) => b.checkInAt - a.checkInAt);
      const open = all.find(s => s.checkOutAt === null);
      tx.set(ref, after);
      tx.update(employeeRef, { currentShiftId: open?.id || null, lastShift: lastShift(all[0]), updatedAt: now() });
      log(tx, actor, remove ? 'shift.delete' : 'shift.save', ref.id, before, after);
      return { id: ref.id };
    });
  }
  return { listAdmin, saveEmployee, deleteEmployee, createDevice, revokeDevice, listKiosk, punch, saveShift, authorizeDevice };
}

function createAttendanceHandler({ service, verifyToken, logError = console.error }) {
  return async (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Attendance-Device');
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.set('Cache-Control', 'no-store');
    if (req.method === 'OPTIONS') return res.status(204).send('');
    if (req.method !== 'POST') return res.status(405).json({ error: 'POST 요청만 지원합니다.' });
    try {
      const input = req.body || {};
      let result;
      if (input.action === 'kiosk.list' || input.action === 'kiosk.punch') {
        const token = req.headers['x-attendance-device'];
        result = input.action === 'kiosk.list' ? await service.listKiosk(token) : await service.punch(input, token);
      } else {
        const token = String(req.headers.authorization || '').match(/^Bearer (.+)$/i)?.[1];
        if (!token) model.fail('관리자 로그인이 필요합니다.', 401);
        let user;
        try { user = await verifyToken(token); } catch (_) { model.fail('로그인이 만료되었습니다. 다시 로그인해 주세요.', 401); }
        if (user.email !== 'sun1562@naver.com') model.fail('관리자만 이용할 수 있습니다.', 403);
        switch (input.action) {
          case 'admin.list': result = await service.listAdmin(input.month); break;
          case 'employee.save': result = await service.saveEmployee(input, user.uid); break;
          case 'employee.delete': result = await service.deleteEmployee(input, user.uid); break;
          case 'shift.save': result = await service.saveShift(input, user.uid); break;
          case 'shift.delete': result = await service.saveShift(input, user.uid, true); break;
          case 'device.create': result = await service.createDevice(input, user.uid); break;
          case 'device.revoke': result = await service.revokeDevice(input, user.uid); break;
          default: model.fail('지원하지 않는 요청입니다.', 404);
        }
      }
      return res.status(200).json({ ok: true, ...result });
    } catch (error) {
      if (!error.status) logError('Attendance request failed', { code: error.code || 'internal' });
      return res.status(error.status || 500).json({ error: error.status ? error.message : '저장소에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.' });
    }
  };
}

module.exports = { createAttendanceService, createAttendanceHandler };
