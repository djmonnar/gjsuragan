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
  assert.match(html, /세금과 4대보험은 빠져 있지 않습니다/);
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
