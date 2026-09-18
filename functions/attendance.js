'use strict';

const crypto = require('crypto');
const model = require('./attendanceModel');
const privateData = require('./attendancePrivate');

// All attendance writes go through this service. Browser Firestore writes are denied.
function createAttendanceService({ db, now = Date.now, vault = privateData.createPrivateVault() }) {
  const employees = db.collection('staffEmployees');
  const privateEmployees = db.collection('staffPrivate');
  const shifts = db.collection('staffShifts');
  const devices = db.collection('attendanceDevices');
  const requests = db.collection('attendanceRequests');
  const audit = db.collection('attendanceAudit');
  const specialDays = db.collection('attendanceSpecialDays');
  const absences = db.collection('attendanceAbsences');
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
    const [people, records, active, tablets, holidays, offDays] = await Promise.all([
      employees.get(), shifts.where('workDate', '>=', range.start).where('workDate', '<', range.end).get(),
      shifts.where('checkOutAt', '==', null).get(), devices.get(),
      // 특수일은 조회 월 것만 읽으면 된다. 배율은 근무일 기준으로만 붙는다.
      specialDays.where('workDate', '>=', range.start).where('workDate', '<', range.end).get(),
      absences.where('workDate', '>=', range.start).where('workDate', '<', range.end).get()
    ]);
    const specialByDate = new Map(holidays.docs.map(serialize).map(d => [d.workDate, d]));
    return {
      employees: people.docs.map(serialize).map(e => ({ ...e, floor: model.floor(e.floor) })),
      shifts: records.docs.map(serialize).filter(s => !s.voided)
        .map(s => ({ ...s, floor: model.floor(s.floor), ...model.totals(s, specialByDate.get(s.workDate) || null) })),
      openShifts: active.docs.map(serialize).filter(s => !s.voided).map(s => ({ ...s, floor: model.floor(s.floor) })),
      devices: tablets.docs.map(serialize).map(d => ({ id: d.id, name: d.name, floor: model.floor(d.floor), version: d.version || 1, enabled: d.enabled, createdAt: d.createdAt })),
      specialDays: [...specialByDate.values()].sort((a, b) => a.workDate.localeCompare(b.workDate)),
      absences: offDays.docs.map(serialize).sort((a, b) => a.workDate.localeCompare(b.workDate)),
      serverNow: now()
    };
  }

  // 특수일은 날짜 하나에 하나만 둔다. 문서 id 를 날짜로 써서 같은 날이 둘 생길 수 없게 한다.
  async function saveSpecialDay(input, actor) {
    const data = model.specialDayInput(input);
    const ref = specialDays.doc(data.workDate);
    return db.runTransaction(async tx => {
      const snap = await tx.get(ref);
      const before = snap.exists ? serialize(snap) : null;
      if (before && input.version !== undefined) revision(input, before);
      const after = { ...data, createdAt: before?.createdAt ?? now(), updatedAt: now(), version: (before?.version || 0) + 1 };
      tx.set(ref, after);
      log(tx, actor, 'specialDay.save', ref.id, before, after);
      return { id: ref.id };
    });
  }

  async function deleteSpecialDay(input, actor) {
    const ref = specialDays.doc(model.workDateString(input.workDate, '날짜'));
    return db.runTransaction(async tx => {
      const before = existing(await tx.get(ref), '특수일');
      tx.delete(ref);
      log(tx, actor, 'specialDay.delete', ref.id, before, null);
      return { id: ref.id };
    });
  }

  // 결근도 직원·날짜당 하나다. 같은 날을 두 번 찍어 두 배로 깎이면 안 된다.
  async function saveAbsence(input, actor) {
    const data = model.absenceInput(input);
    const ref = absences.doc(`${data.employeeId}_${data.workDate}`);
    return db.runTransaction(async tx => {
      const [snap, employeeSnap] = await Promise.all([tx.get(ref), tx.get(employees.doc(data.employeeId))]);
      const employee = existing(employeeSnap, '직원');
      if (employee.deletedAt) model.fail('삭제된 직원에게는 결근을 표시할 수 없습니다.');
      const before = snap.exists ? serialize(snap) : null;
      if (before && input.version !== undefined) revision(input, before);
      const after = { ...data, employeeName: employee.name, floor: model.floor(employee.floor),
        createdAt: before?.createdAt ?? now(), updatedAt: now(), version: (before?.version || 0) + 1 };
      tx.set(ref, after);
      log(tx, actor, 'absence.save', ref.id, before, after);
      return { id: ref.id };
    });
  }

  async function deleteAbsence(input, actor) {
    const ref = absences.doc(model.id(input.id));
    return db.runTransaction(async tx => {
      const before = existing(await tx.get(ref), '결근 기록');
      tx.delete(ref);
      log(tx, actor, 'absence.delete', ref.id, before, null);
      return { id: ref.id };
    });
  }
  async function openShiftCount(tx, employeeId) {
    const snap = await tx.get(shifts.where('employeeId', '==', employeeId).where('checkOutAt', '==', null));
    return snap.docs.map(serialize).filter(s => !s.voided).length;
  }

  async function saveEmployee(input, actor) {
    const data = model.employeeInput(input);
    const details = input.privateDetails === undefined ? undefined : privateData.privateInput(input.privateDetails);
    const ref = input.id ? employees.doc(model.id(input.id)) : employees.doc();
    return db.runTransaction(async tx => {
      const snap = await tx.get(ref);
      const before = snap.exists ? serialize(snap) : null;
      if (input.id) { existing(snap, '직원'); revision(input, before); }
      if (before?.deletedAt) model.fail('삭제된 직원은 수정할 수 없습니다.');
      const floor = input.floor === undefined ? model.floor(before?.floor) : data.floor;
      // 일일근무자 자리는 currentShiftId 를 안 쓰므로 열린 기록을 직접 센다.
      // 사람이 들어와 있는데 자리를 내리면 그 사람이 퇴근을 못 찍는다.
      const working = before && model.isSharedSlot(before)
        ? (!data.active || floor !== model.floor(before.floor)) && await openShiftCount(tx, ref.id) > 0
        : Boolean(before?.currentShiftId);
      if (working && !data.active) model.fail('퇴근 처리 후 재직 상태를 변경해 주세요.');
      if (working && floor !== model.floor(before.floor)) model.fail('퇴근 처리 후 근무 매장을 변경해 주세요.');
      // An older admin screen can edit other fields without erasing a saved salary.
      const monthlySalary = data.payType === 'salaried' && input.monthlySalary === undefined && before?.payType === 'salaried'
        ? before.monthlySalary ?? null : data.monthlySalary;
      const after = { ...data, floor, monthlySalary,
        privateSummary: details ? privateData.privateSummary(details) : before?.privateSummary || privateData.privateSummary(privateData.empty()),
        currentShiftId: before?.currentShiftId || null, lastShift: before?.lastShift || null,
        createdAt: before?.createdAt ?? now(), updatedAt: now(), deletedAt: null, version: (before?.version || 0) + 1 };
      if (details) {
        if (Object.values(details).some(Boolean)) tx.set(privateEmployees.doc(ref.id), { encrypted: vault.seal(details, ref.id), updatedAt: now() });
        else tx.delete(privateEmployees.doc(ref.id));
      }
      tx.set(ref, after);
      log(tx, actor, 'employee.save', ref.id, before, after);
      return { id: ref.id };
    });
  }
  async function getEmployeePrivate(input, actor, bankOnly = false) {
    const id = model.id(input.id);
    return db.runTransaction(async tx => {
      const [employeeSnap, privateSnap] = await Promise.all([tx.get(employees.doc(id)), tx.get(privateEmployees.doc(id))]);
      const employee = existing(employeeSnap, '직원');
      if (employee.deletedAt) model.fail('삭제된 직원입니다.', 404);
      const details = vault.open(privateSnap.data()?.encrypted, id);
      log(tx, actor, bankOnly ? 'employee.bank.read' : 'employee.private.read', id, null, { accessed: true });
      return bankOnly ? { bankName: details.bankName, bankAccount: details.bankAccount, accountHolder: details.accountHolder }
        : { privateDetails: details, version: employee.version };
    });
  }
  async function deleteEmployee(input, actor) {
    const ref = employees.doc(model.id(input.id));
    return db.runTransaction(async tx => {
      const before = existing(await tx.get(ref), '직원');
      revision(input, before);
      const working = model.isSharedSlot(before) ? await openShiftCount(tx, ref.id) > 0 : Boolean(before.currentShiftId);
      if (working) model.fail('퇴근 처리 후 직원을 삭제해 주세요.');
      const after = { ...before, privateSummary: privateData.privateSummary(privateData.empty()), active: false, deletedAt: now(), version: before.version + 1, updatedAt: now() };
      tx.delete(privateEmployees.doc(ref.id));
      tx.set(ref, after);
      log(tx, actor, 'employee.delete', ref.id, before, after);
      return { id: ref.id };
    });
  }
  async function createDevice(input, actor) {
    const name = model.text(input.name, '태블릿 이름', 50, true);
    const floor = model.floor(input.floor);
    const token = crypto.randomBytes(32).toString('hex');
    const ref = deviceRef(token);
    await db.runTransaction(async tx => {
      tx.create(ref, { name, floor, version: 1, enabled: true, createdAt: now(), createdBy: actor });
      log(tx, actor, 'device.create', ref.id, null, { name, floor });
    });
    return { token, name, floor };
  }
  async function setDeviceFloor(input, actor) {
    const ref = devices.doc(model.id(input.id));
    const floor = model.integer(input.floor, '태블릿 매장', 1, 2);
    await db.runTransaction(async tx => {
      const before = checkDevice(await tx.get(ref));
      revision(input, { version: before.version || 1 });
      tx.update(ref, { floor, version: (before.version || 1) + 1, updatedAt: now() });
      log(tx, actor, 'device.floor', ref.id, { floor: model.floor(before.floor) }, { floor });
    });
    return { floor };
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
    const [snap, openSnap] = await Promise.all([
      employees.where('active', '==', true).get(),
      // 일일근무자 자리는 한 번에 여러 명이 쓴다. 누가 몇 시에 들어와 있는지
      // 태블릿에 보여줘야 각자 자기 것을 눌러 퇴근할 수 있다.
      shifts.where('checkOutAt', '==', null).get()
    ]);
    const floor = model.floor(device.floor);
    const people = snap.docs.map(serialize).filter(e => !e.deletedAt && model.floor(e.floor) === floor);
    const sharedIds = new Set(people.filter(model.isSharedSlot).map(e => e.id));
    const openBySlot = new Map();
    openSnap.docs.map(serialize).filter(s => !s.voided && sharedIds.has(s.employeeId)).forEach(s => {
      if (!openBySlot.has(s.employeeId)) openBySlot.set(s.employeeId, []);
      openBySlot.get(s.employeeId).push({ id: s.id, checkInAt: s.checkInAt, workerName: s.workerName || '' });
    });
    openBySlot.forEach(list => list.sort((a, b) => a.checkInAt - b.checkInAt));
    return {
      employees: people.map(e => ({ ...model.kioskEmployee(e), openShifts: openBySlot.get(e.id) || [] })),
      deviceName: device.name, floor, serverNow: now()
    };
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
      const tablet = checkDevice(tabletSnap);
      if (requestSnap.exists) {
        if (requestSnap.data().payload !== payload) model.fail('다른 요청에 사용된 기록 번호입니다.', 409);
        return requestSnap.data().result;
      }
      const employee = existing(employeeSnap, '직원');
      if (!employee.active || employee.deletedAt) model.fail('출퇴근 대상 직원이 아닙니다.', 409);
      if (model.floor(employee.floor) !== model.floor(tablet.floor)) model.fail('이 태블릿에 지정된 매장의 직원만 출퇴근할 수 있습니다. 목록을 새로고침해 주세요.', 403);
      const at = now();
      let ref, record;
      const shared = model.isSharedSlot(employee);
      // 일당으로 받는 사람은 자리(daily)와 정식 직원(perDiem) 둘 다다. 급여 계산은 같다.
      const dailyPaid = model.isDailyPaid(employee.payType);
      if (input.kind === 'in') {
        // 일일근무자 자리는 여러 사람이 같이 쓴다. 이미 누가 들어와 있어도 새로 찍을 수 있어야 한다.
        if (!shared && employee.currentShiftId) model.fail('이미 출근한 상태입니다. 화면을 새로고침해 주세요.', 409);
        ref = newShiftRef;
        record = { employeeId: employee.id, employeeName: employee.name, floor: model.floor(employee.floor), workDate: model.workDate(at),
          checkInAt: at, checkOutAt: null, payType: employee.payType, hourlyRate: employee.hourlyRate,
          // 월급 직원의 특수일 가산 기준. 출근 시점의 월급으로 고정한다.
          ordinaryHourlyRate: model.ordinaryHourlyRate(employee),
          // 일당과 반타임·초과 급여 조건은 출근 시점의 설정으로 고정한다.
          // 정산할 때 기록마다 고칠 수 있다.
          dailyPay: dailyPaid ? (employee.dailyPay || 0) : 0,
          halfDayPay: dailyPaid ? (employee.halfDayPay || 0) : 0,
          halfDayBeforeMinutes: dailyPaid ? (employee.halfDayBeforeMinutes || 0) : 0,
          dayPortion: 'auto',
          dailyBaseMinutes: dailyPaid ? (employee.dailyBaseMinutes || 0) : 0,
          overtimeUnitMinutes: dailyPaid ? (employee.overtimeUnitMinutes || 0) : 0,
          overtimePay: dailyPaid ? (employee.overtimePay || 0) : 0,
          withholding: dailyPaid ? Boolean(employee.withholding) : false,
          workerName: '', workerNote: '',
          breakMinutes: employee.breakMinutes, note: '', source: 'kiosk', deviceId: tabletRef.id,
          version: 1, voided: false, createdAt: at, updatedAt: at };
        // Employee document serializes concurrent punches and admin corrections.
        // 일일근무자 자리는 사람이 아니라 칸이라 이 순서 검사가 뜻이 없다.
        if (!shared && employee.lastShift && employee.lastShift.checkOutAt > at) model.fail('마지막 퇴근 이후에 출근해 주세요.', 409);
      } else {
        if (shared) {
          if (!expectedShiftId) model.fail('퇴근할 출근 기록을 선택해 주세요.', 409);
          ref = shifts.doc(expectedShiftId);
        } else {
          if (!employee.currentShiftId || employee.currentShiftId !== expectedShiftId) model.fail('근무 상태가 변경되었습니다. 화면을 새로고침해 주세요.', 409);
          ref = shifts.doc(employee.currentShiftId);
        }
        const before = existing(await tx.get(ref), '출근 기록');
        // 다른 자리의 기록을 지정해 퇴근시키지 못하게 한다.
        if (before.employeeId !== employee.id) model.fail('이 자리의 출근 기록이 아닙니다.', 409);
        if (before.voided || before.checkOutAt !== null) model.fail('이미 처리된 근무입니다.', 409);
        if (at - before.checkInAt > model.MAX_SHIFT_MS) model.fail('출근 후 36시간이 지났습니다. 관리자에게 시간 수정을 요청해 주세요.', 409);
        if (at <= before.checkInAt) model.fail('출근 시간 이후에 퇴근할 수 있습니다.', 409);
        record = { ...before, checkOutAt: at, updatedAt: at, version: before.version + 1 };
        // 이 기능이 붙기 전에 출근한 기록에는 통상시급이 없다. 퇴근할 때 채워 준다.
        // 없는 채로 두면 그날이 특수일이어도 가산이 0으로 계산된다.
        if (before.payType === 'salaried' && !before.ordinaryHourlyRate) record.ordinaryHourlyRate = model.ordinaryHourlyRate(employee);
        if (record.breakMinutes > Math.floor((at - before.checkInAt) / model.MINUTE)) model.fail('설정된 휴게시간보다 근무시간이 짧습니다. 관리자에게 수정을 요청해 주세요.', 409);
      }
      const result = { kind: input.kind, employeeId: employee.id, name: employee.name, at, shiftId: ref.id };
      tx.set(ref, record);
      // 일일근무자 자리는 '지금 누가 들어와 있다'를 한 칸으로 표현할 수 없다.
      // 열린 기록은 목록에서 직접 읽는다.
      tx.update(employeeRef, {
        currentShiftId: shared ? null : (input.kind === 'in' ? ref.id : null),
        lastShift: lastShift({ ...record, id: ref.id }), updatedAt: at
      });
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
      const dailyPaidShift = !remove && model.isDailyPaid(data.payType);
      const others = recordsSnap.docs.map(serialize).filter(s => s.id !== ref.id && !s.voided);
      // 일일근무자 자리는 여러 사람이 같은 시간에 일하는 것이 정상이다. 겹침은 오류가 아니다.
      if (!remove && !model.isSharedSlot(employee) && others.some(s => model.overlaps(data, s))) {
        model.fail('이 직원의 다른 근무시간과 겹칩니다. 기존 기록을 확인해 주세요.', 409);
      }
      const after = remove ? { ...before, voided: true, updatedAt: now(), version: before.version + 1 } : {
        ...before, ...data, employeeId, employeeName: before?.employeeName || employee.name,
        floor: model.floor(before ? before.floor : employee.floor),
        // 관리자 화면은 통상시급을 따로 묻지 않는다. 저장 시점의 직원 설정에서 낸다.
        // 이미 값이 있는 기록은 그때 값을 지킨다. 시급과 같은 원칙이다.
        ordinaryHourlyRate: data.payType === 'salaried'
          ? (before?.ordinaryHourlyRate || model.ordinaryHourlyRate(employee)) : 0,
        // 일당을 비우고 저장하면 설정의 기본 일당을 쓴다. 0원으로 저장돼 급여가 빠지면 안 된다.
        dailyPay: dailyPaidShift
          ? (data.dailyPay || before?.dailyPay || employee.dailyPay || 0) : 0,
        // 반타임 일당은 0 이 '안 씀' 이라는 뜻이라, 입력이 아예 없을 때만 물려받는다.
        halfDayPay: dailyPaidShift
          ? (input.halfDayPay === undefined ? (before?.halfDayPay ?? employee.halfDayPay ?? 0) : data.halfDayPay) : 0,
        // 나머지 조건은 화면이 안 보낸 값을 기존 기록 → 직원 설정 순서로 따라간다.
        // shiftInput 이 이미 기본값(오후 5시·8시간·30분)을 채워두기 때문에, 보냈는지 여부는
        // 다듬어진 data 가 아니라 원래 input 으로 가려야 설정이 안 덮인다.
        halfDayBeforeMinutes: dailyPaidShift
          ? (input.halfDayBeforeMinutes !== undefined ? data.halfDayBeforeMinutes
            : (before?.halfDayBeforeMinutes || employee.halfDayBeforeMinutes || data.halfDayBeforeMinutes)) : 0,
        dayPortion: dailyPaidShift
          ? (input.dayPortion !== undefined ? data.dayPortion : (before?.dayPortion || 'auto')) : 'auto',
        dailyBaseMinutes: dailyPaidShift
          ? (input.dailyBaseMinutes !== undefined ? data.dailyBaseMinutes
            : (before?.dailyBaseMinutes || employee.dailyBaseMinutes || data.dailyBaseMinutes)) : 0,
        overtimeUnitMinutes: dailyPaidShift
          ? (input.overtimeUnitMinutes !== undefined ? data.overtimeUnitMinutes
            : (before?.overtimeUnitMinutes || employee.overtimeUnitMinutes || data.overtimeUnitMinutes)) : 0,
        // 추가 급여는 0 이 '안 줌' 이라는 뜻이라, 입력이 아예 없을 때만 물려받는다.
        overtimePay: dailyPaidShift
          ? (input.overtimePay === undefined ? (before?.overtimePay ?? employee.overtimePay ?? 0) : data.overtimePay) : 0,
        // 체크를 푼 것과 화면이 안 보낸 것은 다르다. 안 보냈을 때만 물려받는다.
        withholding: dailyPaidShift
          ? (input.withholding === undefined ? Boolean(before?.withholding ?? employee.withholding) : data.withholding) : false,
        source: before?.source || 'admin', voided: false, createdAt: before?.createdAt ?? now(),
        updatedAt: now(), version: (before?.version || 0) + 1
      };
      const all = [...others, ...(!remove ? [{ ...after, id: ref.id }] : [])].sort((a, b) => b.checkInAt - a.checkInAt);
      const open = all.find(s => s.checkOutAt === null);
      tx.set(ref, after);
      tx.update(employeeRef, {
        currentShiftId: model.isSharedSlot(employee) ? null : (open?.id || null),
        lastShift: lastShift(all[0]), updatedAt: now()
      });
      log(tx, actor, remove ? 'shift.delete' : 'shift.save', ref.id, before, after);
      return { id: ref.id };
    });
  }
  return { listAdmin, saveEmployee, getEmployeePrivate, deleteEmployee, createDevice, setDeviceFloor, revokeDevice, listKiosk, punch, saveShift, authorizeDevice, saveSpecialDay, deleteSpecialDay, saveAbsence, deleteAbsence };
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
          case 'employee.private': result = await service.getEmployeePrivate(input, user.uid); break;
          case 'employee.bank': result = await service.getEmployeePrivate(input, user.uid, true); break;
          case 'employee.delete': result = await service.deleteEmployee(input, user.uid); break;
          case 'shift.save': result = await service.saveShift(input, user.uid); break;
          case 'shift.delete': result = await service.saveShift(input, user.uid, true); break;
          case 'device.create': result = await service.createDevice(input, user.uid); break;
          case 'device.floor': result = await service.setDeviceFloor(input, user.uid); break;
          case 'device.revoke': result = await service.revokeDevice(input, user.uid); break;
          case 'specialDay.save': result = await service.saveSpecialDay(input, user.uid); break;
          case 'specialDay.delete': result = await service.deleteSpecialDay(input, user.uid); break;
          case 'absence.save': result = await service.saveAbsence(input, user.uid); break;
          case 'absence.delete': result = await service.deleteAbsence(input, user.uid); break;
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
