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
  assert.match(html, /추가 급여 \(30분 × 2회\)<\/span><span>\+ 20,000원/);
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
