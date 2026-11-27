'use strict';

// 예약장 베트남어 화면과 「📖 직원 매뉴얼」 탭 (2026-11-27).
// 화면 문구가 빠짐없이 옮겨졌는지, 사용법·매뉴얼이 두 말에서 같은 모양인지, 레시피가 빠졌는지 본다.

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const I = require('../../../assets/js/reservation-board-i18n.js');
const guide = require('../../../assets/js/reservation-guide.js');
const quick = require('../../../assets/js/reservation-quick-entry.js');
const model = require('../../reservationBoardModel');

const page = read('assets/js/reservation-board.js');

function extractFunction(source, signature) {
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `${signature} 함수를 찾지 못했습니다.`);
  const bodyStart = source.indexOf('{', start);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`${signature} 함수 끝을 찾지 못했습니다.`);
}

// 화면 코드의 t('…') 열쇠. 자바스크립트 글자 그대로 풀어서(\n 등) 사전 열쇠와 맞춘다.
const literal = raw => vm.runInNewContext(`'${raw}'`);
const usedKeys = new Set([...page.matchAll(/\bt\('((?:[^'\\]|\\.)*)'/g)].map(match => literal(match[1])));
// 변수로 넘기는 열쇠: 링크 없음 안내, 오늘·내일·모레(relativeDay 가 돌려주는 말).
usedKeys.add(literal(/const NO_LINK = '((?:[^'\\]|\\.)*)';/.exec(page)[1]));
for (const word of ['오늘', '내일', '모레']) usedKeys.add(word);

test('화면의 한국어 문구마다 베트남어 뜻이 있다', () => {
  assert.ok(usedKeys.size > 100, '화면 문구를 찾지 못했습니다');
  const missing = [...usedKeys].filter(key => typeof I.vi[key] !== 'string' || !I.vi[key].trim());
  assert.deepEqual(missing, [], `베트남어가 빠진 문구: ${missing.join(' | ')}`);
});

test('쓰지 않는 베트남어 문구가 남아 있지 않다', () => {
  const stale = Object.keys(I.vi).filter(key => !usedKeys.has(key));
  assert.deepEqual(stale, [], `화면에 없는 문구: ${stale.join(' | ')}`);
});

test('자리표({n} 같은 것)는 두 말에서 같다', () => {
  for (const [ko, vi] of Object.entries(I.vi)) {
    const marks = text => (text.match(/\{\w+\}/g) || []).sort().join(',');
    assert.equal(marks(vi), marks(ko), ko);
    assert.equal((vi.match(/<br>/g) || []).length, (ko.match(/<br>/g) || []).length, `줄바꿈 수: ${ko}`);
  }
});

test('사용법은 두 말에서 절·줄 수가 같고 같은 숫자를 적는다', () => {
  const help = vm.runInNewContext(`(${page.slice(page.indexOf('const HELP = [') + 'const HELP = '.length, page.indexOf('];', page.indexOf('const HELP = [')) + 1)})`);
  assert.deepEqual(I.HELP_VI.map(([, lines]) => lines.length), JSON.parse(JSON.stringify(help.map(([, lines]) => lines.length))));
  const ko = JSON.stringify(help), vi = JSON.stringify(I.HELP_VI);
  // 낮/밤 경계(LUNCH_UNTIL 16:00), 새로고침 2분, 1~9시는 저녁(6시 → 18:00)
  assert.match(page, /const LUNCH_UNTIL = '16:00';/);
  assert.match(ko, /16시/); assert.match(vi, /16:00/);
  assert.match(ko, /2분마다/); assert.match(vi, /2 phút/);
  assert.ok(ko.includes('(6시 → 18:00)') && vi.includes('(6시 → 18:00)'));
  // 새 기능 안내: 매뉴얼 탭과 말 바꾸기 버튼
  assert.match(ko, /「📖 직원 매뉴얼」 탭/); assert.match(vi, /📖 Sổ tay NV/);
  assert.match(ko, /🇻🇳 버튼\(Tiếng Việt, 휴대폰에서는 VI\)/); assert.match(vi, /🇻🇳/);
  assert.equal(I.vi['📖 직원 매뉴얼'], '📖 Sổ tay NV');
});

