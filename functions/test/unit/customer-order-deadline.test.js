'use strict';

// 고객 앱이 관리자 설정의 주문 마감 시간을 읽지 않고 9시 10분으로 고정돼 있었다.
// 관리자 화면에는 "고객 앱에서 주문 입력이 마감되는 시각입니다" 라고 적혀 있는데
// 실제로는 반영되지 않아서, 실제 마감(9시 20분)보다 10분 일찍 주문이 막혔다.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const rootDir = path.resolve(__dirname, '../../..');
const customerSource = fs.readFileSync(path.join(rootDir, 'customer.html'), 'utf8');

function extractFunction(name) {
  const start = customerSource.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} 함수를 찾지 못했습니다.`);
  const asyncStart = customerSource.slice(start - 6, start) === 'async ' ? start - 6 : start;
  let depth = 0;
  for (let i = customerSource.indexOf('{', customerSource.indexOf(')', start)); i < customerSource.length; i += 1) {
    if (customerSource[i] === '{') depth += 1;
    else if (customerSource[i] === '}') { depth -= 1; if (!depth) return customerSource.slice(asyncStart, i + 1); }
  }
  throw new Error(`${name} 함수 끝을 찾지 못했습니다.`);
}

function load({ settings, failRead = false } = {}) {
  const texts = {};
  const context = {
    document: {
      getElementById: id => ({ set textContent(v) { texts[id] = v; }, get textContent() { return texts[id]; } })
    },
    db: {
      collection: () => ({
        doc: () => ({
          async get() {
            if (failRead) throw new Error('오프라인');
            return { exists: Boolean(settings), data: () => settings };
          }
        })
      })
    },
    texts
  };
  vm.createContext(context);
  vm.runInContext([
    customerSource.match(/const DEFAULT_ORDER_DEADLINE = \{[^}]*\};/)[0],
    'let orderDeadline = { ...DEFAULT_ORDER_DEADLINE };',
    'function getKST() { return new Date(Date.now() + 9 * 3600000); }',
    extractFunction('deadlineText'),
    extractFunction('applyDeadlineTexts'),
    extractFunction('loadSettings'),
    extractFunction('isClosed')
  ].join('\n'), context);
  // vm 의 최상위 let/const 는 컨텍스트 속성이 아니라 렉시컬 스코프에 있다.
  // 값을 보려면 컨텍스트 안에서 읽어야 한다.
  context.read = expr => vm.runInContext(expr, context);
  // vm 밖과 프로토타입이 달라 객체째 비교하면 안 맞는다. '시:분' 문자열로 본다.
  context.deadlineOf = name => context.read(`\`\${${name}.hour}:\${${name}.minute}\``);
  return context;
}

test('기본 마감은 실제 운영값인 9시 20분이다', () => {
  const ctx = load();
  assert.equal(ctx.deadlineOf('DEFAULT_ORDER_DEADLINE'), '9:20');
});

test('관리자 설정의 마감 시간을 실제로 읽는다', async () => {
  const ctx = load({ settings: { closeHour: 10, closeMinute: 5 } });
  await ctx.loadSettings();
  assert.equal(ctx.deadlineOf('orderDeadline'), '10:5');
  assert.equal(ctx.deadlineText(), '오전 10시 5분');
});

test('설정 문서가 없으면 기본 마감을 쓴다', async () => {
  const ctx = load({ settings: null });
  await ctx.loadSettings();
  assert.equal(ctx.deadlineOf('orderDeadline'), '9:20');
});

test('설정을 못 읽어도 고객 화면이 멈추지 않는다', async () => {
  const ctx = load({ failRead: true });
  await ctx.loadSettings();
  assert.equal(ctx.deadlineOf('orderDeadline'), '9:20');
});

test('값이 이상하면 무시하고 기본 마감을 쓴다', async () => {
  const ctx = load({ settings: { closeHour: 99, closeMinute: -3 } });
  await ctx.loadSettings();
  assert.equal(ctx.deadlineOf('orderDeadline'), '9:20');
});

test('화면에 박힌 마감 문구도 설정값으로 맞춘다', async () => {
  const ctx = load({ settings: { closeHour: 10, closeMinute: 0 } });
  await ctx.loadSettings();
  assert.equal(ctx.texts['closed-banner-time'], '오늘 주문 마감: 오전 10시');
  assert.equal(ctx.texts['help-deadline-text'], '오전 10시');
});

test('마감 판정은 설정값을 기준으로 한다', async () => {
  const ctx = load({ settings: { closeHour: 9, closeMinute: 20 } });
  await ctx.loadSettings();
  // 9시 15분에는 아직 주문할 수 있어야 한다. 예전에는 9시 10분 고정이라 막혔다.
  vm.runInContext('getKST = () => new Date(Date.UTC(2026, 8, 15, 9, 15));', ctx);
  assert.equal(ctx.isClosed(), false);
  vm.runInContext('getKST = () => new Date(Date.UTC(2026, 8, 15, 9, 20));', ctx);
  assert.equal(ctx.isClosed(), true, '마감 정각은 이미 마감이다');
});
