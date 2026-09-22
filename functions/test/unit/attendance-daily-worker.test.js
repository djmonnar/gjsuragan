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
  assert.equal([...M.PAY_TYPES].sort().join(','), 'daily,hourly,perDiem,salaried');
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

// ── 예정 출근 시각: 일찍 찍은 시간은 초과로 세지 않는다 ──
// 7시 출근 · 기준 7시간 · 휴게 없음 → 정해진 퇴근은 오후 2시다.
const 예정 = { ...일당근무, breakMinutes: 0, dailyBaseMinutes: 420, overtimeUnitMinutes: 30,
  overtimePay: 10000, scheduledStartMinutes: 7 * 60 };
const 예정근무 = (inTime, outTime, extra = {}) => ({ ...예정,
  checkInAt: at(`2026-09-17T${inTime}:00+09:00`), checkOutAt: at(`2026-09-17T${outTime}:00+09:00`), ...extra });

test('예정보다 일찍 찍은 시간은 추가 급여로 세지 않는다', () => {
  // 6시 50분에 찍고 2시 20분에 갔으면 정해진 퇴근보다 20분 더 일한 것이다.
  assert.equal(M.totals(예정근무('06:50', '14:20')).extraAmount, 0);
  // 예정 시각을 안 쓰면 유급 7시간 30분이 되어 30분치가 붙던 자리다.
  assert.equal(M.totals(예정근무('06:50', '14:20', { scheduledStartMinutes: 0 })).extraAmount, 10000);
  // 정말로 30분을 넘겼으면 붙는다.
  assert.equal(M.totals(예정근무('06:50', '14:50')).extraAmount, 10000);
  assert.equal(M.totals(예정근무('06:50', '15:20')).extraAmount, 20000);
  // 일당과 근무시간은 그대로다. 일찍 온 것으로 깎지 않는다.
  assert.equal(M.totals(예정근무('06:50', '14:20')).baseAmount, 100000);
  assert.equal(M.totals(예정근무('06:50', '14:20')).payableMinutes, 450);
});

test('늦게 온 날은 실제 출근 시각부터 센다', () => {
  // 7시 20분에 와서 3시에 갔으면 40분 초과. 늦게 온 만큼을 채워주지 않는다.
  assert.equal(M.totals(예정근무('07:20', '15:00')).extraAmount, 10000);
  assert.equal(M.totals(예정근무('07:00', '15:00')).extraAmount, 20000);
});

test('예정보다 한참 일찍 찍혔으면 다른 시간대 근무로 본다', () => {
  // 일일근무자 자리는 아침 사람과 저녁 사람이 같이 쓰는데 예정 시각은 하나뿐이다.
  assert.equal(M.EARLY_CLOCK_IN_WINDOW_MINUTES, 180);
  assert.equal(M.earlyClockInMinutes(예정근무('06:50', '14:20')), 10);
  assert.equal(M.earlyClockInMinutes(예정근무('04:00', '12:00')), 180);
  assert.equal(M.earlyClockInMinutes(예정근무('03:59', '12:00')), 0);
  // 예정보다 늦게 왔으면 뺄 것이 없다.
  assert.equal(M.earlyClockInMinutes(예정근무('07:20', '15:00')), 0);
  assert.equal(M.earlyClockInMinutes({ ...예정근무('06:50', '14:20'), scheduledStartMinutes: 0 }), 0);
});

