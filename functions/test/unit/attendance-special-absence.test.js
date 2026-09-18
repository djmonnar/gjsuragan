'use strict';

// 명절·특수일 배율과 결근 공제.
// 급여에 바로 붙는 계산이라 경계값을 못 박아 둔다.

const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../../attendanceModel');

const at = value => new Date(value).getTime();
// 09:00~18:00 · 휴게 60분 = 유급 8시간
const 시급근무 = { checkInAt: at('2026-09-17T09:00:00+09:00'), checkOutAt: at('2026-09-17T18:00:00+09:00'), breakMinutes: 60, payType: 'hourly', hourlyRate: 12000, note: '' };
const 월급근무 = { ...시급근무, payType: 'salaried', hourlyRate: 0, ordinaryHourlyRate: 14354 };
const 설날 = { workDate: '2026-09-17', label: '설날', multiplierPercent: 150, appliesTo: 'both' };

test('시급 직원은 그날 급여가 배율만큼 나온다', () => {
  assert.equal(M.totals(시급근무).amount, 96000);
  const 특수일 = M.totals(시급근무, 설날);
  assert.equal(특수일.amount, 144000);
  assert.equal(특수일.baseAmount, 96000);
  assert.equal(특수일.extraAmount, 48000);
  assert.equal(특수일.multiplierPercent, 150);
});

test('기본급과 가산분을 더하면 총액과 정확히 맞는다', () => {
  // 따로 반올림하면 1원씩 어긋난다. 총액을 먼저 내고 빼야 한다.
  for (const rate of [10321, 9999, 12345, 7777]) {
    for (const percent of [150, 133, 250, 175]) {
      const t = M.totals({ ...시급근무, hourlyRate: rate }, { ...설날, multiplierPercent: percent });
      assert.equal(t.baseAmount + t.extraAmount, t.amount, `${rate}원 ${percent}%`);
    }
  }
});

test('월급 직원은 월급 위에 특수일 근무분만 얹는다', () => {
  // 평일은 월급에 이미 들어 있으므로 0.
  assert.equal(M.totals(월급근무).amount, 0);
  const 특수일 = M.totals(월급근무, 설날);
  assert.equal(특수일.baseAmount, 0);
  assert.equal(특수일.extraAmount, 172248); // 8시간 × 14,354 × 1.5
  assert.equal(특수일.amount, 172248);
});

test('적용 대상이 아니면 배율이 붙지 않는다', () => {
  const 시급만 = { ...설날, appliesTo: 'hourly' };
  const 월급만 = { ...설날, appliesTo: 'salaried' };
  assert.equal(M.totals(시급근무, 시급만).amount, 144000);
  assert.equal(M.totals(시급근무, 월급만).amount, 96000);
  assert.equal(M.totals(월급근무, 시급만).amount, 0);
  assert.equal(M.totals(월급근무, 월급만).amount, 172248);
});

test('통상시급이 없는 월급 직원은 가산이 0이다', () => {
  // 월급을 아직 안 넣은 직원이다. 0으로 나누거나 NaN 을 내면 안 된다.
  assert.equal(M.totals({ ...월급근무, ordinaryHourlyRate: 0 }, 설날).extraAmount, 0);
  assert.equal(M.totals({ ...월급근무, ordinaryHourlyRate: undefined }, 설날).extraAmount, 0);
});

test('미퇴근·삭제된 기록은 특수일이어도 0이다', () => {
  assert.equal(M.totals({ ...시급근무, checkOutAt: null }, 설날).amount, 0);
  assert.equal(M.totals({ ...시급근무, voided: true }, 설날).amount, 0);
});

test('통상시급과 결근 하루치', () => {
  const 직원 = { payType: 'salaried', monthlySalary: 3000000, monthlyWorkHours: 209, monthlyWorkDays: 22 };
  assert.equal(M.ordinaryHourlyRate(직원), 14354);
  assert.equal(M.dailyDeduction(직원), 136364);
  // 비워두면 통상 기준값(209시간 / 22일)을 쓴다.
  assert.equal(M.ordinaryHourlyRate({ payType: 'salaried', monthlySalary: 3000000 }), 14354);
  assert.equal(M.dailyDeduction({ payType: 'salaried', monthlySalary: 3000000 }), 136364);
});

test('시급 직원과 월급 미설정은 공제·통상시급이 0이다', () => {
  assert.equal(M.ordinaryHourlyRate({ payType: 'hourly', hourlyRate: 12000 }), 0);
  assert.equal(M.dailyDeduction({ payType: 'hourly', hourlyRate: 12000 }), 0);
  assert.equal(M.ordinaryHourlyRate({ payType: 'salaried', monthlySalary: null }), 0);
  assert.equal(M.dailyDeduction({ payType: 'salaried', monthlySalary: 0 }), 0);
});

test('직원 저장 시 소정근로 기본값이 채워진다', () => {
  const 월급 = M.employeeInput({ name: '김수라', role: '', floor: 2, payType: 'salaried', monthlySalary: 3000000, breakMinutes: 0, active: true, note: '' });
  assert.equal(월급.monthlyWorkHours, M.DEFAULT_MONTHLY_WORK_HOURS);
  assert.equal(월급.monthlyWorkDays, M.DEFAULT_MONTHLY_WORK_DAYS);
  // 시급 직원에게는 쓰이지 않는다.
  const 시급 = M.employeeInput({ name: '김수라', role: '', floor: 2, payType: 'hourly', hourlyRate: 12000, breakMinutes: 0, active: true, note: '' });
  assert.equal(시급.monthlyWorkHours, 0);
  assert.equal(시급.monthlyWorkDays, 0);
});

test('잘못된 특수일·결근 입력은 거부한다', () => {
  const ok = { workDate: '2026-09-17', label: '설날', multiplierPercent: 150, appliesTo: 'both', note: '' };
  assert.equal(M.specialDayInput(ok).multiplierPercent, 150);
  for (const patch of [{ multiplierPercent: 49 }, { multiplierPercent: 501 }, { multiplierPercent: 1.5 }, { appliesTo: '전부' }, { workDate: '2026-13-01' }, { workDate: '2026-09-32' }, { workDate: '20260917' }, { label: '' }]) {
    assert.throws(() => M.specialDayInput({ ...ok, ...patch }), new RegExp('.'), JSON.stringify(patch));
  }
  assert.equal(M.absenceInput({ employeeId: 'abc123', workDate: '2026-09-17', note: '' }).workDate, '2026-09-17');
  assert.throws(() => M.absenceInput({ employeeId: '../x', workDate: '2026-09-17', note: '' }));
  assert.throws(() => M.absenceInput({ employeeId: 'abc123', workDate: '2026-09-00', note: '' }));
});

test('월급 직원 기록은 당시 통상시급을 남긴다', () => {
  const saved = M.shiftInput({ ...월급근무, ordinaryHourlyRate: 14354 }, at('2026-09-18T00:00:00+09:00'));
  assert.equal(saved.ordinaryHourlyRate, 14354);
  // 시급 기록에는 쓰지 않는다.
  assert.equal(M.shiftInput(시급근무, at('2026-09-18T00:00:00+09:00')).ordinaryHourlyRate, 0);
});
