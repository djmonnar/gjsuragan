'use strict';

// 매뉴얼은 화면에서 바로 읽는 문서다.
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

test('조퇴·차감 안내가 실제 계산과 맞고 두 번 깎지 말라고 적는다', () => {
  const { html } = render();
  const section = /id="sm-deduction"([\s\S]*?)<\/section>/.exec(html);
  assert.ok(section, '조퇴·차감 항목이 없습니다.');
  const body = section[1];
  // 예시 숫자를 실제 계산으로 다시 낸다.
  const 통상시급 = M.ordinaryHourlyRate({ payType: 'salaried', monthlySalary: 3000000 });
  assert.match(body, new RegExp(`통상시급 ${통상시급.toLocaleString('en-US')}원`));
  assert.match(body, new RegExp(`2시간\\(120분\\) 조퇴는 ${M.deductionForMinutes(120, 통상시급).toLocaleString('en-US')}원`));
  assert.match(body, new RegExp(`30분은 ${M.deductionForMinutes(30, 통상시급).toLocaleString('en-US')}원`));
  assert.match(body, /시급 × 분 ÷ 60/);
  // 시급 직원은 일찍 퇴근하면 이미 덜 나간다 — 모르면 두 번 깎는다.
  assert.match(body, /두 번 깎입니다/);
  assert.match(body, /미퇴근 기록의 차감은 급여에 잡히지 않습니다/);
  // 정산 표에도 차감이 들어가 있어야 한다.
  assert.match(html, /결근 공제 <b>−<\/b> 근무 차감/);
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

// ── 매뉴얼로 바꾸며 더한 항목 ──
// 새로 적은 숫자·시각·버튼 이름을 실제 코드에서 다시 뽑아 대조한다.

const source = file => fs.readFileSync(path.join(root, file), 'utf8');
const section = (html, id) => {
  const match = new RegExp(`id="sm-${id}"([\\s\\S]*?)</section>`).exec(html);
  assert.ok(match, `${id} 항목이 없습니다.`);
  return match[1];
};
const UI = (() => {
  const window = {};
  vm.runInNewContext(source('assets/js/attendance-ui.js'), { window, URLSearchParams });
  return window.AttendanceUI;
})();
const at = value => new Date(value).getTime();

// 급여 정산 화면을 실제로 그려서 입금 기준액을 낸다. 매뉴얼 그림의 금액이 화면과 같아야 한다.
function adminPayout({ 월급, 조퇴 }) {
  const nodes = new Map();
  const el = id => {
    if (!nodes.has(id)) nodes.set(id, { innerHTML: '', textContent: '', value: '', append() {}, classList: { toggle() {}, add() {} } });
    return nodes.get(id);
  };
  const window = {};
  vm.runInNewContext(source('assets/js/attendance-ui.js'), { window, URLSearchParams });
  const document = { getElementById: el, querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, removeEventListener() {} };
  const code = source('assets/js/attendance-admin.js').replace('window.AttendanceAdmin = { init, dispose };',
    'window.AttendanceAdmin = { render, payrollRows, records, transferAmount, load: s => { data = s; view = "payroll"; month = "2026-09"; selectedDate = "2026-09-17"; floor = "all"; employeeId = ""; } };');
  vm.runInNewContext(code, { window, document, Intl, URLSearchParams, setTimeout, clearTimeout, navigator: {} });
  const api = window.AttendanceAdmin;
  api.load({
    employees: [{ id: 's1', name: '김수라', role: '', floor: 2, payType: 'salaried', monthlySalary: 월급, breakMinutes: 60, active: true }],
    shifts: [{ id: 'x1', employeeId: 's1', employeeName: '김수라', floor: 2, workDate: '2026-09-17',
      checkInAt: at('2026-09-17T09:00:00+09:00'), checkOutAt: at('2026-09-17T16:00:00+09:00'), breakMinutes: 60,
      payType: 'salaried', payableMinutes: 360, amount: 0, baseAmount: 0, extraAmount: 0, multiplierPercent: 100,
      deductionAmount: 조퇴, deductionReason: '2시간 조퇴', note: '' }],
    openShifts: [], devices: [], specialDays: [],
    absences: [{ id: 's1_2026-09-16', employeeId: 's1', employeeName: '김수라', floor: 2, workDate: '2026-09-16', note: '' }],
    serverNow: at('2026-09-30T10:00:00+09:00')
  });
  api.render();
  assert.match(el('att-content').innerHTML, /근무 차감 \(1건\)/);
  return api.transferAmount(api.payrollRows(api.records()).find(row => row.id === 's1'));
}

test('탭 이름이 매뉴얼이고 처음 보는 사람을 위한 길잡이가 있다', () => {
  const { html } = render();
  assert.match(source('staff-admin.html'), /data-panel="manual">매뉴얼<\/a>/);
  assert.match(source('assets/js/staff-admin.js'), /manual: '매뉴얼'/);
  assert.match(html, /<h2>매뉴얼<\/h2>/);
  assert.match(html, /무엇을 하고 싶으세요/);
  // 목차는 모든 절을 빠짐없이 가리킨다.
  const ids = [...html.matchAll(/<section class="sm-section" id="(sm-[a-z]+)"/g)].map(m => m[1]);
  assert.ok(ids.length >= 15, `절이 너무 적습니다: ${ids.length}`);
  const toc = /<nav class="sm-toc"[\s\S]*?<\/nav>/.exec(html)[0];
  for (const id of ids) assert.match(toc, new RegExp(`href="#${id}"`), `${id} 가 목차에 없습니다.`);
});

test('절 안에 <section> 을 또 두지 않는다', () => {
  // 이 파일의 테스트들이 절을 '</section> 까지'로 잘라 읽는다. 겹치면 절이 중간에서 잘린다.
  const { html } = render();
  assert.equal((html.match(/<section/g) || []).length, (html.match(/class="sm-section"/g) || []).length);
});

test('직원 등록의 급여 유형 예시가 실제 계산과 맞는다', () => {
  const { html } = render();
  const body = section(html, 'employee');
  const 시급 = M.totals({ checkInAt: at('2026-09-17T09:00:00+09:00'), checkOutAt: at('2026-09-17T18:00:00+09:00'),
    breakMinutes: 60, payType: 'hourly', hourlyRate: 12000 });
  assert.match(body, new RegExp(`그날 ${시급.amount.toLocaleString('en-US')}원`));
  const 일당 = M.totals({ checkInAt: at('2026-09-17T09:00:00+09:00'), checkOutAt: at('2026-09-17T18:00:00+09:00'),
    breakMinutes: 0, payType: 'perDiem', dailyPay: 100000 });
  assert.equal(일당.amount, 100000);
  assert.match(body, new RegExp(`20일 → ${(일당.amount * 20).toLocaleString('en-US')}원`));
  // 비워 두면 쓰는 기본값도 실제와 같아야 한다.
  assert.match(body, new RegExp(`${M.DEFAULT_MONTHLY_WORK_HOURS}시간 · ${M.DEFAULT_MONTHLY_WORK_DAYS}일`));
  assert.match(body, /한 시간 넘게/);
});

test('기록 고치기 그림의 금액이 실제 계산과 맞는다', () => {
  // 11시 출근인 직원이 10시 52분에 찍고 7시에 퇴근 · 휴게 1시간 · 시급 12,000원.
  const { html } = render();
  const body = section(html, 'fix');
  const t = M.totals({ checkInAt: at('2026-09-17T10:52:00+09:00'), checkOutAt: at('2026-09-17T19:00:00+09:00'),
    breakMinutes: 60, payType: 'hourly', hourlyRate: 12000, scheduledStarts: [11 * 60] });
  assert.equal(t.earlyMinutes, 8);
  assert.match(body, new RegExp(`${UI.duration(t.payableMinutes)} · 휴게 60분`));
  assert.match(body, new RegExp(`12,000원/시간 · ${t.amount.toLocaleString('en-US')}원 · 일찍 출근 ${t.earlyMinutes}분 제외`));
});

test('급여 정산 그림의 금액이 관리 화면 계산과 같다', () => {
  // 그림: 월급 300만원 · 결근 하루 · 2시간 조퇴 한 번.
  const { html } = render();
  const body = section(html, 'payroll');
  const 월급 = 3000000;
  const 결근 = M.dailyDeduction({ payType: 'salaried', monthlySalary: 월급 });
  const 조퇴 = M.deductionForMinutes(120, M.ordinaryHourlyRate({ payType: 'salaried', monthlySalary: 월급 }));
  const 입금 = adminPayout({ 월급, 조퇴 });
  assert.equal(입금, 월급 - 결근 - 조퇴);
  for (const n of [월급, 결근, 조퇴, 입금]) {
    assert.match(body, new RegExp(n.toLocaleString('en-US')), `${n} 이 그림에 없습니다`);
  }
});

test('관리 화면·태블릿의 시간 규칙이 코드와 같다', () => {
  const { html } = render();
  // 퇴근 확인 알림은 출근 뒤 18시간이 지난 기록에 뜬다.
  assert.match(source('assets/js/attendance-admin.js'), /data\.serverNow - s\.checkInAt > 18 \* 3600000/);
  assert.match(section(html, 'daily'), /18시간이 넘도록/);
  // 한 기록은 36시간까지. 넘으면 태블릿이 이 문구로 막는다.
  assert.equal(M.MAX_SHIFT_MS, 36 * 3600000);
  assert.match(section(html, 'fix'), /36시간/);
  assert.match(source('functions/attendance.js'), /출근 후 36시간이 지났습니다/);
  assert.match(section(html, 'trouble'), /출근 후 36시간이 지났습니다/);
  // 이른 출근은 한 시간 안쪽만 뺀다. 예전 안내의 '세 시간'은 틀린 말이었다.
  assert.equal(M.EARLY_CLOCK_IN_WINDOW_MINUTES, 60);
  assert.match(section(html, 'dailyworker'), /한 시간 넘게/);
  assert.doesNotMatch(html, /세 시간 넘게/);
  // 새로고침 주기.
  assert.match(source('assets/js/attendance-admin.js'), /load\(true\); \}, 60000\)/);
  assert.match(section(html, 'screen'), /1분마다/);
  assert.match(source('assets/js/attendance-kiosk.js'), /loadOrders\(\); \} \}, 15000\)/);
  assert.match(section(html, 'daily'), /15초마다/);
  assert.match(source('assets/js/attendance-kiosk.js'), /const ORDERS_MS = 180000;/);
  assert.match(section(html, 'start'), /3분마다/);
  assert.match(source('assets/js/attendance-bookings.js'), /setInterval\(sync, 5 \* 60000\)/);
  assert.match(source('assets/js/attendance-bookings-admin.js'), /setInterval\(refresh, 5 \* 60000\)/);
  assert.match(section(html, 'reservations'), /5분마다/);
});

