'use strict';

// 사용 안내는 화면에서 바로 읽는 문서다.
// 실제 동작과 어긋나면 안내가 아니라 오답이 된다.
// 계산 기준값은 attendanceModel 에서 직접 읽어 대조한다.

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const M = require('../../attendanceModel');

const root = path.resolve(__dirname, '../../..');

function render() {
  const nodes = new Map();
  const make = () => ({ innerHTML: '', textContent: '', querySelectorAll: () => [], querySelector: () => null, focus() {}, scrollIntoView() {}, getAttribute: () => null });
  const el = id => { if (!nodes.has(id)) nodes.set(id, make()); return nodes.get(id); };
  const window = {};
  const document = { getElementById: el, querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, removeEventListener() {} };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'assets/js/staff-manual.js'), 'utf8'), { window, document });
  window.StaffManual.init();
  return { html: el('manual-root').innerHTML, api: window.StaffManual, root: el('manual-root') };
}

test('안내가 그려지고 목차와 본문이 짝이 맞는다', () => {
  const { html } = render();
  const anchors = [...html.matchAll(/href="#(sm-[a-z]+)"/g)].map(m => m[1]);
  assert.ok(anchors.length >= 7, `목차가 너무 적습니다: ${anchors.length}`);
  for (const id of anchors) {
    assert.match(html, new RegExp(`id="${id}"`), `${id} 본문이 없습니다.`);
  }
});

test('결근 안내가 실제 동작을 그대로 적고 있다', () => {
  const { html } = render();
  const section = /id="sm-absence"([\s\S]*?)<\/section>/.exec(html);
  assert.ok(section, '결근 항목이 없습니다.');
  const body = section[1];
  // 관리자가 표시한 날만 공제한다는 것 — 이걸 빠뜨리면 휴무까지 깎는 줄 안다.
  assert.match(body, /표시한 날만 공제/);
  assert.match(body, /자동으로 결근이 되지는 않습니다/);
  // 시급 직원은 공제 없음
  assert.match(body, /시급 직원은 공제되지 않습니다/);
  // 공제 공식
  assert.match(body, /월급 ÷ 월 소정근로일수/);
});

test('안내에 적힌 기준값이 실제 계산과 같다', () => {
  const { html } = render();
  // 기본값이 바뀌면 안내도 같이 바뀌어야 한다.
  assert.match(html, new RegExp(`${M.DEFAULT_MONTHLY_WORK_HOURS}시간`));
  assert.match(html, new RegExp(`${M.DEFAULT_MONTHLY_WORK_DAYS}일`));
  // 예시로 든 하루 공제액이 실제 계산과 맞아야 한다.
  const 하루 = M.dailyDeduction({ payType: 'salaried', monthlySalary: 3000000, monthlyWorkDays: 22 });
  assert.match(html, new RegExp(하루.toLocaleString('en-US').replace(/,/g, ',')));
});

test('특수일 안내가 시급·월급을 구분해 적고 있다', () => {
  const { html } = render();
  const section = /id="sm-special"([\s\S]*?)<\/section>/.exec(html)[1];
  assert.match(section, /근무시간 × 시급 × 1\.5/);
  assert.match(section, /근무시간 × 통상시급 × 1\.5/);
  // 지나고 나서 등록해도 반영된다는 것 — 실제로 계산 시점에 찾기 때문이다.
  assert.match(section, /지나고 나서 등록해도 됩니다/);
});

test('단기 알바 안내가 삭제하면 계좌가 지워진다고 알린다', () => {
  const { html } = render();
  const section = /id="sm-parttime"([\s\S]*?)<\/section>/.exec(html)[1];
  assert.match(section, /계좌번호가 같이 지워/);
  assert.match(section, /재직 중.{0,10}체크/);
});

test('급여 안내가 세금·4대보험이 빠져 있지 않다고 밝힌다', () => {
  const { html } = render();
  assert.match(html, /4대보험과 주휴·연장·야간수당은 빠져 있지 않습니다/);
});

test('일일근무자 안내가 자리와 사람을 구분해 적고 있다', () => {
  const { html } = render();
  const section = /id="sm-dailyworker"([\s\S]*?)<\/section>/.exec(html);
  assert.ok(section, '일일근무자 항목이 없습니다.');
  const body = section[1];
  // 한 자리를 여러 명이 같이 쓴다는 것 — 이걸 모르면 사람마다 자리를 만든다.
  assert.match(body, /같은 칸으로 또 출근/);
  assert.match(body, /기록마다 한 줄/);
  // 홀·주방·매장별로 따로 만들 수 있다는 것
  assert.match(body, /일일근무자 \(홀\)/);
  assert.match(body, /일일근무자 \(주방\)/);
  // 배율이 안 붙는다는 것 — 명절에 더 주려다 안 붙으면 헤맨다
  assert.match(body, /특수일 배율은 붙지 않습니다/);
  // 시간과 무관하다는 것
  assert.match(body, /시간과 상관없이 하루치/);
});