test('정해진 값(상태·경로·요일·빠진 칸)을 모두 옮긴다', () => {
  assert.deepEqual(Object.keys(I.STATUS_VI.manual).sort(), Object.keys(model.STATUS_LABELS).sort());
  assert.deepEqual(Object.keys(I.STATUS_VI.naver).sort(), Object.keys(model.NAVER_LABELS).sort());
  for (const route of [...model.ROUTES, '오너비스타', '네이버예약']) assert.ok(I.ROUTE_VI[route], route);
  assert.deepEqual(Object.keys(I.MISSING_VI).sort(), quick.ASK_IF_EMPTY.map(([key]) => key).sort());
  assert.equal(I.WD_VI.length, 7);
  for (const status of [400, 403, 404, 409, 'other']) assert.ok(I.SERVER_VI[status], status);
});

test('한 줄 입력 경고를 베트남어로 옮긴다', () => {
  const today = '2026-11-27';
  const warnings = [
    ...quick.parse('홍길동 12월18일 월요일 6시 4명', { today }).warnings, // 12/18 은 금요일
    ...quick.parse('홍길동 11월25일 6시 4명', { today }).warnings, // 지난 날짜
    ...quick.parse('12월18일 4명', { today }).warnings, // 이름·시간 없음
    ...quick.parse('홍길동 4명', { today }).warnings, // 날짜 없음
  ];
  assert.ok(warnings.length >= 4, JSON.stringify(warnings));
  const code = [
    `const I18N = ${JSON.stringify({ WARNINGS_VI: I.WARNINGS_VI, WD_VI: I.WD_VI })};`, 'const isVi = () => true;',
    extractFunction(page, 'function warningText('), 'warningText'
  ].join('\n');
  const warningText = vm.runInNewContext(code);
  for (const warning of warnings) {
    const text = warningText(warning);
    assert.notEqual(text, warning, `옮기지 못한 경고: ${warning}`);
    assert.doesNotMatch(text, /\$\d/, text);
  }
  // 날짜·요일은 베트남어 꼴로 바꾼다(「12월 18일(금)」 → 「T6 18/12」). 날짜를 적는 예시는 한국어로 적을 말이라 그대로 둔다.
  assert.match(warningText(warnings[0]), /T6 18\/12/);
  assert.doesNotMatch(warningText(warnings[0]), /요일/);
});

test('메뉴 낱말 뜻은 긴 낱말부터 붙이고 메뉴 글자는 그대로 둔다', () => {
  const code = [
    `const I18N = ${JSON.stringify({ MENU_VI: I.MENU_VI })};`, 'const isVi = () => true;', 'const esc = value => String(value);',
    extractFunction(page, 'function menuGloss('), 'menuGloss'
  ].join('\n');
  const gloss = vm.runInNewContext(code);
  const meaning = menu => (gloss(menu).match(/>(.*)<\/small>/) || [])[1] || '';
  assert.equal(meaning('돼지갈비 2'), 'sườn heo', '「돼지」「갈비」로 쪼개지 않는다');
  assert.equal(meaning('한우 정식 4'), 'bò Hanwoo, suất cơm phần');
  assert.equal(meaning('소(명품) 20'), 'bò hảo hạng');
  assert.equal(meaning('차돌쌈밥'), 'cơm cuốn rau ba chỉ bò');
  assert.equal(meaning('콜키지'), '', '모르는 말에는 붙이지 않는다');
  const viOff = vm.runInNewContext(code.replace('const isVi = () => true;', 'const isVi = () => false;'));
  assert.equal(viOff('돼지갈비'), '', '한국어로 볼 때는 붙이지 않는다');
});

