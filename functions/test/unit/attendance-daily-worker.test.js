'use strict';

// 일일근무자는 사람이 아니라 '자리'다. 한 자리를 여러 사람이 같은 날 같이 쓴다.
// 기록이 섞이거나 한 줄로 합쳐지면 누구에게 얼마를 줄지 알 수 없게 된다.

const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../../attendanceModel');

const at = value => new Date(value).getTime();
const 일당근무 = {
  checkInAt: at('2026-09-17T09:00:00+09:00'), checkOutAt: at('2026-09-17T18:00:00+09:00'),
  breakMinutes: 60, payType: 'daily', hourlyRate: 0, dailyPay: 100000, note: ''
};

test('일당은 시간과 상관없이 하루치다', () => {
  assert.equal(M.totals(일당근무).amount, 100000);
  // 두 시간만 일해도 하루치. 열두 시간 일해도 하루치.
  assert.equal(M.totals({ ...일당근무, checkOutAt: at('2026-09-17T11:00:00+09:00') }).amount, 100000);
  assert.equal(M.totals({ ...일당근무, checkOutAt: at('2026-09-17T21:00:00+09:00') }).amount, 100000);
});

test('특수일 배율은 일당에 붙지 않는다', () => {
  // 명절에 더 드릴 금액은 그 기록의 일당을 직접 고쳐서 정한다.
  const 설날 = { appliesTo: 'both', multiplierPercent: 150 };
  assert.equal(M.totals(일당근무, 설날).amount, 100000);
  assert.equal(M.totals(일당근무, 설날).extraAmount, 0);
  assert.equal(M.shiftMultiplierPercent(설날, 'daily'), M.BASE_PERCENT);
});

test('미퇴근·삭제된 일일근무 기록은 0원이다', () => {
  assert.equal(M.totals({ ...일당근무, checkOutAt: null }).amount, 0);
  assert.equal(M.totals({ ...일당근무, voided: true }).amount, 0);
});

test('일당이 없거나 이상하면 0원으로 떨어진다', () => {
  // 급여 화면에 NaN 이 뜨면 안 된다. 관리자가 복사해서 그대로 이체하는 금액이다.
  for (const bad of [undefined, null, 0, -5000, 'abc', NaN]) {
    const amount = M.totals({ ...일당근무, dailyPay: bad }).amount;
    assert.ok(Number.isSafeInteger(amount) && amount >= 0, `dailyPay=${bad} → ${amount}`);
  }
});

test('자리 등록은 일당만 받고 시급·월급 칸은 비운다', () => {
  const 자리 = M.employeeInput({ name: '일일근무자 (홀)', role: '홀', floor: 2, payType: 'daily', dailyPay: 100000, breakMinutes: 60, active: true, note: '' });
  assert.equal(자리.payType, 'daily');
  assert.equal(자리.dailyPay, 100000);
  assert.equal(자리.hourlyRate, 0);
  assert.equal(자리.monthlySalary, null);
  assert.equal(자리.monthlyWorkHours, 0);
  assert.equal(M.isSharedSlot(자리), true);
  assert.equal(M.isSharedSlot({ payType: 'hourly' }), false);
  assert.equal(M.isSharedSlot({ payType: 'salaried' }), false);
});

test('일당 없이 자리를 만들 수 없다', () => {
  const base = { name: '일일근무자', role: '', floor: 2, payType: 'daily', breakMinutes: 0, active: true, note: '' };
  for (const bad of [undefined, 0, -1, 10000001, 1.5, 'abc']) {
    assert.throws(() => M.employeeInput({ ...base, dailyPay: bad }), new RegExp('.'), String(bad));
  }
  assert.equal(M.employeeInput({ ...base, dailyPay: 1 }).dailyPay, 1);
});