test('퇴근을 안 찍은 날의 함정을 알린다', () => {
  // 퇴근을 안 찍은 직원은 다음 날 태블릿에 출근이 아니라 퇴근이 뜬다. 누르면 하루 넘는 근무가 된다.
  const { html } = render();
  assert.match(source('assets/js/attendance-kiosk.js'), /action: working \? '퇴근' : '출근'/);
  assert.match(section(html, 'daily'), /출근하기<\/b>가 아니라 <b>퇴근하기<\/b>가 나옵니다/);
  assert.match(section(html, 'trouble'), /그동안 일한 날은 기록이 없습니다/);
  assert.match(section(html, 'rules'), /퇴근 확인 알림을 쌓아 두지 마세요/);
});

test('태블릿 주소가 실제 매장 값으로 열린다', () => {
  const { html } = render();
  assert.equal(UI.setupStore('?store=suragan'), 2);
  assert.equal(UI.setupStore('?store=doldam'), 1);
  assert.equal(UI.storeName(2), '궁중수라간');
  assert.match(section(html, 'start'), /궁중수라간은 <code>attendance\.html\?store=suragan<\/code>, 돌담명가는 <code>attendance\.html\?store=doldam<\/code>/);
});

test('매장 관리 화면에 없는 버튼을 안내하지 않는다', () => {
  // 근태 화면의 '태블릿 화면 ↗'은 매장 관리 화면에서 CSS 로 숨겨져 있다. 대신 맨 위 '출퇴근 화면 ↗'을 쓴다.
  const { html } = render();
  assert.match(source('assets/css/staff-admin.css'), /\.staff-app \.att-topline>\.att-filters>a\{display:none\}/);
  assert.doesNotMatch(html, /태블릿 화면 ↗/);
  assert.match(source('staff-admin.html'), />출퇴근 화면 ↗</);
  assert.match(section(html, 'screen'), /출퇴근 화면 ↗/);
});

