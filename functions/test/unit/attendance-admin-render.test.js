'use strict';

// 관리자 화면을 실제로 그려본다.
// 특수일·결근은 템플릿 문자열 안에서 조립되므로, 순수 함수 테스트로는
// 참조 오류나 빠진 값이 잡히지 않는다. 화면이 안 그려지면 급여를 못 본다.

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../../..');
const at = value => new Date(value).getTime();

function screen(state) {
  const nodes = new Map();
  const el = id => {
    if (!nodes.has(id)) nodes.set(id, { innerHTML: '', textContent: '', value: '', append() {}, classList: { toggle() {}, add() {} } });
    return nodes.get(id);
  };
  const window = {};
  vm.runInNewContext(fs.readFileSync(path.join(root, 'assets/js/attendance-ui.js'), 'utf8'), { window, URLSearchParams });
  const document = { getElementById: el, querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, removeEventListener() {} };
  const source = fs.readFileSync(path.join(root, 'assets/js/attendance-admin.js'), 'utf8')
    .replace('window.AttendanceAdmin = { init, dispose };',
      'window.AttendanceAdmin = { render, payrollRows, records, load: s => { data = s.data; view = s.view; month = s.month; selectedDate = s.selectedDate; floor = s.floor ?? "all"; employeeId = s.employeeId ?? ""; } };');
  vm.runInNewContext(source, { window, document, Intl, URLSearchParams, setTimeout, clearTimeout, navigator: {} });
  window.AttendanceAdmin.load(state);
  window.AttendanceAdmin.render();
  return { html: el('att-content').innerHTML, stats: el('att-stats').innerHTML, api: window.AttendanceAdmin };
}

const 시급직원 = { id: 'h1', name: '박알바', role: '', floor: 2, payType: 'hourly', hourlyRate: 12000, breakMinutes: 60, active: true };
const 월급직원 = { id: 's1', name: '김수라', role: '', floor: 2, payType: 'salaried', monthlySalary: 3000000, monthlyWorkHours: 209, monthlyWorkDays: 22, breakMinutes: 60, active: true };
// 설날 1.5배가 적용된 하루 (서버가 붙여 보내는 모양 그대로)
const 시급근무 = { id: 'x1', employeeId: 'h1', employeeName: '박알바', floor: 2, workDate: '2026-09-17', checkInAt: at('2026-09-17T09:00:00+09:00'), checkOutAt: at('2026-09-17T18:00:00+09:00'), breakMinutes: 60, payType: 'hourly', hourlyRate: 12000, payableMinutes: 480, amount: 144000, baseAmount: 96000, extraAmount: 48000, multiplierPercent: 150, note: '' };
const 월급근무 = { id: 'x2', employeeId: 's1', employeeName: '김수라', floor: 2, workDate: '2026-09-17', checkInAt: at('2026-09-17T09:00:00+09:00'), checkOutAt: at('2026-09-17T18:00:00+09:00'), breakMinutes: 60, payType: 'salaried', hourlyRate: 0, ordinaryHourlyRate: 14354, payableMinutes: 480, amount: 172248, baseAmount: 0, extraAmount: 172248, multiplierPercent: 150, note: '' };

const baseState = view => ({
  view, month: '2026-09', selectedDate: '2026-09-17',
  data: {
    employees: [시급직원, 월급직원], shifts: [시급근무, 월급근무], openShifts: [], devices: [],
    specialDays: [{ id: '2026-09-17', workDate: '2026-09-17', label: '설날', multiplierPercent: 150, appliesTo: 'both', note: '' }],
    absences: [{ id: 's1_2026-09-16', employeeId: 's1', employeeName: '김수라', floor: 2, workDate: '2026-09-16', note: '무단결근' }],
    serverNow: at('2026-09-18T10:00:00+09:00')
  }
});

test('근태 캘린더에 특수일과 결근이 나온다', () => {
  const { html } = screen(baseState('calendar'));
  assert.match(html, /설날/);
  assert.match(html, /1\.5배/);
  assert.match(html, /결근 표시/);
  // 시급 직원은 그날 급여가 배율만큼, 가산분도 같이 보인다.
  assert.match(html, /144,000원/);
  assert.match(html, /가산 48,000원/);
  // 월급 직원은 월급 위에 얹는 가산분만 보인다.
  assert.match(html, /특수일 가산 <strong>172,248원<\/strong>/);
});

