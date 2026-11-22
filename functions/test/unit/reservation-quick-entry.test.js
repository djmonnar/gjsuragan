'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Q = require('../../../assets/js/reservation-quick-entry.js');

// 2026-11-22(일). 이름·번호는 모두 가상이다.
const today = '2026-11-22';
const parse = (text, menus = []) => Q.parse(text, { today, menus });

test('한 줄을 예약 칸으로 나눈다 (화면 예시 그대로)', () => {
  const { fields, warnings } = parse('홍길동 12월18일 금요일 6시 20~24명 1층 소고기 010-0000-0000');
  assert.deepEqual(fields, { phone: '010-0000-0000', room: '1층', date: '2026-12-18', time: '18:00', people: 24, menu: '소고기', name: '홍길동', memo: '인원 20~24명' });
  assert.deepEqual(warnings, []);
});

test('붙여 쓴 글자·「정도」·하이픈 없는 번호도 읽는다', () => {
  const { fields } = parse('가상인 12월18일 금요일6시 20~24명 정도 1층 소고기 01000001111');
  assert.equal(fields.name, '가상인');
  assert.equal(fields.date, '2026-12-18');
  assert.equal(fields.time, '18:00');
  assert.equal(fields.phone, '010-0000-1111');
  assert.equal(fields.memo, '인원 20~24명 정도');
});

test('시간: 오전·오후가 없으면 1~9시는 저녁, 10~12시는 그대로, 말이 있으면 그 말대로', () => {
  assert.equal(Q.EVENING_UP_TO, 9);
  const time = text => parse(`가상 12/1 ${text} 2명`).fields.time;
  assert.equal(time('6시'), '18:00');
  assert.equal(time('9시'), '21:00');
  assert.equal(time('11시 30분'), '11:30');
  assert.equal(time('12시반'), '12:30');
  assert.equal(time('점심 1시'), '13:00');
  assert.equal(time('오전 9시'), '09:00');
  assert.equal(time('오후 1시'), '13:00');
  assert.equal(time('17:40'), '17:40');
  assert.equal(time('저녁 6:30'), '18:30');
  assert.equal(parse('가상 12/1 저녁 4명').fields.meal, 'dinner');
});

test('날짜: 연도 없는 날짜는 다가오는 날, 상대 날짜, 요일만 적은 경우, 요일이 틀리면 경고', () => {
  const date = text => parse(`가상 ${text} 6시 2명`);
  assert.equal(date('12/5').fields.date, '2026-12-05');
  assert.equal(date('1월 3일').fields.date, '2027-01-03');
  assert.equal(date('11월 20일').fields.date, '2026-11-20'); // 이틀 전: 지난 예약을 적는 것으로 본다
  assert.match(date('11월 20일').warnings.join(), /지난 날짜/);
  assert.equal(date('2027.2.1').fields.date, '2027-02-01');
  assert.equal(date('내일').fields.date, '2026-11-23');
  assert.equal(date('모레').fields.date, '2026-11-24');
  assert.equal(date('28일').fields.date, '2026-11-28');
  assert.equal(date('5일').fields.date, '2026-12-05');
  assert.equal(date('다음주 금요일').fields.date, '2026-11-27');
  assert.equal(date('이번주 토요일').fields.date, '2026-11-28');
  assert.equal(date('금요일').fields.date, '2026-11-27');
  // 월요일에 말한 「이번주/다음주 금요일」
  assert.equal(Q.parse('가상 이번주 금요일 6시', { today: '2026-11-23' }).fields.date, '2026-11-27');
  assert.equal(Q.parse('가상 다음주 금요일 6시', { today: '2026-11-23' }).fields.date, '2026-12-04');
  const wrong = date('12월17일 금요일');
  assert.equal(wrong.fields.date, '2026-12-17');
  assert.match(wrong.warnings.join(), /목요일입니다.*금요일/);
});

