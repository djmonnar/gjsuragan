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
