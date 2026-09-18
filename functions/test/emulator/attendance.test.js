'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { createAttendanceService } = require('../../attendance');
const projectId = 'demo-gjsuragan-attendance';
let app, db, service, now, employeeId, token, deviceId;
const at = value => new Date(value).getTime();
const hour = 3600000;
const employeeInput = { name: '테스트 직원', role: '포장', active: true, payType: 'hourly', hourlyRate: 12000, breakMinutes: 0, note: '급여 메모 비공개' };
const getEmployee = async () => ({ ...(await db.collection('staffEmployees').doc(employeeId).get()).data(), id: employeeId });
const getShift = async id => ({ ...(await db.collection('staffShifts').doc(id).get()).data(), id });
const punch = (kind, requestId, shiftId) => service.punch({ employeeId, kind, requestId, shiftId }, token);

test.before(() => {
  assert.ok(process.env.FIRESTORE_EMULATOR_HOST, 'must use local Firestore Emulator');
  app = initializeApp({ projectId }, `attendance-${Date.now()}`); db = getFirestore(app);
});
test.after(async () => { await deleteApp(app); });
test.beforeEach(async () => {
  await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${projectId}/databases/(default)/documents`, { method: 'DELETE' });
  now = at('2026-09-10T09:00:00+09:00');
  service = createAttendanceService({ db, now: () => now,
    vault: require('../../attendancePrivate').createPrivateVault(() => Buffer.alloc(32, 7).toString('base64')) });
  employeeId = (await service.saveEmployee(employeeInput, 'admin')).id;
  token = (await service.createDevice({ name: '테스트 태블릿' }, 'admin')).token;
  deviceId = (await service.listAdmin('2026-09')).devices[0].id;
});
test('concurrent punches and response retries create one shift and one checkout', async () => {
  const attempts = await Promise.allSettled([punch('in', 'first'), punch('in', 'second')]);
  assert.equal(attempts.filter(r => r.status === 'fulfilled').length, 1);
  const result = attempts.find(r => r.status === 'fulfilled').value;
  assert.equal((await db.collection('staffShifts').get()).size, 1);
  now += 8 * hour;
  const out = await Promise.all([punch('out', 'same-out', result.shiftId), punch('out', 'same-out', result.shiftId)]);
  assert.deepEqual(out[0], out[1]);
  assert.equal((await getEmployee()).currentShiftId, null);
  assert.equal((await service.listAdmin('2026-09')).shifts[0].amount, 96000);
});
test('retry after a lost response is idempotent even after the next shift begins', async () => {
  const first = await punch('in', 'a'); now += hour;
  const out = await punch('out', 'b', first.shiftId); now += hour;
  const second = await punch('in', 'c');
  assert.deepEqual(await punch('out', 'b', first.shiftId), out);
  assert.equal((await getEmployee()).currentShiftId, second.shiftId);
  await assert.rejects(punch('out', 'd', first.shiftId), { status: 409 });
  await assert.rejects(punch('in', 'b'), { status: 409 });
});
test('wage changes apply to next shift, payroll keeps snapshot and deleted employee history', async () => {
  const first = await punch('in', 'a'); now += 8 * hour;
  await service.saveEmployee({ ...(await getEmployee()), hourlyRate: 15000 }, 'admin');
  await punch('out', 'b', first.shiftId); now += hour;
  const second = await punch('in', 'c'); now += 2 * hour;
  await punch('out', 'd', second.shiftId);
  await service.deleteEmployee(await getEmployee(), 'admin');
  const report = await service.listAdmin('2026-09');
  assert.equal(report.shifts.reduce((sum, s) => sum + s.amount, 0), 126000);
  assert.equal(report.shifts.find(s => s.id === first.shiftId).hourlyRate, 12000);
  assert.equal((await service.listKiosk(token)).employees.length, 0);
  assert.equal(report.employees.length, 1);
});
test('overnight month boundary belongs to clock-in month and open shifts stay discoverable', async () => {
  now = at('2026-08-31T22:00:00+09:00');
  const input = await punch('in', 'night'); now += 8 * hour;
  const september = await service.listAdmin('2026-09');
  assert.equal(september.shifts.length, 0); assert.equal(september.openShifts.length, 1);
  await punch('out', 'morning', input.shiftId);
  assert.equal((await service.listAdmin('2026-08')).shifts[0].amount, 96000);
});
test('corrections recalculate pay, reject stale edits and repair kiosk state', async () => {
  const input = await punch('in', 'a'); now += 9 * hour;
  const before = await getShift(input.shiftId);
  await service.saveShift({ ...before, checkOutAt: now, breakMinutes: 60, note: '퇴근 누락' }, 'admin');
  assert.equal((await getEmployee()).currentShiftId, null);
  assert.equal((await service.listAdmin('2026-09')).shifts[0].amount, 96000);
  await assert.rejects(service.saveShift({ ...before, checkOutAt: now }, 'admin'), { status: 409 });
  const saved = await getShift(input.shiftId);
  await service.saveShift({ ...saved, checkOutAt: null }, 'admin');
  assert.equal((await getEmployee()).currentShiftId, input.shiftId);
  await service.saveShift(await getShift(input.shiftId), 'admin', true);
  assert.equal((await getEmployee()).currentShiftId, null);
  assert.equal((await service.listAdmin('2026-09')).shifts.length, 0);
  assert.ok((await db.collection('attendanceAudit').get()).size >= 5);
});
test('overlapping corrections and manual additions are rejected, adjacent shifts work', async () => {
  const first = await punch('in', 'a'); now += 4 * hour;
  await punch('out', 'b', first.shiftId); now += 4 * hour;
  const old = await getShift(first.shiftId);
  await assert.rejects(service.saveShift({ ...old, id: undefined, checkInAt: old.checkInAt + hour, checkOutAt: now }, 'admin'), { status: 409 });
  const next = await service.saveShift({ ...old, id: undefined, checkInAt: old.checkOutAt, checkOutAt: now }, 'admin');
  await assert.rejects(service.saveShift({ ...old, checkOutAt: now }, 'admin'), { status: 409 });
  assert.ok(next.id);
});
test('inactive employees cannot punch, and active shifts must finish before deletion', async () => {
  await punch('in', 'a');
  await assert.rejects(service.deleteEmployee(await getEmployee(), 'admin'), { status: 400 });
  await assert.rejects(service.saveEmployee({ ...(await getEmployee()), active: false }, 'admin'), { status: 400 });
});
test('revoked and unknown devices fail before reading or writing attendance', async () => {
  await service.authorizeDevice(token);
  assert.equal((await service.listKiosk(token)).employees[0].hourlyRate, undefined);
  await service.revokeDevice({ id: deviceId }, 'admin');
  await assert.rejects(service.authorizeDevice(token), { status: 401 });
  await assert.rejects(service.authorizeDevice('0'.repeat(64)), { status: 401 });
  await assert.rejects(service.listKiosk(token), { status: 401 });
  await assert.rejects(punch('in', 'x'), { status: 401 });
  await assert.rejects(service.listKiosk('0'.repeat(64)), { status: 401 });
  assert.equal((await db.collection('staffShifts').get()).size, 0);
});
test('a long forgotten shift cannot silently generate pay on kiosk checkout', async () => {
  const input = await punch('in', 'a'); now += 37 * hour;
  await assert.rejects(punch('out', 'b', input.shiftId), { status: 409 });
  assert.equal((await service.listAdmin('2026-09')).shifts[0].amount, 0);
});

test('admin correction racing with kiosk checkout cannot overwrite the winning record', async () => {
  const input = await punch('in', 'a'); now += 8 * hour;
  const original = await getShift(input.shiftId);
  const results = await Promise.allSettled([
    service.saveShift({ ...original, checkOutAt: now - hour, note: '관리자 보정' }, 'admin'),
    punch('out', 'b', input.shiftId)
  ]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal((await getEmployee()).currentShiftId, null);
  assert.equal((await getShift(input.shiftId)).version, 2);
});

test('employee edits reject stale versions and device input cannot spoof time or wage', async () => {
  const old = await getEmployee();
  await service.saveEmployee({ ...old, hourlyRate: 13000 }, 'admin');
  await assert.rejects(service.saveEmployee({ ...old, name: '늦은 수정' }, 'admin'), { status: 409 });
  const result = await service.punch({ employeeId, kind: 'in', requestId: 'spoof', checkInAt: now - hour, hourlyRate: 999999 }, token);
  assert.equal((await getShift(result.shiftId)).checkInAt, now);
  assert.equal((await getShift(result.shiftId)).hourlyRate, 13000);
});

test('each tablet lists and punches only its assigned floor, including forged floor input', async () => {
  const second = await service.saveEmployee({ ...employeeInput, name: '2층 직원', floor: 2 }, 'admin');
  const upstairs = await service.createDevice({ name: '2층 태블릿', floor: 2 }, 'admin');
  assert.deepEqual((await service.listKiosk(token)).employees.map(e => e.id), [employeeId]);
  assert.equal((await service.listKiosk(upstairs.token)).floor, 2);
  assert.deepEqual((await service.listKiosk(upstairs.token)).employees.map(e => e.id), [second.id]);
  await assert.rejects(service.punch({ employeeId: second.id, kind: 'in', requestId: 'wrong-floor', floor: 2 }, token), { status: 403 });
  await assert.rejects(service.punch({ employeeId, kind: 'in', requestId: 'other-floor', floor: 1 }, upstairs.token), { status: 403 });
  const record = await service.punch({ employeeId: second.id, kind: 'in', requestId: 'upstairs-in', floor: 1 }, upstairs.token);
  assert.equal((await getShift(record.shiftId)).floor, 2);
  now += hour;
  await assert.rejects(service.punch({ employeeId: second.id, kind: 'out', shiftId: record.shiftId, requestId: 'wrong-out' }, token), { status: 403 });
  await service.punch({ employeeId: second.id, kind: 'out', shiftId: record.shiftId, requestId: 'upstairs-out' }, upstairs.token);
  assert.equal((await service.listAdmin('2026-09')).shifts[0].amount, 12000);
});

test('floor transfers preserve completed history and old clients cannot erase the assigned floor', async () => {
  const first = await punch('in', 'before-transfer');
  await assert.rejects(service.saveEmployee({ ...(await getEmployee()), floor: 2 }, 'admin'), { status: 400 });
  now += hour; await punch('out', 'complete-first-floor', first.shiftId);
  await service.saveEmployee({ ...(await getEmployee()), floor: 2 }, 'admin');
  assert.equal((await service.listKiosk(token)).employees.length, 0);
  const { floor: _floor, ...oldClient } = await getEmployee();
  await service.saveEmployee({ ...oldClient, name: '새 이름' }, 'admin');
  assert.equal((await getEmployee()).floor, 2);
  const prior = await getShift(first.shiftId);
  await service.saveShift({ ...prior, note: '이동 후 과거 기록 수정', floor: 2 }, 'admin');
  assert.equal((await getShift(first.shiftId)).floor, 1);
  now += hour;
  const next = await service.saveShift({ employeeId, checkInAt: now - hour, checkOutAt: now, breakMinutes: 0, payType: 'hourly', hourlyRate: 12000, note: '', floor: 1 }, 'admin');
  assert.equal((await getShift(next.id)).floor, 2);
  assert.deepEqual((await service.listAdmin('2026-09')).shifts.map(s => s.floor).sort(), [1, 2]);
});

test('existing tablets can change floor with conflict detection and legacy defaults need no migration', async () => {
  const { FieldValue } = require('firebase-admin/firestore');
  await db.collection('staffEmployees').doc(employeeId).update({ floor: FieldValue.delete() });
  await db.collection('attendanceDevices').doc(deviceId).update({ floor: FieldValue.delete(), version: FieldValue.delete() });
  assert.equal((await service.listKiosk(token)).floor, 1);
  assert.equal((await service.listAdmin('2026-09')).employees[0].floor, 1);
  const second = await service.saveEmployee({ ...employeeInput, floor: 2 }, 'admin');
  await service.setDeviceFloor({ id: deviceId, version: 1, floor: 2 }, 'admin');
  assert.deepEqual((await service.listKiosk(token)).employees.map(e => e.id), [second.id]);
  await assert.rejects(service.setDeviceFloor({ id: deviceId, version: 1, floor: 1 }, 'admin'), { status: 409 });
  await assert.rejects(service.setDeviceFloor({ id: deviceId, version: 2, floor: 3 }, 'admin'), { status: 400 });
  await assert.rejects(punch('in', 'old-screen'), { status: 403 });
  await service.revokeDevice({ id: deviceId }, 'admin');
  await assert.rejects(service.setDeviceFloor({ id: deviceId, version: 2, floor: 1 }, 'admin'), { status: 401 });
});

test('monthly salary persists through old-client edits and never becomes hourly pay or kiosk data', async () => {
  await service.saveEmployee({ ...(await getEmployee()), payType: 'salaried', monthlySalary: 3000000 }, 'admin');
  assert.equal((await service.listAdmin('2026-09')).employees[0].monthlySalary, 3000000);
  const { monthlySalary: _salary, ...olderForm } = await getEmployee();
  await service.saveEmployee({ ...olderForm, role: '홀' }, 'admin');
  assert.equal((await getEmployee()).monthlySalary, 3000000);
  assert.equal((await getEmployee()).hourlyRate, 0);
  assert.equal((await service.listKiosk(token)).employees[0].monthlySalary, undefined);
  const first = await punch('in', 'salary-first'); now += 8 * hour; await punch('out', 'salary-out', first.shiftId);
  await service.saveEmployee({ ...(await getEmployee()), monthlySalary: 3200000 }, 'admin');
  now += hour; const second = await punch('in', 'salary-second'); now += hour; await punch('out', 'salary-out-again', second.shiftId);
  const report = await service.listAdmin('2026-09');
  assert.equal(report.employees[0].monthlySalary, 3200000);
  assert.equal(report.shifts.reduce((sum, shift) => sum + shift.amount, 0), 0, 'monthly salary is not added once per shift');
  assert.equal(report.shifts.reduce((sum, shift) => sum + shift.payableMinutes, 0), 540);
  assert.equal((await getShift(first.shiftId)).hourlyRate, 0);
  await service.saveEmployee({ ...(await getEmployee()), payType: 'hourly', hourlyRate: 12000 }, 'admin');
  assert.equal((await getEmployee()).monthlySalary, null);
  assert.equal((await getEmployee()).hourlyRate, 12000);
  assert.equal((await getShift(first.shiftId)).payType, 'salaried');
});

test('unset existing monthly employees remain editable and reject invalid explicit amounts', async () => {
  const legacy = await service.saveEmployee({ ...employeeInput, payType: 'salaried', hourlyRate: 0 }, 'admin');
  const current = { ...(await db.collection('staffEmployees').doc(legacy.id).get()).data(), id: legacy.id };
  assert.equal(current.monthlySalary, null);
  await assert.rejects(service.saveEmployee({ ...current, monthlySalary: 0 }, 'admin'), { status: 400 });
  await service.saveEmployee({ ...current, monthlySalary: 2800000 }, 'admin');
  assert.equal((await db.collection('staffEmployees').doc(legacy.id).get()).data().monthlySalary, 2800000);
});

test('private staff details stay encrypted, preserve old-client edits, and are removed on deletion', async () => {
  const details = { residentNumber: '9001011234567', bankName: '테스트은행', bankAccount: '001234567890', accountHolder: '가상 직원' };
  await service.saveEmployee({ ...(await getEmployee()), privateDetails: details }, 'admin');
  const raw = (await db.collection('staffPrivate').doc(employeeId).get()).data();
  assert.ok(raw.encrypted.data);
  const read = await service.getEmployeePrivate({ id: employeeId }, 'admin');
  assert.deepEqual(read.privateDetails, details);
  const bank = await service.getEmployeePrivate({ id: employeeId }, 'admin', true);
  assert.equal(bank.bankAccount, details.bankAccount);
  assert.equal(bank.residentNumber, undefined);
  await service.saveEmployee({ ...(await getEmployee()), role: '변경된 업무' }, 'admin');
  assert.deepEqual((await service.getEmployeePrivate({ id: employeeId }, 'admin')).privateDetails, details);
  const publicValues = JSON.stringify([raw, await getEmployee(), await service.listAdmin('2026-09'), await service.listKiosk(token), (await db.collection('attendanceAudit').get()).docs.map(d => d.data())]);
  for (const value of [details.residentNumber, details.bankAccount]) assert.ok(!publicValues.includes(value), 'plaintext identifiers excluded from lists and logs');
  assert.equal((await service.listKiosk(token)).employees[0].privateSummary, undefined);
  const version = (await getEmployee()).version;
  await assert.rejects(service.saveEmployee({ ...(await getEmployee()), version: version - 1, privateDetails: { ...details, bankAccount: '999999999999' } }, 'admin'), { status: 409 });
  assert.deepEqual((await service.getEmployeePrivate({ id: employeeId }, 'admin')).privateDetails, details);
  await service.deleteEmployee(await getEmployee(), 'admin');
  assert.equal((await db.collection('staffPrivate').doc(employeeId).get()).exists, false);
  await assert.rejects(service.getEmployeePrivate({ id: employeeId }, 'admin'), { status: 404 });
});

test('clearing private fields deletes the encrypted document and invalid input saves nothing', async () => {
  const details = { residentNumber: '', bankName: '테스트은행', bankAccount: '001234567890', accountHolder: '' };
  await service.saveEmployee({ ...(await getEmployee()), privateDetails: details }, 'admin');
  const before = await getEmployee();
  await assert.rejects(service.saveEmployee({ ...before, name: '변경 안 됨', privateDetails: { ...details, residentNumber: '123' } }, 'admin'), { status: 400 });
  assert.equal((await getEmployee()).name, before.name);
  await service.saveEmployee({ ...before, privateDetails: { residentNumber: '', bankName: '', bankAccount: '', accountHolder: '' } }, 'admin');
  assert.equal((await db.collection('staffPrivate').doc(employeeId).get()).exists, false);
  assert.equal((await getEmployee()).privateSummary.bankLast4, '');
});

// ── 일일근무자 자리 ──
// 사람이 아니라 칸이다. 한 칸을 여러 사람이 같은 날 같이 쓴다.
const slotInput = { name: '일일근무자 (홀)', role: '홀', active: true, payType: 'daily', dailyPay: 100000, breakMinutes: 0, note: '' };
const makeSlot = async () => (await service.saveEmployee(slotInput, 'admin')).id;

test('한 자리에 여러 사람이 동시에 출근하고 각자 자기 기록으로 퇴근한다', async () => {
  const slotId = await makeSlot();
  const punchSlot = (kind, requestId, shiftId) => service.punch({ employeeId: slotId, kind, requestId, shiftId }, token);
  // 보통 직원이라면 두 번째 출근이 막힌다. 자리는 둘 다 들어가야 한다.
  const first = await punchSlot('in', 'a');
  now += 10 * 60000;
  const second = await punchSlot('in', 'b');
  assert.notEqual(first.shiftId, second.shiftId);
  assert.equal((await db.collection('staffShifts').where('employeeId', '==', slotId).get()).size, 2);
  // 자리에는 '지금 근무 중인 한 명'을 물리지 않는다.
  assert.equal((await db.collection('staffEmployees').doc(slotId).get()).data().currentShiftId, null);

  // 태블릿에는 출근 칸 하나가 아니라 들어와 있는 사람이 전부 보여야 한다.
  const kiosk = await service.listKiosk(token);
  const slotCard = kiosk.employees.find(e => e.id === slotId);
  assert.equal(slotCard.payType, 'daily');
  assert.equal(slotCard.openShifts.length, 2);
  assert.deepEqual(slotCard.openShifts.map(s => s.id).sort(), [first.shiftId, second.shiftId].sort());

  // 각자 자기 기록을 지정해 퇴근한다.
  now += 8 * hour;
  await punchSlot('out', 'a-out', first.shiftId);
  assert.equal((await service.listKiosk(token)).employees.find(e => e.id === slotId).openShifts.length, 1);
  now += hour;
  await punchSlot('out', 'b-out', second.shiftId);
  const report = await service.listAdmin('2026-09');
  const shifts = report.shifts.filter(s => s.employeeId === slotId);
  assert.equal(shifts.length, 2);
  // 일당은 시간과 무관하게 기록마다 하루치.
  assert.deepEqual(shifts.map(s => s.amount), [100000, 100000]);
});

test('다른 자리의 기록으로는 퇴근시킬 수 없다', async () => {
  const slotId = await makeSlot();
  const mine = await service.punch({ employeeId: slotId, kind: 'in', requestId: 'mine' }, token);
  now += hour;
  await assert.rejects(
    service.punch({ employeeId, kind: 'out', requestId: 'steal', shiftId: mine.shiftId }, token),
    /이 자리의 출근 기록이 아닙니다|근무 상태가 변경/
  );
});

test('사람이 들어와 있는 자리는 내리거나 지울 수 없다', async () => {
  const slotId = await makeSlot();
  await service.punch({ employeeId: slotId, kind: 'in', requestId: 'in' }, token);
  const slot = async () => ({ ...(await db.collection('staffEmployees').doc(slotId).get()).data(), id: slotId });
  // currentShiftId 가 안 물리므로 열린 기록을 직접 세야 잡힌다.
  await assert.rejects(service.saveEmployee({ ...(await slot()), active: false }, 'admin'), /퇴근 처리 후/);
  await assert.rejects(service.deleteEmployee({ id: slotId, version: (await slot()).version }, 'admin'), /퇴근 처리 후/);
  // 퇴근하면 풀린다.
  now += hour;
  const open = (await service.listKiosk(token)).employees.find(e => e.id === slotId).openShifts[0];
  await service.punch({ employeeId: slotId, kind: 'out', requestId: 'out', shiftId: open.id }, token);
  await service.saveEmployee({ ...(await slot()), active: false }, 'admin');
  assert.equal((await slot()).active, false);
});

test('같은 자리의 겹치는 근무는 오류가 아니다', async () => {
  const slotId = await makeSlot();
  const base = { employeeId: slotId, payType: 'daily', dailyPay: 100000, breakMinutes: 0, note: '',
    checkInAt: at('2026-09-10T09:00:00+09:00'), checkOutAt: at('2026-09-10T18:00:00+09:00') };
  now = at('2026-09-11T09:00:00+09:00');
  await service.saveShift({ ...base, workerName: '김일손' }, 'admin');
  // 보통 직원이라면 겹친다고 막힌다. 자리는 둘 다 들어가야 한다.
  await service.saveShift({ ...base, workerName: '이일손', dailyPay: 120000 }, 'admin');
  const shifts = (await service.listAdmin('2026-09')).shifts.filter(s => s.employeeId === slotId);
  assert.equal(shifts.length, 2);
  assert.deepEqual(shifts.map(s => s.workerName).sort(), ['김일손', '이일손']);
  // 사람마다 다른 금액을 줄 수 있다.
  assert.deepEqual(shifts.map(s => s.amount).sort((a, b) => a - b), [100000, 120000]);
});

test('일당을 비우고 저장하면 자리의 기본 일당을 쓴다', async () => {
  const slotId = await makeSlot();
  now = at('2026-09-11T09:00:00+09:00');
  const saved = await service.saveShift({ employeeId: slotId, payType: 'daily', breakMinutes: 0, note: '',
    checkInAt: at('2026-09-10T09:00:00+09:00'), checkOutAt: at('2026-09-10T18:00:00+09:00') }, 'admin');
  assert.equal((await getShift(saved.id)).dailyPay, 100000);
});

test('초과 급여 조건과 3.3% 체크가 출근 기록에 그대로 실린다', async () => {
  const slotId = (await service.saveEmployee({ ...slotInput, dailyBaseMinutes: 360, overtimeUnitMinutes: 60, overtimePay: 15000, withholding: true }, 'admin')).id;
  const first = await service.punch({ employeeId: slotId, kind: 'in', requestId: 'in' }, token);
  const saved = await getShift(first.shiftId);
  assert.equal(saved.dailyPay, 100000);
  assert.equal(saved.dailyBaseMinutes, 360);
  assert.equal(saved.overtimeUnitMinutes, 60);
  assert.equal(saved.overtimePay, 15000);
  assert.equal(saved.withholding, true);
  // 유급 8시간 → 기준 6시간 초과 2시간 → 1시간 단위 2회 → 30,000원
  now += 8 * hour;
  await service.punch({ employeeId: slotId, kind: 'out', requestId: 'out', shiftId: first.shiftId }, token);
  const shift = (await service.listAdmin('2026-09')).shifts.find(s => s.id === first.shiftId);
  assert.equal(shift.extraAmount, 30000);
  assert.equal(shift.amount, 130000);
});

test('관리자가 기록을 고쳐도 자리의 초과 급여 조건이 기본값으로 안 되돌아간다', async () => {
  // shiftInput 이 8시간·30분을 기본으로 채우므로, 화면이 안 보낸 값은 자리 설정을 따라야 한다.
  const slotId = (await service.saveEmployee({ ...slotInput, dailyBaseMinutes: 360, overtimeUnitMinutes: 60, overtimePay: 15000, withholding: true }, 'admin')).id;
  now = at('2026-09-11T09:00:00+09:00');
  const saved = await service.saveShift({ employeeId: slotId, payType: 'daily', breakMinutes: 0, note: '', workerName: '김일손',
    checkInAt: at('2026-09-10T09:00:00+09:00'), checkOutAt: at('2026-09-10T17:00:00+09:00') }, 'admin');
  const shift = await getShift(saved.id);
  assert.equal(shift.dailyBaseMinutes, 360, '기준 근무시간이 8시간으로 되돌아갔습니다');
  assert.equal(shift.overtimeUnitMinutes, 60);
  assert.equal(shift.overtimePay, 15000);
  assert.equal(shift.withholding, true);
});

test('기록마다 초과 급여와 3.3% 를 다르게 정할 수 있다', async () => {
  const slotId = (await service.saveEmployee({ ...slotInput, overtimePay: 10000, withholding: true }, 'admin')).id;
  now = at('2026-09-11T09:00:00+09:00');
  const base = { employeeId: slotId, payType: 'daily', breakMinutes: 0, note: '',
    checkInAt: at('2026-09-10T09:00:00+09:00'), checkOutAt: at('2026-09-10T18:00:00+09:00') };
  const a = await service.saveShift({ ...base, workerName: '김일손' }, 'admin');
  const b = await service.saveShift({ ...base, workerName: '이일손', withholding: false, overtimePay: 0, dailyPay: 120000 }, 'admin');
  assert.equal((await getShift(a.id)).withholding, true);
  assert.equal((await getShift(b.id)).withholding, false);
  assert.equal((await getShift(b.id)).overtimePay, 0);
  assert.equal((await getShift(b.id)).dailyPay, 120000);
});

test('3.3% 체크는 급여 유형과 상관없이 직원에 저장된다', async () => {
  await service.saveEmployee({ ...(await getEmployee()), withholding: true }, 'admin');
  assert.equal((await getEmployee()).withholding, true);
  await service.saveEmployee({ ...(await getEmployee()), withholding: false }, 'admin');
  assert.equal((await getEmployee()).withholding, false);
});

// ── 일당 직원 (이름 있는 정식 직원, 하루 단위) ──
const perDiemInput = { name: '김일당', role: '홀', active: true, payType: 'perDiem', dailyPay: 100000, halfDayPay: 55000, breakMinutes: 0, note: '' };

test('일당 직원은 자리가 아니라 사람이라 두 번 출근할 수 없다', async () => {
  const id = (await service.saveEmployee(perDiemInput, 'admin')).id;
  await service.punch({ employeeId: id, kind: 'in', requestId: 'a' }, token);
  await assert.rejects(service.punch({ employeeId: id, kind: 'in', requestId: 'b' }, token), /이미 출근/);
  assert.notEqual((await db.collection('staffEmployees').doc(id).get()).data().currentShiftId, null);
});

test('일당 직원의 반타임·풀타임 설정이 출근 기록에 실린다', async () => {
  const id = (await service.saveEmployee({ ...perDiemInput, halfDayBeforeMinutes: 14 * 60, overtimePay: 10000 }, 'admin')).id;
  const first = await service.punch({ employeeId: id, kind: 'in', requestId: 'in' }, token);
  const saved = await getShift(first.shiftId);
  assert.equal(saved.dailyPay, 100000);
  assert.equal(saved.halfDayPay, 55000);
  assert.equal(saved.halfDayBeforeMinutes, 840);
  assert.equal(saved.dayPortion, 'auto');
});

test('오후 5시 전에 퇴근하면 반타임 일당이 나간다', async () => {
  const id = (await service.saveEmployee(perDiemInput, 'admin')).id;
  now = at('2026-09-10T09:00:00+09:00');
  const shift = await service.punch({ employeeId: id, kind: 'in', requestId: 'in' }, token);
  now = at('2026-09-10T16:30:00+09:00');
  await service.punch({ employeeId: id, kind: 'out', requestId: 'out', shiftId: shift.shiftId }, token);
  const saved = (await service.listAdmin('2026-09')).shifts.find(s => s.id === shift.shiftId);
  assert.equal(saved.dayPortion, 'half');
  assert.equal(saved.amount, 55000);
});

test('오후 5시 이후에 퇴근하면 풀타임 일당이 나간다', async () => {
  const id = (await service.saveEmployee(perDiemInput, 'admin')).id;
  now = at('2026-09-10T09:00:00+09:00');
  const shift = await service.punch({ employeeId: id, kind: 'in', requestId: 'in' }, token);
  now = at('2026-09-10T17:30:00+09:00');
  await service.punch({ employeeId: id, kind: 'out', requestId: 'out', shiftId: shift.shiftId }, token);
  const saved = (await service.listAdmin('2026-09')).shifts.find(s => s.id === shift.shiftId);
  assert.equal(saved.dayPortion, 'full');
  assert.equal(saved.amount, 100000);
});

test('관리자가 기록을 고쳐도 반타임 설정이 기본값으로 안 되돌아간다', async () => {
  const id = (await service.saveEmployee({ ...perDiemInput, halfDayBeforeMinutes: 14 * 60 }, 'admin')).id;
  now = at('2026-09-11T09:00:00+09:00');
  const saved = await service.saveShift({ employeeId: id, payType: 'perDiem', breakMinutes: 0, note: '',
    checkInAt: at('2026-09-10T09:00:00+09:00'), checkOutAt: at('2026-09-10T16:00:00+09:00') }, 'admin');
  const shift = await getShift(saved.id);
  assert.equal(shift.halfDayBeforeMinutes, 840, '반타임 기준이 17시로 되돌아갔습니다');
  assert.equal(shift.halfDayPay, 55000);
  assert.equal(shift.dailyPay, 100000);
});

// 출퇴근 시각이 사실상 정해져 있는 일당 직원. 6시간 근무에 일당 75,000원.
const 비례Input = { name: '화성댁', role: '홀', active: true, payType: 'perDiem', dailyMode: 'prorate',
  dailyPay: 75000, halfDayPay: 0, dailyBaseMinutes: 360, earlyGraceMinutes: 30, breakMinutes: 0, note: '' };

test('비례 지급 설정이 출근 기록에 실린다', async () => {
  const id = (await service.saveEmployee(비례Input, 'admin')).id;
  const shift = await service.punch({ employeeId: id, kind: 'in', requestId: 'in' }, token);
  const saved = await getShift(shift.shiftId);
  assert.equal(saved.dailyMode, 'prorate');
  assert.equal(saved.earlyGraceMinutes, 30);
  assert.equal(saved.dailyBaseMinutes, 360);
});

test('정해진 시간을 못 채우고 퇴근하면 일한 만큼만 나간다', async () => {
  const id = (await service.saveEmployee(비례Input, 'admin')).id;
  now = at('2026-09-10T11:00:00+09:00');
  const shift = await service.punch({ employeeId: id, kind: 'in', requestId: 'in' }, token);
  now = at('2026-09-10T14:00:00+09:00');
  await service.punch({ employeeId: id, kind: 'out', requestId: 'out', shiftId: shift.shiftId }, token);
  const saved = (await service.listAdmin('2026-09')).shifts.find(s => s.id === shift.shiftId);
  assert.equal(saved.dayPortion, 'part');
  assert.equal(saved.amount, 37500);
});

test('30분 일찍 퇴근한 날은 일당 전액이 나간다', async () => {
  const id = (await service.saveEmployee(비례Input, 'admin')).id;
  now = at('2026-09-10T11:00:00+09:00');
  const shift = await service.punch({ employeeId: id, kind: 'in', requestId: 'in' }, token);
  now = at('2026-09-10T16:30:00+09:00');
  await service.punch({ employeeId: id, kind: 'out', requestId: 'out', shiftId: shift.shiftId }, token);
  const saved = (await service.listAdmin('2026-09')).shifts.find(s => s.id === shift.shiftId);
  assert.equal(saved.dayPortion, 'full');
  assert.equal(saved.amount, 75000);
});

test('관리자가 기록을 고쳐도 지급 방식과 유예가 기본값으로 안 되돌아간다', async () => {
  // 화면이 안 보낸 값이 shiftInput 의 기본값으로 덮이면 금액이 조용히 바뀐다.
  const id = (await service.saveEmployee({ ...비례Input, earlyGraceMinutes: 45 }, 'admin')).id;
  now = at('2026-09-11T09:00:00+09:00');
  const saved = await service.saveShift({ employeeId: id, payType: 'perDiem', breakMinutes: 0, note: '',
    checkInAt: at('2026-09-10T11:00:00+09:00'), checkOutAt: at('2026-09-10T16:20:00+09:00') }, 'admin');
  const shift = await getShift(saved.id);
  assert.equal(shift.dailyMode, 'prorate', '지급 방식이 반타임·풀타임으로 되돌아갔습니다');
  assert.equal(shift.earlyGraceMinutes, 45, '유예가 30분으로 되돌아갔습니다');
  assert.equal(shift.dailyBaseMinutes, 360);
  // 40분 일찍 갔지만 유예가 45분이라 전액.
  const row = (await service.listAdmin('2026-09')).shifts.find(s => s.id === saved.id);
  assert.equal(row.amount, 75000);
});

test('유예를 0으로 둔 직원은 1분만 일찍 가도 깎인다', async () => {
  const id = (await service.saveEmployee({ ...비례Input, earlyGraceMinutes: 0 }, 'admin')).id;
  assert.equal((await db.collection('staffEmployees').doc(id).get()).data().earlyGraceMinutes, 0);
  now = at('2026-09-11T09:00:00+09:00');
  const saved = await service.saveShift({ employeeId: id, payType: 'perDiem', breakMinutes: 0, note: '',
    checkInAt: at('2026-09-10T11:00:00+09:00'), checkOutAt: at('2026-09-10T16:59:00+09:00') }, 'admin');
  const row = (await service.listAdmin('2026-09')).shifts.find(s => s.id === saved.id);
  assert.equal(row.dayPortion, 'part');
  assert.ok(row.amount < 75000 && row.amount > 0, `${row.amount}원`);
});

test('지급 방식을 바꿔도 지난 기록의 금액은 그대로다', async () => {
  // 이미 정산해서 돈이 나간 달의 숫자가 나중에 움직이면 안 된다.
  const id = (await service.saveEmployee(perDiemInput, 'admin')).id;
  now = at('2026-09-10T09:00:00+09:00');
  const shift = await service.punch({ employeeId: id, kind: 'in', requestId: 'in' }, token);
  now = at('2026-09-10T16:30:00+09:00');
  await service.punch({ employeeId: id, kind: 'out', requestId: 'out', shiftId: shift.shiftId }, token);
  const before = (await service.listAdmin('2026-09')).shifts.find(s => s.id === shift.shiftId);
  assert.equal(before.amount, 55000);
  // 이제 비례 지급으로 바꾼다.
  const employee = (await db.collection('staffEmployees').doc(id).get()).data();
  await service.saveEmployee({ ...perDiemInput, id, version: employee.version,
    dailyMode: 'prorate', dailyBaseMinutes: 360, earlyGraceMinutes: 30 }, 'admin');
  const after = (await service.listAdmin('2026-09')).shifts.find(s => s.id === shift.shiftId);
  assert.equal(after.amount, 55000, '지난 기록의 금액이 바뀌었습니다');
  assert.equal(after.dayPortion, 'half');
});

test('기록에서 풀타임·반타임을 직접 정하면 그대로 간다', async () => {
  const id = (await service.saveEmployee(perDiemInput, 'admin')).id;
  now = at('2026-09-11T09:00:00+09:00');
  // 오후 1시 퇴근이지만 풀타임으로 지급
  const saved = await service.saveShift({ employeeId: id, payType: 'perDiem', breakMinutes: 0, note: '', dayPortion: 'full',
    checkInAt: at('2026-09-10T09:00:00+09:00'), checkOutAt: at('2026-09-10T13:00:00+09:00') }, 'admin');
  assert.equal((await getShift(saved.id)).dayPortion, 'full');
  const shift = (await service.listAdmin('2026-09')).shifts.find(s => s.id === saved.id);
  assert.equal(shift.amount, 100000);
});