test('기록마다 일당과 일한 사람을 따로 들고 있다', () => {
  // 같은 자리에 온 두 사람에게 다른 금액을 줄 수 있어야 한다.
  const 저장 = M.shiftInput({ ...일당근무, dailyPay: 120000, workerName: '김일손', workerNote: '국민 123-456' }, at('2026-09-18T00:00:00+09:00'));
  assert.equal(저장.dailyPay, 120000);
  assert.equal(저장.workerName, '김일손');
  assert.equal(저장.workerNote, '국민 123-456');
  // 이름은 나중에 적는다. 비어 있어도 저장돼야 한다.
  assert.equal(M.shiftInput(일당근무, at('2026-09-18T00:00:00+09:00')).workerName, '');
});

test('시급·월급 기록에는 일당과 이름이 붙지 않는다', () => {
  const 시급 = M.shiftInput({ ...일당근무, payType: 'hourly', hourlyRate: 12000, dailyPay: 100000, workerName: '김일손' }, at('2026-09-18T00:00:00+09:00'));
  assert.equal(시급.dailyPay, 0);
  assert.equal(시급.workerName, '');
});

test('알 수 없는 급여 유형은 거부한다', () => {
  assert.deepEqual([...M.PAY_TYPES].sort(), ['daily', 'hourly', 'salaried']);
  assert.throws(() => M.employeeInput({ name: 'x', role: '', floor: 2, payType: 'weekly', breakMinutes: 0, active: true, note: '' }));
});

// ── 기준 근무시간을 넘겼을 때 붙는 추가 급여 ──
const 초과 = { ...일당근무, dailyBaseMinutes: 480, overtimeUnitMinutes: 30, overtimePay: 10000 };
const 퇴근 = time => ({ ...초과, checkOutAt: at(`2026-09-17T${time}:00+09:00`) });

test('기준을 넘고 30분이 되어야 추가 급여가 붙기 시작한다', () => {
  // 09:00 출근 · 휴게 60분 · 기준 8시간
  assert.equal(M.totals(퇴근('17:00')).extraAmount, 0);      // 유급 7시간 — 기준 미달
  assert.equal(M.totals(퇴근('18:00')).extraAmount, 0);      // 유급 8시간 정각
  assert.equal(M.totals(퇴근('18:20')).extraAmount, 0);      // 20분 초과 — 아직 아님
  assert.equal(M.totals(퇴근('18:30')).extraAmount, 10000);  // 30분 초과 — 1회
  assert.equal(M.totals(퇴근('18:59')).extraAmount, 10000);  // 59분 초과 — 아직 1회
  assert.equal(M.totals(퇴근('19:00')).extraAmount, 20000);  // 60분 초과 — 2회
  assert.equal(M.totals(퇴근('21:00')).extraAmount, 60000);  // 3시간 초과 — 6회
});

test('추가 급여 합계가 일당 위에 더해진다', () => {
  const t = M.totals(퇴근('19:00'));
  assert.equal(t.baseAmount, 100000);
  assert.equal(t.extraAmount, 20000);
  assert.equal(t.amount, 120000);
  assert.equal(t.overtimeUnits, 2);
});

test('무급 휴게시간은 초과 계산에서 빠진다', () => {
  // 09:00~19:00 열 시간이지만 휴게 2시간이면 유급 8시간 — 초과 없음
  assert.equal(M.totals({ ...초과, checkOutAt: at('2026-09-17T19:00:00+09:00'), breakMinutes: 120 }).extraAmount, 0);
});

test('추가 급여가 0이면 아무리 오래 일해도 안 붙는다', () => {
  assert.equal(M.totals({ ...퇴근('23:00'), overtimePay: 0 }).extraAmount, 0);
  assert.equal(M.totals({ ...퇴근('23:00'), overtimePay: undefined }).extraAmount, 0);
});

test('기준·단위를 바꾸면 그대로 따른다', () => {
  // 기준 6시간 · 1시간 단위 · 회당 15,000원 → 유급 8시간이면 2회
  const t = M.totals({ ...퇴근('18:00'), dailyBaseMinutes: 360, overtimeUnitMinutes: 60, overtimePay: 15000 });
  assert.equal(t.overtimeUnits, 2);
  assert.equal(t.extraAmount, 30000);
});