test('일일근무자 추가 급여 예시가 실제 계산과 맞는다', () => {
  // 매뉴얼에 적힌 숫자를 실제 계산 함수로 다시 내서 대조한다.
  // 계산을 바꾸고 매뉴얼을 안 고치면 여기서 깨진다.
  const { html } = render();
  const 일당 = 100000, 단위급여 = 10000;
  const at = value => new Date(value).getTime();
  const 근무 = out => ({
    checkInAt: at('2026-09-17T09:00:00+09:00'), checkOutAt: at(out), breakMinutes: 60,
    payType: 'daily', hourlyRate: 0, dailyPay: 일당,
    dailyBaseMinutes: M.DEFAULT_DAILY_BASE_MINUTES,
    overtimeUnitMinutes: M.DEFAULT_OVERTIME_UNIT_MINUTES, overtimePay: 단위급여
  });
  const 예시 = [
    ['2026-09-17T18:00:00+09:00', 0],
    ['2026-09-17T18:20:00+09:00', 0],
    ['2026-09-17T18:30:00+09:00', 1],
    ['2026-09-17T19:00:00+09:00', 2],
    ['2026-09-17T21:00:00+09:00', 6]
  ];
  for (const [out, 회] of 예시) {
    const t = M.totals(근무(out));
    assert.equal(t.overtimeUnits, 회, `${out} 는 ${회}회여야 합니다`);
    // 일당 + 추가 금액이 표에 그대로 있어야 한다.
    assert.match(html, new RegExp(t.amount.toLocaleString('en-US')), `${t.amount} 가 표에 없습니다`);
    // 3.3% 를 뗀 금액도.
    assert.match(html, new RegExp(M.netPay(t.amount, true).toLocaleString('en-US')), `${M.netPay(t.amount, true)} 가 표에 없습니다`);
  }
  // 기본값도 문서와 같아야 한다.
  assert.match(html, new RegExp(`기본 ${M.DEFAULT_DAILY_BASE_MINUTES / 60}시간`));
  assert.match(html, new RegExp(`기본 ${M.DEFAULT_OVERTIME_UNIT_MINUTES}분`));
});

test('이른 출근·초과 시급 안내가 실제 계산과 맞는다', () => {
  const { html } = render();
  const at = value => new Date(value).getTime();
  // 7시 출근 · 기준 7시간 · 예정 출근 07:00 · 30분마다 10,000원 — 6시 50분에 찍은 날.
  const 일찍 = out => ({
    checkInAt: at('2026-09-17T06:50:00+09:00'), checkOutAt: at(out), breakMinutes: 0,
    payType: 'perDiem', hourlyRate: 0, dailyPay: 100000, halfDayPay: 0,
    dailyBaseMinutes: 420, scheduledStartMinutes: 7 * 60,
    overtimeUnitMinutes: M.DEFAULT_OVERTIME_UNIT_MINUTES, overtimePay: 10000
  });
  assert.equal(M.totals(일찍('2026-09-17T14:20:00+09:00')).extraAmount, 0);
  assert.equal(M.totals(일찍('2026-09-17T14:50:00+09:00')).extraAmount, 10000);
  assert.match(html, /6시 50분에 찍고 2시 20분에 가면 추가 급여가 없습니다/);
  // 초과 시급 12,000원이면 30분 초과는 6,000원, 1시간 초과는 12,000원.
  const 시급초과 = { ...일찍('2026-09-17T15:00:00+09:00'), checkInAt: at('2026-09-17T07:00:00+09:00'),
    overtimePay: 0, overtimeHourlyRate: 12000 };
  assert.equal(M.totals(시급초과).overtimeUnits, 2);
  assert.equal(M.totals(시급초과).extraAmount, 12000);
  assert.equal(M.totals({ ...시급초과, checkOutAt: at('2026-09-17T14:30:00+09:00') }).extraAmount, 6000);
  assert.match(html, /30분 초과는 6,000원, 1시간 초과는 12,000원/);
});

test('원천징수 안내가 세율과 맞고 무엇이 안 빠지는지 밝힌다', () => {
  const { html } = render();
  assert.match(html, new RegExp(`${M.WITHHOLDING_PER_MILLE / 10}% 원천징수`));
  // 4대보험은 여전히 안 빠진다는 것 — 그대로 이체하면 안 된다.
  assert.match(html, /4대보험.{0,20}빠져 있지 않습니다/);
  assert.match(html, /세무 신고를 대신하지 않습니다/);
});

test('일당 직원 안내가 퇴근 시각 기준을 분명히 적는다', () => {
  const { html } = render();
  const section = /id="sm-perdiem"([\s\S]*?)<\/section>/.exec(html);
  assert.ok(section, '일당 직원 항목이 없습니다.');
  const body = section[1];
  // 근무시간이 아니라 시각이라는 것 — 이걸 모르면 계산이 왜 그런지 못 읽는다.
  assert.match(body, /몇 시간 일했는지가 아니라 언제 일했는지/);
  // 점심 반타임과 저녁 반타임 둘 다 적혀 있어야 한다.
  assert.match(body, /오후 5시 전에 퇴근하면 반타임/);
  assert.match(body, /오후 5시 이후에 출근하면 반타임/);
  assert.match(body, /한국시간/);
  // 밤샘이 반타임이 되지 않는다는 것
  assert.match(body, /날짜를 넘겨 퇴근하면 풀타임/);
  // 결근 공제가 없다는 것
  assert.match(body, /결근 공제는 없습니다/);
});