test('예약 안내가 실제 제한과 같다', () => {
  const { html } = render();
  const body = section(html, 'reservations');
  const { bookingInput } = require('../../attendanceBookings');
  const now = at('2026-09-30T10:00:00+09:00');
  const base = { requestId: '8b1f2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d', name: '홍길동', time: '12:00', menu: '한정식', people: 2 };
  assert.doesNotThrow(() => bookingInput({ ...base, date: '2026-09-30' }, now));
  assert.throws(() => bookingInput({ ...base, date: '2027-10-01' }, now));
  assert.match(body, /오늘부터 1년 안/);
  // 건수에 들어가는 상태.
  assert.match(source('functions/attendanceBookings.js'), /const ACTIVE = new Set\(\['requested', 'confirmed', 'completed'\]\)/);
  assert.match(body, /예약 신청 · 확정 · 이용 완료/);
});

test('특수일 배율 범위가 실제 검증과 같다', () => {
  const { html } = render();
  const day = percent => M.specialDayInput({ workDate: '2026-09-17', label: '추석', multiplierPercent: percent, appliesTo: 'both', note: '' });
  assert.doesNotThrow(() => day(50));
  assert.doesNotThrow(() => day(500));
  assert.throws(() => day(49));
  assert.throws(() => day(501));
  assert.match(section(html, 'special'), /0\.5배부터 5배까지/);
});

test('용어 풀이의 숫자가 실제 기본값과 같다', () => {
  const { html } = render();
  const body = section(html, 'glossary');
  assert.match(body, new RegExp(`${M.ordinaryHourlyRate({ payType: 'salaried', monthlySalary: 3000000 }).toLocaleString('en-US')}원`));
  assert.match(body, new RegExp(`${M.DEFAULT_MONTHLY_WORK_HOURS}시간`));
  assert.match(body, new RegExp(`${M.DEFAULT_MONTHLY_WORK_DAYS}일`));
  assert.match(body, new RegExp(`기본 ${M.DEFAULT_EARLY_GRACE_MINUTES}분`));
  assert.match(body, new RegExp(`기본 ${M.DEFAULT_DAILY_BASE_MINUTES / 60}시간`));
  // 3.3% = 소득세 3% + 지방소득세 0.3%
  assert.equal(M.WITHHOLDING_PER_MILLE, 33);
  assert.match(body, /소득세 3% \+ 지방소득세 0\.3%/);
});