test('결근한 날을 고르면 그 줄이 보인다', () => {
  const state = baseState('calendar');
  state.selectedDate = '2026-09-16';
  const { html } = screen(state);
  assert.match(html, /결근 · <strong>김수라<\/strong>/);
  assert.match(html, /무단결근/);
  assert.match(html, /특수일 아님/);
});

test('특수일·결근 줄은 여백 있는 칸 안에 들어간다', () => {
  // 이 두 줄은 att-day-summary 바깥에 있어서, 감싸는 칸이 없으면 패널 가장자리에
  // 붙어 위아래 줄과 어긋난다. 실제로 화면이 깨졌던 자리다.
  const { html } = screen(baseState('calendar'));
  assert.match(html, /<div class="att-day-meta">/);
  const meta = /<div class="att-day-meta">([\s\S]*?)<div class="att-day-summary">/.exec(html);
  assert.ok(meta, 'att-day-meta 와 att-day-summary 순서가 어긋났습니다.');
  assert.match(meta[1], /설날/);
  // 특수일이 없는 날에도 칸은 있어야 한다. 빈 칸은 CSS 의 :not(:empty) 가 접는다.
  const 평일 = baseState('calendar');
  평일.selectedDate = '2026-09-15';
  assert.match(screen(평일).html, /<div class="att-day-meta">.*특수일 아님/);
});

test('급여 정산에 월급 + 가산 − 공제가 줄로 보인다', () => {
  const { html } = screen(baseState('payroll'));
  assert.match(html, /약정 월급/);
  assert.match(html, /특수일 가산 \(1일 · 통상시급 14,354원\)/);
  assert.match(html, /결근 공제 \(1일\)/);
  // 3,000,000 + 172,248 − 136,364
  assert.match(html, /3,035,884원/);
  // 시급 직원은 배율이 들어간 금액 그대로
  assert.match(html, /144,000원/);
});

const 일일자리 = { id: 'd1', name: '일일근무자 (홀)', role: '홀', floor: 2, payType: 'daily', dailyPay: 100000, breakMinutes: 0, active: true };
const 일일근무 = (id, workerName, dailyPay) => ({
  id, employeeId: 'd1', employeeName: '일일근무자 (홀)', floor: 2, workDate: '2026-09-17',
  checkInAt: at('2026-09-17T09:00:00+09:00'), checkOutAt: at('2026-09-17T18:00:00+09:00'),
  breakMinutes: 0, payType: 'daily', hourlyRate: 0, dailyPay, workerName, workerNote: '',
  payableMinutes: 540, amount: dailyPay, baseAmount: dailyPay, extraAmount: 0, multiplierPercent: 100, note: ''
});

test('일일근무자는 한 자리라도 기록마다 한 줄로 나온다', () => {
  // 자리로 묶으면 누구에게 얼마를 줄지 알 수 없다.
  const state = baseState('payroll');
  state.data.employees = [일일자리];
  state.data.shifts = [일일근무('s1', '김일손', 100000), 일일근무('s2', '', 120000)];
  state.data.absences = [];
  const { html } = screen(state);
  assert.match(html, /김일손/);
  assert.match(html, /이름 미입력/);
  assert.match(html, /100,000원/);
  assert.match(html, /120,000원/);
  assert.match(html, /일일근무자 실지급 합계<\/span><strong>220,000원/);
});

test('일일근무자 초과 급여가 내역 줄로 보인다', () => {
  const state = baseState('payroll');
  state.data.employees = [일일자리];
  // 9시간 10분 일해서 30분 단위로 2회 붙었다 (일당 10만 + 2만)
  state.data.shifts = [{ ...일일근무('s1', '김일손', 100000), payableMinutes: 550,
    amount: 120000, baseAmount: 100000, extraAmount: 20000, overtimeUnits: 2, overtimeUnitMinutes: 30 }];
  state.data.absences = [];
  const { html } = screen(state);
  assert.match(html, /일당<\/span><span>100,000원/);
  assert.match(html, /추가 급여 \(기준 초과 60분\)<\/span><span>\+ 20,000원/);
  assert.match(html, /120,000원/);
});