// ── 첫 단위는 정액, 그 뒤부터 초과 시급 ──
test('첫 회 정액을 따로 정하면 그 회만 정액이고 뒤는 시급이다', () => {
  // 기준 8시간 · 30분 단위 · 첫 회 10,000원 · 초과 시급 12,000원(30분이면 6,000원)
  const 시급초과 = time => ({ ...퇴근(time), overtimeHourlyRate: 12000 });
  assert.equal(M.totals(시급초과('18:20')).extraAmount, 0);      // 20분 초과 — 아직 아님
  assert.equal(M.totals(시급초과('18:30')).extraAmount, 10000);  // 1회 — 정액
  assert.equal(M.totals(시급초과('19:00')).extraAmount, 16000);  // 2회 — 정액 + 30분
  assert.equal(M.totals(시급초과('19:30')).extraAmount, 22000);  // 3회 — 정액 + 1시간
  assert.equal(M.totals(시급초과('21:00')).extraAmount, 40000);  // 6회 — 정액 + 2시간 30분
  assert.equal(M.totals(시급초과('19:00')).amount, 116000);
});

test('초과 시급이 없으면 단위마다 정액이다', () => {
  // 옛 설정 그대로여야 한다. 이미 정산한 달의 금액이 움직이면 안 된다.
  assert.equal(M.totals(퇴근('21:00')).extraAmount, 60000);
  assert.equal(M.totals({ ...퇴근('21:00'), overtimeHourlyRate: 0 }).extraAmount, 60000);
  assert.equal(M.totals({ ...퇴근('21:00'), overtimeHourlyRate: undefined }).extraAmount, 60000);
});

test('초과 시급만 정해 두면 초과분 전부를 시급으로 센다', () => {
  // 기준 뒤는 시급이라는 뜻이다. 30분 단위면 회당 시급의 절반(6,000원).
  const 시급만 = time => ({ ...퇴근(time), overtimePay: 0, overtimeHourlyRate: 12000 });
  assert.equal(M.totals(시급만('18:20')).extraAmount, 0);      // 20분 초과 — 단위 미달
  assert.equal(M.totals(시급만('18:30')).extraAmount, 6000);   // 1회
  assert.equal(M.totals(시급만('19:00')).extraAmount, 12000);  // 2회 = 1시간
  assert.equal(M.totals(시급만('21:00')).extraAmount, 36000);  // 6회 = 3시간
  assert.equal(M.totals(시급만('19:00')).amount, 112000);
});

test('초과 시급과 정액이 둘 다 0이면 추가 급여가 없다', () => {
  assert.equal(M.totals({ ...퇴근('23:00'), overtimePay: 0, overtimeHourlyRate: 0 }).extraAmount, 0);
  assert.equal(M.totals({ ...퇴근('23:00'), overtimePay: 0, overtimeHourlyRate: 0 }).overtimeUnits, 0);
  assert.equal(M.totals({ ...퇴근('23:00'), overtimePay: undefined, overtimeHourlyRate: undefined }).extraAmount, 0);
});

test('정액을 시급의 단위 몫으로 넣으면 시급 계산과 같다', () => {
  // 30분 단위에 6,000원은 시급 12,000원과 같은 금액이다. 두 칸은 같은 것을 다르게 적는다.
  const 정액 = { ...퇴근('21:00'), overtimePay: 6000, overtimeHourlyRate: 0 };
  const 시급 = { ...퇴근('21:00'), overtimePay: 0, overtimeHourlyRate: 12000 };
  assert.equal(M.totals(정액).extraAmount, M.totals(시급).extraAmount);
});

test('단위가 1시간이면 첫 회 뒤로 시급 한 시간치씩 붙는다', () => {
  // 유급 11시간 → 기준 8시간 초과 3시간 → 3회 → 15,000 + 12,000 × 2
  const t = M.totals({ ...퇴근('21:00'), overtimeUnitMinutes: 60, overtimePay: 15000, overtimeHourlyRate: 12000 });
  assert.equal(t.overtimeUnits, 3);
  assert.equal(t.extraAmount, 39000);
});