test('일당 직원 예시가 실제 판정과 맞는다', () => {
  // 표에 적은 시각별 구분을 실제 계산 함수로 다시 내서 대조한다.
  const { html } = render();
  const at = value => new Date(value).getTime();
  const 근무 = time => ({
    checkInAt: at('2026-09-17T09:00:00+09:00'), checkOutAt: at(`2026-09-17T${time}:00+09:00`),
    breakMinutes: 0, payType: 'perDiem', hourlyRate: 0, dailyPay: 100000, halfDayPay: 55000,
    halfDayBeforeMinutes: M.DEFAULT_HALF_DAY_BEFORE_MINUTES,
    dailyBaseMinutes: M.DEFAULT_DAILY_BASE_MINUTES, overtimeUnitMinutes: M.DEFAULT_OVERTIME_UNIT_MINUTES, overtimePay: 10000
  });
  assert.equal(M.totals(근무('13:00')).dayPortion, 'half');
  assert.equal(M.totals(근무('16:59')).dayPortion, 'half');
  assert.equal(M.totals(근무('17:00')).dayPortion, 'full');
  // 저녁 반타임 — 기준 시각에 출근해 마감까지 한 경우.
  const 저녁 = { ...근무('21:00'), checkInAt: at('2026-09-17T17:00:00+09:00') };
  assert.equal(M.totals(저녁).dayPortion, 'half');
  assert.equal(M.totals(저녁).amount, M.totals(근무('13:00')).amount);
  // 표의 금액이 실제 계산과 같아야 한다.
  assert.match(html, new RegExp(M.totals(근무('13:00')).amount.toLocaleString('en-US')));
  assert.match(html, new RegExp(M.totals(근무('17:00')).amount.toLocaleString('en-US')));
  // 기준 시각도 문서와 같아야 한다.
  const 시 = String(Math.floor(M.DEFAULT_HALF_DAY_BEFORE_MINUTES / 60)).padStart(2, '0');
  assert.match(html, new RegExp(`${시}:00`));
  assert.match(html, new RegExp(`오후 ${Math.floor(M.DEFAULT_HALF_DAY_BEFORE_MINUTES / 60) - 12}시 전에 퇴근하면 반타임`));
});

test('비례 지급 예시가 실제 계산과 맞는다', () => {
  // 안내에 적은 금액을 실제 계산 함수로 다시 내서 대조한다.
  // 계산을 고치고 안내를 안 고치면 여기서 깨진다.
  const { html } = render();
  const 출근 = new Date('2026-09-18T11:00:00+09:00').getTime();
  const 근무 = (시간, 분 = 0) => ({
    payType: 'perDiem', dailyMode: 'prorate', dayPortion: 'auto',
    checkInAt: 출근, checkOutAt: 출근 + (시간 * 60 + 분) * 60000, breakMinutes: 0,
    dailyPay: 75000, halfDayPay: 0, dailyBaseMinutes: 360,
    earlyGraceMinutes: M.DEFAULT_EARLY_GRACE_MINUTES,
    overtimeUnitMinutes: M.DEFAULT_OVERTIME_UNIT_MINUTES, overtimePay: 5000
  });
  for (const [시간, 분] of [[3, 0], [5, 0], [5, 29]]) {
    const t = M.totals(근무(시간, 분));
    assert.equal(t.dayPortion, 'part');
    assert.match(html, new RegExp(t.amount.toLocaleString('en-US')));
  }
  // 유예 안쪽은 전액이어야 하고, 그 값이 안내에도 적혀 있어야 한다.
  assert.equal(M.totals(근무(5, 30)).dayPortion, 'full');
  assert.equal(M.totals(근무(5, 30)).amount, 75000);
  assert.match(html, /75,000원/);
  // 기준을 넘긴 몫은 추가 급여로 붙는다.
  assert.equal(M.totals(근무(6, 30)).extraAmount, 5000);
  assert.match(html, new RegExp(`유예 ${M.DEFAULT_EARLY_GRACE_MINUTES}분`));
  assert.match(html, new RegExp(`기본 ${M.DEFAULT_EARLY_GRACE_MINUTES}분`));
});

test('다시 열어도 내용이 겹치지 않는다', () => {
  const { api, root } = render();
  const once = (root.innerHTML.match(/id="sm-absence"/g) || []).length;
  api.init();
  assert.equal((root.innerHTML.match(/id="sm-absence"/g) || []).length, once, '두 번 그려졌습니다.');
  api.dispose();
  assert.equal(root.innerHTML, '');
  api.init();
  assert.match(root.innerHTML, /id="sm-absence"/);
});