test('인원: 범위·이상·어른 아이, 「4인분」은 인원이 아니라 메뉴 수량', () => {
  assert.deepEqual([parse('가상 12/1 6시 15명+@ 고기').fields.people, parse('가상 12/1 6시 15명+@ 고기').fields.memo], [15, '인원 15명 이상']);
  const family = parse('가상님 12/1 18:00 어른 6 아이 2 고기 칠순잔치').fields;
  assert.equal(family.people, 8);
  assert.equal(family.name, '가상');
  assert.equal(family.memo, '어른 6 · 아이 2\n칠순잔치');
  const portions = parse('가상 12/1 6시 4명 고기 4인분').fields;
  assert.equal(portions.people, 4);
  assert.equal(portions.menu, '고기 4인분');
});

test('룸·메뉴: 「12-13R」은 날짜가 아니고, 긴 메뉴 이름이 먼저, +로 묶은 메뉴는 하나', () => {
  const fields = parse('가상회사 다음주 토요일 6시 30분 20명 12-13R 돼지+식사권 0000 1111').fields;
  assert.deepEqual([fields.room, fields.date, fields.time, fields.menu, fields.phone, fields.name, fields.memo], ['12-13R', '2026-11-28', '18:30', '돼지+식사권', '0000-1111', '가상회사', undefined]);
  const menus = parse('소고기 2 돼지 3 가상 내일 7시 5명').fields;
  assert.equal(menus.menu, '소고기 2, 돼지 3');
  assert.equal(menus.name, '가상');
  assert.equal(parse('가상 12/1 6시 2명 소(명품)', ['소(명품)']).fields.menu, '소(명품)');
  assert.equal(parse('가상 12/1 6시 2명 2층 3번방').fields.room, '2층 3번방');
});

test('앞에 적은 말은 예약자명(여러 단어 가능), 뒤에 남은 말은 비고, 못 찾으면 알려 준다', () => {
  const group = parse('가상시청 가상인 11/30 점심 12시 34명 차돌쌈밥 2층 22명6T 12명3T').fields;
  assert.equal(group.name, '가상시청 가상인');
  assert.equal(group.people, 34);
  assert.equal(group.memo, '22명6T 12명3T');
  const nameAfter = parse('내일 저녁 7시반 가상인 4명 돼지갈비 유아의자1').fields;
  assert.deepEqual([nameAfter.name, nameAfter.time, nameAfter.memo], ['가상인', '19:30', '유아의자1']);
  assert.match(parse('12/1 6시 4명').warnings.join(), /예약자명/);
  assert.match(parse('가상 4명').warnings.join(), /날짜.*시간/s);
  assert.deepEqual(parse('').fields, {});
  assert.throws(() => Q.parse('가상', {}), /today/);
});

test('빈 칸 확인: 물어볼 칸만 고르고, 이름이 비면 「이름 미정」으로 저장한다', () => {
  assert.deepEqual(Q.ASK_IF_EMPTY.map(([, label]) => label), ['예약자명', '시간', '인원', '연락처', '메뉴']);
  assert.deepEqual(Q.missingFields({ name: '가상', time: '18:00', people: '', phone: ' ', menu: '고기', room: '' }).map(m => m.key), ['people', 'phone']);
  assert.deepEqual(Q.missingFields({}).map(m => m.key), ['name', 'time', 'people', 'phone', 'menu']);
  assert.deepEqual(Q.missingFields({ name: '가상', time: '18:00', people: 4, phone: '010', menu: '고기' }), []);
  assert.equal(Q.NO_NAME, '이름 미정');
  // 서버는 예약자명을 요구한다. 화면이 「이름 미정」을 채워 보내면 그대로 저장된다.
  const M = require('../../reservationBoardModel');
  assert.equal(M.reservationInput({ date: '2026-12-18', name: Q.NO_NAME }, Date.parse('2026-11-22T03:00:00Z')).name, '이름 미정');
});