test('예정 출근 시각과 초과 시급이 직원·기록에 저장된다', () => {
  const base = { name: '일일근무자 (홀)', role: '', floor: 2, payType: 'daily', dailyPay: 100000, breakMinutes: 0, active: true, note: '' };
  const 기본 = M.employeeInput(base);
  // 둘 다 0 이 '안 씀' 이다. 기본값을 채우면 안 된다.
  assert.equal(기본.scheduledStartMinutes, 0);
  assert.equal(기본.overtimeHourlyRate, 0);
  const 지정 = M.employeeInput({ ...base, scheduledStartMinutes: 7 * 60, overtimeHourlyRate: 12000 });
  assert.equal(지정.scheduledStartMinutes, 420);
  assert.equal(지정.overtimeHourlyRate, 12000);
  // 시급·월급 직원에게는 붙지 않는다.
  assert.equal(M.employeeInput({ ...base, payType: 'hourly', hourlyRate: 12000, scheduledStartMinutes: 420, overtimeHourlyRate: 12000 }).scheduledStartMinutes, 0);
  for (const patch of [{ scheduledStartMinutes: -1 }, { scheduledStartMinutes: 1441 }, { scheduledStartMinutes: 1.5 }, { overtimeHourlyRate: -1 }, { overtimeHourlyRate: 1.5 }]) {
    assert.throws(() => M.employeeInput({ ...base, ...patch }), new RegExp('.'), JSON.stringify(patch));
  }
  const when = at('2026-09-18T00:00:00+09:00');
  const 기록 = M.shiftInput({ ...일당근무, scheduledStartMinutes: 420, overtimeHourlyRate: 12000 }, when);
  assert.equal(기록.scheduledStartMinutes, 420);
  assert.equal(기록.overtimeHourlyRate, 12000);
  assert.equal(M.shiftInput(일당근무, when).scheduledStartMinutes, 0);
  assert.equal(M.shiftInput(일당근무, when).overtimeHourlyRate, 0);
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

// ── 일당 직원 (이름 있는 정식 직원, 하루 단위로 받음) ──
const 일당직원 = {
  checkInAt: at('2026-09-17T09:00:00+09:00'), breakMinutes: 0, payType: 'perDiem',
  hourlyRate: 0, dailyPay: 100000, halfDayPay: 55000, halfDayBeforeMinutes: 17 * 60,
  dailyBaseMinutes: 480, overtimeUnitMinutes: 30, overtimePay: 10000, note: ''
};
const 퇴근시각 = (time, extra = {}) => ({ ...일당직원, checkOutAt: at(`2026-09-17T${time}:00+09:00`), ...extra });

test('오후 5시 전에 퇴근하면 반타임이다', () => {
  assert.equal(M.DEFAULT_HALF_DAY_BEFORE_MINUTES, 17 * 60);
  assert.equal(M.totals(퇴근시각('13:00')).dayPortion, 'half');
  assert.equal(M.totals(퇴근시각('16:59')).dayPortion, 'half');
  assert.equal(M.totals(퇴근시각('13:00')).amount, 55000);
  // 정각은 '이전' 이 아니다.
  assert.equal(M.totals(퇴근시각('17:00')).dayPortion, 'full');
  assert.equal(M.totals(퇴근시각('17:00')).amount, 100000);
  assert.equal(M.totals(퇴근시각('18:00')).dayPortion, 'full');
});

test('반타임 판정은 근무한 시간이 아니라 퇴근 시각이다', () => {
  // 새벽 4시에 나와 오후 4시에 갔으면 열두 시간을 일했지만 5시 전 퇴근이다.
  const 긴반타임 = { ...일당직원, checkInAt: at('2026-09-17T04:00:00+09:00'), checkOutAt: at('2026-09-17T16:00:00+09:00') };
  assert.equal(M.totals(긴반타임).dayPortion, 'half');
  // 오후 3시에 나와 6시에 갔으면 세 시간이지만 풀타임이다.
  const 짧은풀타임 = { ...일당직원, checkInAt: at('2026-09-17T15:00:00+09:00'), checkOutAt: at('2026-09-17T18:00:00+09:00') };
  assert.equal(M.totals(짧은풀타임).dayPortion, 'full');
});

test('날짜를 넘겨 퇴근하면 반타임이 아니다', () => {
  // 시각만 보면 새벽 두 시가 오후 5시보다 이르다. 밤새 일한 사람을 반타임으로 치면 안 된다.
  const 밤샘 = { ...일당직원, checkOutAt: at('2026-09-18T02:00:00+09:00') };
  assert.equal(M.totals(밤샘).dayPortion, 'full');
  assert.equal(M.totals(밤샘).baseAmount, 100000);
});

test('한국시간으로 판정한다 (서버 시간대와 무관)', () => {
  assert.equal(M.kstMinutesOfDay(at('2026-09-17T17:00:00+09:00')), 17 * 60);
  assert.equal(M.kstMinutesOfDay(at('2026-09-17T00:00:00+09:00')), 0);
  // 같은 순간을 UTC 로 적어도 같은 값이어야 한다.
  assert.equal(M.kstMinutesOfDay(Date.parse('2026-09-17T08:00:00Z')), 17 * 60);
});

test('기준 시각을 바꾸면 그대로 따른다', () => {
  // 오후 2시 기준이면 1시 퇴근만 반타임.
  assert.equal(M.totals(퇴근시각('13:00', { halfDayBeforeMinutes: 14 * 60 })).dayPortion, 'half');
  assert.equal(M.totals(퇴근시각('15:00', { halfDayBeforeMinutes: 14 * 60 })).dayPortion, 'full');
});

test('기준 시각에 출근해 저녁까지 하면 반타임이다', () => {
  // 오후 5시에 나와 마감까지 하는 저녁 반타임. 퇴근 시각만 보면 풀타임으로 잡힌다.
  const 저녁출근 = (time, extra = {}) => ({ ...일당직원, checkInAt: at('2026-09-17T17:00:00+09:00'),
    checkOutAt: at(`2026-09-17T${time}:00+09:00`), ...extra });
  assert.equal(M.totals(저녁출근('21:00')).dayPortion, 'half');
  assert.equal(M.totals(저녁출근('21:00')).amount, 55000);
  assert.equal(M.totals(저녁출근('22:30')).dayPortion, 'half');
  // 기준 시각 전에 출근해 뒤에 퇴근했으면 선을 걸쳐 일한 것이라 풀타임이다.
  const 걸친근무 = { ...일당직원, checkInAt: at('2026-09-17T16:30:00+09:00'), checkOutAt: at('2026-09-17T21:00:00+09:00') };
  assert.equal(M.totals(걸친근무).dayPortion, 'full');
  assert.equal(M.totals(걸친근무).amount, 100000);
});

test('저녁 반타임에도 초과 급여가 붙지 않는다', () => {
  // 기준 근무시간을 넘겨 일해도 반타임은 반타임 일당까지다.
  const 저녁 = { ...일당직원, dailyBaseMinutes: 240,
    checkInAt: at('2026-09-17T17:00:00+09:00'), checkOutAt: at('2026-09-17T23:00:00+09:00') };
  const t = M.totals(저녁);
  assert.equal(t.dayPortion, 'half');
  assert.equal(t.extraAmount, 0);
  assert.equal(t.amount, 55000);
});

test('저녁 출근 판정도 기준 시각을 따라간다', () => {
  const 저녁 = extra => ({ ...일당직원, checkInAt: at('2026-09-17T17:00:00+09:00'),
    checkOutAt: at('2026-09-17T21:00:00+09:00'), ...extra });
  // 오후 6시 기준이면 5시 출근은 선을 걸친 것이라 풀타임.
  assert.equal(M.totals(저녁({ halfDayBeforeMinutes: 18 * 60 })).dayPortion, 'full');
  assert.equal(M.totals(저녁({ halfDayBeforeMinutes: 16 * 60 })).dayPortion, 'half');
});

test('반타임 일당이 0이면 늘 풀타임이다', () => {
  assert.equal(M.totals(퇴근시각('13:00', { halfDayPay: 0 })).dayPortion, 'full');
  assert.equal(M.totals(퇴근시각('13:00', { halfDayPay: 0 })).amount, 100000);
  // 저녁 출근도 마찬가지다. 반타임을 안 쓰는 자리에는 반타임이 없다.
  const 저녁 = { ...일당직원, halfDayPay: 0,
    checkInAt: at('2026-09-17T17:00:00+09:00'), checkOutAt: at('2026-09-17T21:00:00+09:00') };
  assert.equal(M.totals(저녁).dayPortion, 'full');
});

test('기록에서 풀타임·반타임을 직접 정할 수 있다', () => {
  assert.equal(M.totals(퇴근시각('13:00', { dayPortion: 'full' })).amount, 100000);
  assert.equal(M.totals(퇴근시각('18:00', { dayPortion: 'half' })).amount, 55000);
  // 직접 정한 반타임에는 초과 급여를 붙이지 않는다.
  assert.equal(M.totals(퇴근시각('21:00', { dayPortion: 'half' })).extraAmount, 0);
});

test('반타임에는 초과 급여가 붙지 않는다', () => {
  // 5시 전에 갔으면 기준 8시간을 넘길 수가 없지만, 강제로라도 안 붙어야 한다.
  const t = M.totals({ ...일당직원, checkInAt: at('2026-09-17T02:00:00+09:00'), checkOutAt: at('2026-09-17T16:00:00+09:00') });
  assert.equal(t.dayPortion, 'half');
  assert.equal(t.extraAmount, 0);
  assert.equal(t.amount, 55000);
});

test('일당 직원은 자리가 아니라 사람이다', () => {
  assert.equal(M.isSharedSlot({ payType: 'perDiem' }), false);
  assert.equal(M.isSharedSlot({ payType: 'daily' }), true);
  assert.equal(M.isDailyPaid('perDiem'), true);
  assert.equal(M.isDailyPaid('daily'), true);
  assert.equal(M.isDailyPaid('hourly'), false);
  assert.equal(M.isDailyPaid('salaried'), false);
});

test('일당 직원 등록에 풀타임·반타임이 저장된다', () => {
  const base = { name: '김일당', role: '홀', floor: 2, payType: 'perDiem', dailyPay: 100000, breakMinutes: 0, active: true, note: '' };
  const 기본 = M.employeeInput(base);
  assert.equal(기본.dailyPay, 100000);
  assert.equal(기본.halfDayPay, 0);
  assert.equal(기본.halfDayBeforeMinutes, M.DEFAULT_HALF_DAY_BEFORE_MINUTES);
  const 지정 = M.employeeInput({ ...base, halfDayPay: 55000, halfDayBeforeMinutes: 14 * 60 });
  assert.equal(지정.halfDayPay, 55000);
  assert.equal(지정.halfDayBeforeMinutes, 840);
  // 0 은 '설정 안 함' 이라 기본값으로 떨어진다. 자정을 기준으로 쓸 일은 없다.
  assert.equal(M.employeeInput({ ...base, halfDayBeforeMinutes: 0 }).halfDayBeforeMinutes, M.DEFAULT_HALF_DAY_BEFORE_MINUTES);
  for (const patch of [{ halfDayPay: -1 }, { halfDayBeforeMinutes: -1 }, { halfDayBeforeMinutes: 1441 }, { halfDayBeforeMinutes: 1.5 }, { dailyPay: 0 }]) {
    assert.throws(() => M.employeeInput({ ...base, ...patch }), new RegExp('.'), JSON.stringify(patch));
  }
});

test('일당 직원에게도 특수일 배율은 붙지 않는다', () => {
  const 설날 = { appliesTo: 'both', multiplierPercent: 150 };
  assert.equal(M.totals(퇴근시각('18:00'), 설날).amount, M.totals(퇴근시각('18:00')).amount);
  assert.equal(M.shiftMultiplierPercent(설날, 'perDiem'), M.BASE_PERCENT);
});