test('기준·단위가 비어 있으면 8시간·30분을 쓴다', () => {
  assert.equal(M.DEFAULT_DAILY_BASE_MINUTES, 480);
  assert.equal(M.DEFAULT_OVERTIME_UNIT_MINUTES, 30);
  const t = M.totals({ ...퇴근('19:00'), dailyBaseMinutes: 0, overtimeUnitMinutes: 0 });
  assert.equal(t.extraAmount, 20000);
  assert.equal(M.overtimeUnits(550, undefined, undefined), 2);
  assert.equal(M.overtimeUnits(480, undefined, undefined), 0);
});

test('자리 설정에 기준·단위·추가 급여가 저장된다', () => {
  const base = { name: '일일근무자 (홀)', role: '', floor: 2, payType: 'daily', dailyPay: 100000, breakMinutes: 0, active: true, note: '' };
  const 기본 = M.employeeInput(base);
  assert.equal(기본.dailyBaseMinutes, M.DEFAULT_DAILY_BASE_MINUTES);
  assert.equal(기본.overtimeUnitMinutes, M.DEFAULT_OVERTIME_UNIT_MINUTES);
  assert.equal(기본.overtimePay, 0);
  const 지정 = M.employeeInput({ ...base, dailyBaseMinutes: 360, overtimeUnitMinutes: 60, overtimePay: 15000 });
  assert.equal(지정.dailyBaseMinutes, 360);
  assert.equal(지정.overtimePay, 15000);
  for (const patch of [{ dailyBaseMinutes: -1 }, { dailyBaseMinutes: 1441 }, { overtimeUnitMinutes: -1 }, { overtimePay: -1 }, { overtimePay: 1.5 }]) {
    assert.throws(() => M.employeeInput({ ...base, ...patch }), new RegExp('.'), JSON.stringify(patch));
  }
});

// ── 3.3% 원천징수 ──
test('3.3% 는 원 단위로 버리고 뗀다', () => {
  assert.equal(M.WITHHOLDING_PER_MILLE, 33);
  assert.equal(M.withholdingTax(100000), 3300);
  assert.equal(M.withholdingTax(3000000), 99000);
  // 144,000 × 3.3% = 4,752
  assert.equal(M.withholdingTax(144000), 4752);
  // 자투리는 버린다. 더 떼서 모자라게 주는 것보다 낫다.
  assert.equal(M.withholdingTax(33), 1);
  assert.equal(M.withholdingTax(30), 0);
});

test('세금 계산이 이상한 값에도 0으로 떨어진다', () => {
  for (const bad of [0, -5, undefined, null, NaN, 'abc']) {
    assert.equal(M.withholdingTax(bad), 0, String(bad));
    assert.equal(M.netPay(bad, true), 0, String(bad));
  }
});

test('체크를 안 하면 한 푼도 안 뗀다', () => {
  assert.equal(M.netPay(100000, false), 100000);
  assert.equal(M.netPay(100000, undefined), 100000);
  assert.equal(M.netPay(100000, true), 96700);
});

test('원천징수 여부가 직원과 기록에 저장된다', () => {
  const base = { name: '일일근무자', role: '', floor: 2, payType: 'daily', dailyPay: 100000, breakMinutes: 0, active: true, note: '' };
  assert.equal(M.employeeInput(base).withholding, false);
  assert.equal(M.employeeInput({ ...base, withholding: true }).withholding, true);
  const when = at('2026-09-18T00:00:00+09:00');
  assert.equal(M.shiftInput({ ...일당근무, withholding: true }, when).withholding, true);
  // 시급·월급 기록에는 붙지 않는다. 그쪽은 직원 설정을 따른다.
  assert.equal(M.shiftInput({ ...일당근무, payType: 'hourly', hourlyRate: 12000, withholding: true }, when).withholding, false);
});
