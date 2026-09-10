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
  service = createAttendanceService({ db, now: () => now });
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