test('서버 오류는 베트남어로 볼 때 상태 번호로 옮기고, 입력 오류는 원문을 남긴다', () => {
  const code = [
    `const I18N = ${JSON.stringify({ SERVER_VI: I.SERVER_VI })};`, 'let vi = true; const isVi = () => vi;',
    extractFunction(page, 'function serverMessage('), '({ serverMessage, set: value => { vi = value; } })'
  ].join('\n');
  const api = vm.runInNewContext(code);
  assert.equal(api.serverMessage(409, '다른 직원(김실장)이 먼저 고쳤습니다.'), I.SERVER_VI[409]);
  assert.equal(api.serverMessage(400, '예약 경로를 확인해 주세요.'), `${I.SERVER_VI[400]} (예약 경로를 확인해 주세요.)`);
  assert.equal(api.serverMessage(500, ''), I.SERVER_VI.other);
  api.set(false);
  assert.equal(api.serverMessage(409, '다른 직원이 먼저 고쳤습니다.'), '다른 직원이 먼저 고쳤습니다.');
});

test('직원 매뉴얼은 두 말에서 모양이 같고, 손님 안내 멘트는 한국어 원문 그대로다', () => {
  const shape = g => g.sections.map(section => [section.id, section.icon, section.blocks.map(block => [block.type,
    (block.items || block.steps || block.rows || []).length, Boolean(block.title)])]);
  assert.deepEqual(shape(guide.vi), shape(guide.ko));
  guide.ko.sections.forEach((section, s) => section.blocks.forEach((block, b) => {
    const other = guide.vi.sections[s].blocks[b];
    if (block.type === 'say') assert.equal(other.ko, block.text, `${section.id} 멘트`);
    if (block.type === 'cards') assert.deepEqual(other.items.map(card => card.ko), block.items.map(card => card.name));
    if (block.type === 'table') assert.equal(other.head.length, block.head.length);
  }));
});

test('직원 매뉴얼에 원본의 핵심 수칙이 있고 레시피는 없다', () => {
  const ko = JSON.stringify(guide.ko);
  // 원본 01·02·주방 제1장
  for (const text of ['말돈소금 → 야끼니꾸소스 → 표고와사비 → 명란', '마블링 적은 부위 → 마블링 많은 부위', '계란찜', '리뷰 작성 화면',
    '테이프', 'TV', '발행 날짜와 금액', '신용카드 임의등록 → 기타카드', '주방에 육성으로 주문 전달', '간을 봅니다']) {
    assert.ok(ko.includes(text), text);
  }
  // 원본 주방 제2장~제5장(레시피)
  for (const text of ['조리 순서', '사용 재료', '육회', '육전', '청국장', '뚝배기', '꽃게', '굴소스', '냉면']) {
    assert.ok(!ko.includes(text), `레시피가 들어갔습니다: ${text}`);
  }
  const vi = JSON.stringify(guide.vi);
  assert.ok(vi.includes('Muối Maldon (말돈소금) → Sốt Yakiniku (야끼니꾸소스) → Wasabi nấm hương (표고와사비) → Trứng cá minh thái (명란)'));
});

test('예약장이 매뉴얼 탭과 말 바꾸기를 싣는다', () => {
  assert.match(page, /const VIEWS = \['day', 'week', 'month', 'guide'\];/);
  assert.match(page, /\['guide', t\('📖 직원 매뉴얼'\)\]/);
  assert.match(page, /data-act="lang"/);
  assert.match(page, /store\.set\('rb-lang', LANG\)/);
  assert.match(page, /data-guide-jump/);
  const html = read('reservations.html');
  const order = ['reservation-quick-entry.js', 'reservation-board-i18n.js', 'reservation-guide.js', 'reservation-board.js'].map(name => html.indexOf(`assets/js/${name}?v=`));
  assert.ok(order.every(index => index > 0) && order.every((index, i) => i === 0 || index > order[i - 1]), '스크립트 순서');
  const sw = read('sw.js');
  for (const name of ['reservation-board-i18n.js', 'reservation-guide.js']) {
    const version = new RegExp(`assets/js/${name.replace('.', '\\.')}\\?v=([\\w-]+)`).exec(html)[1];
    assert.ok(sw.includes(`./assets/js/${name}?v=${version}`), `sw.js 에 ${name}`);
  }
});