test('3.3% 를 체크한 일일근무 기록은 뗀 금액을 보여준다', () => {
  const state = baseState('payroll');
  state.data.employees = [일일자리];
  state.data.shifts = [{ ...일일근무('s1', '김일손', 100000), withholding: true }];
  state.data.absences = [];
  const { html } = screen(state);
  assert.match(html, /원천징수 3\.3%<\/span><span>− 3,300원/);
  // 실지급액이 앞에 나오고 합계도 그 금액이어야 한다.
  assert.match(html, /실지급액 \(3\.3% 뗀 금액\)<\/span><strong>96,700원/);
  assert.match(html, /일일근무자 실지급 합계<\/span><strong>96,700원/);
});

test('3.3% 를 체크한 월급 직원은 뗀 금액이 입금 기준액이 된다', () => {
  const state = baseState('payroll');
  state.data.employees = [{ ...월급직원, withholding: true }];
  state.data.shifts = [{ ...월급근무, extraAmount: 0, amount: 0, multiplierPercent: 100 }];
  state.data.absences = [];
  const { html } = screen(state);
  // 300만원 → 세금 99,000 → 실지급 2,901,000
  assert.match(html, /원천징수 3\.3%<\/span><span>− 99,000원/);
  assert.match(html, /2,901,000원/);
});

test('3.3% 를 안 체크하면 예전 그대로다', () => {
  const state = baseState('payroll');
  state.data.employees = [월급직원];
  state.data.shifts = [{ ...월급근무, extraAmount: 0, amount: 0, multiplierPercent: 100 }];
  state.data.absences = [];
  const { html } = screen(state);
  // 화면 아래 안내문에는 '원천징수' 라는 말이 늘 있다. 공제 줄만 없어야 한다.
  assert.doesNotMatch(html, /원천징수 3\.3%<\/span><span>−/);
  assert.match(html, /3,000,000원/);
});

test('이름을 안 적은 일일근무 기록이 몇 건인지 알려준다', () => {
  const state = baseState('payroll');
  state.data.employees = [일일자리];
  state.data.shifts = [일일근무('s1', '김일손', 100000), 일일근무('s2', '', 100000), 일일근무('s3', '', 100000)];
  state.data.absences = [];
  const { html } = screen(state);
  assert.match(html, /이름을 아직 안 적은 기록이 <b>2건<\/b>/);
});

test('일일근무자 급여가 시급·월급 합계에 섞이지 않는다', () => {
  const state = baseState('payroll');
  state.data.employees = [시급직원, 일일자리];
  state.data.shifts = [시급근무, 일일근무('s1', '김일손', 100000)];
  state.data.absences = [];
  const { html, stats } = screen(state);
  // 시급 합계는 시급 근무만
  assert.match(stats, /144,000원/);
  assert.doesNotMatch(stats, /244,000원/);
  assert.match(html, /시급 직원 기본급 합계<\/span><strong>144,000원/);
});

test('미퇴근 일일근무 기록은 급여 줄에 안 나온다', () => {
  // 퇴근을 안 찍었으면 얼마를 줄지 정해지지 않았다.
  const state = baseState('payroll');
  state.data.employees = [일일자리];
  state.data.shifts = [{ ...일일근무('s1', '김일손', 100000), checkOutAt: null, amount: 0, baseAmount: 0 }];
  state.data.absences = [];
  const { html } = screen(state);
  assert.doesNotMatch(html, /일일근무자 합계/);
});

const 일당직원 = { id: 'p1', name: '김일당', role: '홀', floor: 2, payType: 'perDiem', dailyPay: 100000, halfDayPay: 55000, halfDayBeforeMinutes: 1020, breakMinutes: 0, active: true };
const 일당근무 = (id, date, portion, baseAmount, extraAmount = 0) => ({
  id, employeeId: 'p1', employeeName: '김일당', floor: 2, workDate: date,
  checkInAt: at(`${date}T09:00:00+09:00`), checkOutAt: at(`${date}T18:00:00+09:00`),
  breakMinutes: 0, payType: 'perDiem', hourlyRate: 0, payableMinutes: 540,
  amount: baseAmount + extraAmount, baseAmount, extraAmount, dayPortion: portion,
  overtimeUnits: extraAmount / 10000, multiplierPercent: 100, note: ''
});

