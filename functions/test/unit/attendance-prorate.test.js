'use strict';

// 일당 직원은 출퇴근 시각이 사실상 정해져 있다. 정해진 시간을 못 채우고 간 날은
// 채운 만큼만 준다. 다만 30분쯤 먼저 가는 걸 매번 깎으면 정산이 시빗거리가 되니
// 그만큼은 봐준다. 여기서 갈리는 값은 관리자가 복사해 그대로 이체하는 금액이다.

const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../../attendanceModel');

const at = value => new Date(value).getTime();
const 출근 = at('2026-09-18T11:00:00+09:00');

// 일당 75,000원 · 정해진 근무 6시간 · 유예 30분 · 기준 뒤 30분마다 5,000원
const 근무 = (시간, 분 = 0, 덮어쓰기 = {}) => ({
  payType: 'perDiem', dailyMode: 'prorate', dayPortion: 'auto',
  checkInAt: 출근, checkOutAt: 출근 + (시간 * 60 + 분) * 60000, breakMinutes: 0,
  dailyPay: 75000, halfDayPay: 0, dailyBaseMinutes: 360,
  overtimeUnitMinutes: 30, overtimePay: 5000, note: '', ...덮어쓰기
});

test('정해진 시간을 못 채우면 채운 만큼만 준다', () => {
  // 6시간 중 3시간이면 절반.
  assert.equal(M.totals(근무(3)).amount, 37500);
  assert.equal(M.totals(근무(3)).dayPortion, 'part');
  assert.equal(M.totals(근무(4)).amount, 50000);
  assert.equal(M.totals(근무(5)).amount, 62500);
});

test('30분쯤 일찍 가는 건 깎지 않는다', () => {
  // 유예 안이면 전액이고 구분도 풀타임으로 남는다.
  assert.equal(M.totals(근무(5, 30)).amount, 75000);
  assert.equal(M.totals(근무(5, 30)).dayPortion, 'full');
  assert.equal(M.totals(근무(5, 45)).amount, 75000);
  assert.equal(M.totals(근무(6)).amount, 75000);
  // 유예를 1분이라도 넘기면 그때부터 깎는다.
  assert.equal(M.totals(근무(5, 29)).dayPortion, 'part');
  assert.ok(M.totals(근무(5, 29)).amount < 75000);
});

test('유예는 사람마다 정할 수 있고 0이면 1분부터 깎는다', () => {
  assert.equal(M.totals(근무(5, 30, { earlyGraceMinutes: 0 })).amount, 68750);
  assert.equal(M.totals(근무(5, 30, { earlyGraceMinutes: 0 })).dayPortion, 'part');
  // 한 시간까지 봐주기로 했으면 5시간도 전액.
  assert.equal(M.totals(근무(5, 0, { earlyGraceMinutes: 60 })).amount, 75000);
  // 값이 아예 없으면 기본 30분.
  const 유예없음 = 근무(5, 30);
  delete 유예없음.earlyGraceMinutes;
  assert.equal(M.totals(유예없음).amount, 75000);
  assert.equal(M.DEFAULT_EARLY_GRACE_MINUTES, 30);
});

test('기준을 넘기면 비례가 아니라 추가 급여가 붙는다', () => {
  // 일당을 넘겨 더 주는 몫은 추가 급여가 맡는다. 비례로 두 번 세면 안 된다.
  assert.equal(M.totals(근무(6, 29)).amount, 75000);
  assert.equal(M.totals(근무(6, 30)).amount, 80000);
  assert.equal(M.totals(근무(6, 30)).extraAmount, 5000);
  assert.equal(M.totals(근무(7)).amount, 85000);
  assert.equal(M.totals(근무(7)).baseAmount, 75000);
  // 못 채운 날에는 추가 급여가 붙지 않는다.
  assert.equal(M.totals(근무(3)).extraAmount, 0);
});

test('휴게시간을 뺀 시간으로 센다', () => {
  // 가게에 6시간 있었어도 휴게 1시간이면 유급 5시간이다.
  assert.equal(M.totals(근무(6, 0, { breakMinutes: 60 })).amount, 62500);
  assert.equal(M.totals(근무(6, 30, { breakMinutes: 30 })).amount, 75000);
});

test('관리자가 직접 정한 구분이 자동 판정보다 우선한다', () => {
  // 사정이 있어 일찍 보낸 날은 전액으로 쳐줄 수 있어야 한다.
  assert.equal(M.totals(근무(3, 0, { dayPortion: 'full' })).amount, 75000);
  // 비례에는 반타임 일당 칸이 없다. 반타임으로 지정하면 일당의 절반.
  assert.equal(M.totals(근무(6, 0, { dayPortion: 'half' })).amount, 37500);
  // 반타임 일당을 따로 적어 두었으면 그 금액이 먼저다.
  assert.equal(M.totals(근무(6, 0, { dayPortion: 'half', halfDayPay: 40000 })).amount, 40000);
});