test('일당 직원은 풀타임·반타임 일수가 줄로 보인다', () => {
  const state = baseState('payroll');
  state.data.employees = [일당직원];
  state.data.shifts = [
    일당근무('a', '2026-09-14', 'full', 100000),
    일당근무('b', '2026-09-15', 'full', 100000, 20000),
    일당근무('c', '2026-09-16', 'half', 55000)
  ];
  state.data.absences = [];
  const { html } = screen(state);
  assert.match(html, /풀타임 2일<\/span><span>200,000원/);
  assert.match(html, /반타임 1일<\/span><span>55,000원/);
  assert.match(html, /초과 근무 추가 급여<\/span><span>\+ 20,000원/);
  // 합계 275,000원이 입금 기준액
  assert.match(html, /275,000원/);
});

test('일당 직원은 기록마다가 아니라 사람마다 한 줄이다', () => {
  // 일일근무자 자리와 달리 이름 있는 직원이라 합쳐서 보여준다.
  const state = baseState('payroll');
  state.data.employees = [일당직원];
  state.data.shifts = [일당근무('a', '2026-09-14', 'full', 100000), 일당근무('b', '2026-09-15', 'full', 100000)];
  state.data.absences = [];
  const { html } = screen(state);
  // 이름은 aria-label 에도 들어가므로 카드 수로 센다.
  // 감싸는 att-payroll-cards 까지 세지 않도록 article 만 센다.
  assert.equal((html.match(/<article class="att-payroll-card/g) || []).length, 1, '일당 직원이 여러 줄로 나왔습니다.');
  assert.match(html, /200,000원/);
  // 일일근무자 자리가 아니라 보통 직원 줄에 들어간다.
  assert.doesNotMatch(html, /일일근무자 실지급 합계/);
});

test('일당 직원에게 3.3% 를 체크하면 뗀 금액이 나온다', () => {
  const state = baseState('payroll');
  state.data.employees = [{ ...일당직원, withholding: true }];
  state.data.shifts = [일당근무('a', '2026-09-14', 'full', 100000)];
  state.data.absences = [];
  const { html } = screen(state);
  assert.match(html, /원천징수 3\.3%<\/span><span>− 3,300원/);
  assert.match(html, /96,700원/);
});

test('시급 합계에 월급 직원의 특수일 가산이 섞이지 않는다', () => {
  // 예전에는 모든 기록의 amount 를 더해서, 월급 직원 가산까지 시급 합계에 들어갔다.
  const { stats } = screen(baseState('calendar'));
  assert.match(stats, /144,000원/);
  assert.doesNotMatch(stats, /316,248원/);
});

test('특수일·결근이 아직 없는 서버 응답에도 그려진다', () => {
  // 함수 배포 전에는 이 두 필드가 아예 없다. 화면이 깨지면 안 된다.
  const state = baseState('payroll');
  delete state.data.specialDays;
  delete state.data.absences;
  state.data.shifts = [{ ...시급근무, amount: 96000, baseAmount: 96000, extraAmount: 0, multiplierPercent: 100 }];
  const { html } = screen(state);
  assert.match(html, /96,000원/);
  assert.doesNotMatch(html, /NaN/);
  assert.doesNotMatch(html, /undefined/);
});

test('월급 미설정 직원은 입금액 대신 안내가 나온다', () => {
  const state = baseState('payroll');
  state.data.employees = [{ ...월급직원, monthlySalary: null }];
  state.data.shifts = [{ ...월급근무, extraAmount: 0, amount: 0, multiplierPercent: 100 }];
  const { html } = screen(state);
  assert.match(html, /월급 미설정/);
  assert.doesNotMatch(html, /NaN/);
});

// 비례 지급으로 바꾼 일당 직원
const 비례직원 = { id: 'p2', name: '화성댁', role: '홀', floor: 2, payType: 'perDiem',
  dailyMode: 'prorate', dailyPay: 75000, halfDayPay: 0, dailyBaseMinutes: 360,
  earlyGraceMinutes: 30, breakMinutes: 0, active: true };
// 6시간 중 3시간만 일하고 간 날 (서버가 계산해 보내는 모양 그대로)
const 비례근무 = { id: 'x9', employeeId: 'p2', employeeName: '화성댁', floor: 2, workDate: '2026-09-17',
  checkInAt: at('2026-09-17T11:00:00+09:00'), checkOutAt: at('2026-09-17T14:00:00+09:00'),
  breakMinutes: 0, payType: 'perDiem', hourlyRate: 0, payableMinutes: 180,
  amount: 37500, baseAmount: 37500, extraAmount: 0, dayPortion: 'part', note: '' };

test('일찍 간 날이 급여 정산에서 따로 보인다', () => {
  // 풀타임과 한 줄로 합쳐지면 왜 금액이 다른지 알 수 없다.
  const state = baseState('payroll');
  state.data.employees = [비례직원];
  state.data.shifts = [비례근무];
  const { html } = screen(state);
  assert.match(html, /일찍 퇴근 1일/);
  assert.match(html, /37,500원/);
  assert.doesNotMatch(html, /NaN/);
  assert.doesNotMatch(html, /undefined/);
});

test('일당 직원 카드에 일당과 지급 방식이 나온다', () => {
  // '약정 월급 —' 이라고 나오면 얼마 주기로 한 사람인지 알 수 없다.
  const state = baseState('employees');
  state.data.employees = [비례직원];
  const { html } = screen(state);
  assert.match(html, /기본 일당/);
  assert.match(html, /75,000원/);
  assert.match(html, /일한 시간 비례/);
  assert.match(html, /30분까지는 전액/);
  assert.doesNotMatch(html, /약정 월급/);
});

test('직원 목록도 홀·주방으로 나뉜다', () => {
  const state = baseState('employees');
  state.data.employees = [
    { ...일당직원, id: 'p1', name: '김홀', part: 'hall' },
    { ...일당직원, id: 'p2', name: '박주방', part: 'kitchen' },
    { ...일당직원, id: 'p3', name: '이주방', part: 'kitchen' }
  ];
  const { html } = screen(state);
  // 제목 줄은 카드 그리드 한 줄을 다 쓴다.
  assert.match(html, /att-part-title att-part-row">홀<span>1명</);
  assert.match(html, /att-part-title att-part-row">주방<span>2명</);
  // 나눈다고 사람이 빠지면 안 된다.
  for (const name of ['김홀', '박주방', '이주방']) assert.match(html, new RegExp(name));
  // 홀이 주방보다 먼저 나온다.
  assert.ok(html.indexOf('>홀<') < html.indexOf('>주방<'));
});

test('배송 파트도 직원 목록에서 제목을 가진다', () => {
  const state = baseState('employees');
  state.data.employees = [
    { ...일당직원, id: 'p1', name: '최배송', part: 'delivery' },
    { ...일당직원, id: 'p2', name: '김홀', part: 'hall' }
  ];
  const { html } = screen(state);
  assert.match(html, /att-part-title att-part-row">배송<span>1명</);
  assert.ok(html.indexOf('>홀<') < html.indexOf('>배송<'), '홀이 배송보다 먼저 나와야 합니다');
});

test('파트를 안 고른 직원만 있으면 제목 줄이 없다', () => {
  const state = baseState('employees');
  state.data.employees = [일당직원];
  const { html } = screen(state);
  assert.doesNotMatch(html, /att-part-row/);
  // 카드에는 아직 안 골랐다고 적어 준다.
  assert.match(html, /파트 미지정/);
});

test('반타임 방식 일당 직원 카드에는 반타임 조건이 나온다', () => {
  const state = baseState('employees');
  state.data.employees = [일당직원];
  const { html } = screen(state);
  assert.match(html, /기본 일당/);
  assert.match(html, /17:00 전 퇴근·이후 출근은 반타임/);
  assert.match(html, /55,000원/);
  assert.doesNotMatch(html, /NaN/);
});