test('예전 방식으로 저장된 기록은 금액이 그대로다', () => {
  // dailyMode 가 없는 옛 기록은 반타임·풀타임으로 계산돼야 한다.
  // 이미 정산해서 돈이 나간 기록의 금액이 바뀌면 안 된다.
  const 옛기록 = {
    payType: 'perDiem', dayPortion: 'auto', checkInAt: at('2026-09-01T09:00:00+09:00'),
    checkOutAt: at('2026-09-01T13:00:00+09:00'), breakMinutes: 0,
    dailyPay: 100000, halfDayPay: 55000, halfDayBeforeMinutes: 17 * 60,
    dailyBaseMinutes: 480, overtimeUnitMinutes: 30, overtimePay: 0, note: ''
  };
  assert.equal(M.dailyModeOf(옛기록), 'portion');
  assert.equal(M.totals(옛기록).amount, 55000);
  assert.equal(M.totals(옛기록).dayPortion, 'half');
  // 5시 넘겨 퇴근하면 풀타임. 4시간만 일했는지는 보지 않는다.
  assert.equal(M.totals({ ...옛기록, checkOutAt: at('2026-09-01T18:00:00+09:00') }).amount, 100000);
});

test('값이 빠져도 NaN 이나 음수가 나오지 않는다', () => {
  // 관리자가 복사해서 그대로 이체하는 금액이다.
  const 이상한값 = [undefined, null, 0, -5000, 'abc', NaN, Infinity];
  for (const bad of 이상한값) {
    for (const key of ['dailyPay', 'dailyBaseMinutes', 'earlyGraceMinutes', 'overtimePay', 'breakMinutes']) {
      const t = M.totals(근무(3, 0, { [key]: bad }));
      assert.ok(Number.isSafeInteger(t.amount) && t.amount >= 0, `${key}=${bad} → ${t.amount}`);
      assert.ok(Number.isSafeInteger(t.baseAmount) && t.baseAmount >= 0, `${key}=${bad} → base ${t.baseAmount}`);
      assert.ok(Number.isSafeInteger(t.extraAmount) && t.extraAmount >= 0, `${key}=${bad} → extra ${t.extraAmount}`);
    }
  }
});

test('일당보다 많이 나오지 않는다', () => {
  // 비례는 못 채운 날을 깎는 것이지 더 주는 장치가 아니다.
  for (const [시간, 분] of [[6, 0], [8, 0], [12, 0]]) {
    assert.equal(M.totals(근무(시간, 분, { overtimePay: 0 })).baseAmount, 75000);
  }
});

test('저장할 때 지급 방식과 유예를 검사한다', () => {
  const 직원 = extra => M.employeeInput({
    name: '화성댁', role: '홀', floor: 2, payType: 'perDiem', active: true,
    dailyPay: 75000, breakMinutes: 0, note: '', ...extra
  });
  assert.equal(직원({ dailyMode: 'prorate' }).dailyMode, 'prorate');
  assert.equal(직원({ dailyMode: 'prorate', earlyGraceMinutes: 45 }).earlyGraceMinutes, 45);
  // 0 은 '안 봐줌' 이라는 뜻이 있는 값이라 그대로 지켜야 한다.
  assert.equal(직원({ dailyMode: 'prorate', earlyGraceMinutes: 0 }).earlyGraceMinutes, 0);
  // 안 보내면 기본 30분.
  assert.equal(직원({ dailyMode: 'prorate' }).earlyGraceMinutes, 30);
  // 모르는 방식은 옛 방식으로 떨어뜨린다. 금액이 멋대로 바뀌면 안 된다.
  assert.equal(직원({ dailyMode: '아무거나' }).dailyMode, 'portion');
  assert.equal(직원({}).dailyMode, 'portion');
  // 범위를 벗어난 유예는 거부한다.
  assert.throws(() => 직원({ earlyGraceMinutes: -1 }), /일찍 퇴근 유예/);
  assert.throws(() => 직원({ earlyGraceMinutes: 2000 }), /일찍 퇴근 유예/);
  // 시급 직원에게는 저장되지 않는다.
  const 시급 = M.employeeInput({ name: '김미숙', role: '주방', floor: 2, payType: 'hourly',
    active: true, hourlyRate: 10500, breakMinutes: 0, note: '', dailyMode: 'prorate', earlyGraceMinutes: 45 });
  assert.equal(시급.dailyMode, 'portion');
  assert.equal(시급.earlyGraceMinutes, 0);
});
