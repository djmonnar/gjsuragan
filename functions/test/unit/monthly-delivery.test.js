'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const M = require('../../monthlyDeliveryModel');
const catering = require('../../cateringCatalog');
const { createMonthlyDeliveryHandler, MEMOS, SHARE_TTL_DAYS, PICKUP_LOOKBACK_DAYS, shareHash } = require('../../monthlyDelivery');
const date = '2026-10-07';
const profile = extra => ({ businessName:'테스트 업체', defaultLunch:2, defaultSalad:0, lunchPrice:8000, saladPrice:9000, ...extra });
const rows = extra => M.resolveRows({ date, users:{ a:profile() }, ...extra });
const billed = extra => M.buildSettlement({ uid:'a', month:'2026-10', user:profile(), records:{ [date]:{ delivered:true, lunchCount:2 } }, noDelivery:() => false, invoiceNo:'GJS-202610-001', ...extra });

test('selected delivery date includes defaults and overrides, excluding holidays, zero and paused members', () => {
  const result = rows({ users:{ a:profile(), b:profile({ weekdayMeals:{ wed:{ lunch:0, salad:1 } } }), c:profile(), d:profile(), e:profile({ mealPaused:true, mealPauseStartDate:date, mealResumeDate:'2026-10-08' }), f:profile({ defaultLunch:0 }) },
    orders:{ a:{ lunchCount:5 }, c:{ selfHoliday:true, lunchCount:9 }, d:{ lunchCount:0 } } });
  assert.deepEqual(result.map(r => [r.uid,r.lunchCount,r.saladCount]), [['a',5,0],['b',0,1]]);
  assert.deepEqual(rows({ noDelivery:true }), []);
  assert.equal(M.paused(profile({ mealPaused:true, mealResumeDate:date }), date), false);
});
test('service start and KST registration cutoff restrict defaults, but explicit date orders remain', () => {
  const user = profile({ serviceStartDate:'2026-10-08' });
  assert.equal(rows({ users:{ a:user } }).length, 0);
  assert.equal(rows({ users:{ a:user }, orders:{ a:{ lunchCount:1 } } }).length, 1);
  assert.equal(M.activeDefault(profile({ createdAt:'2026-10-07T00:20:00Z' }), date), false);
  assert.equal(M.activeDefault(profile({ createdAt:'2026-10-07T00:19:59Z' }), date), true);
  assert.equal(M.activeDefault(profile({ createdAt:'2026-10-06T23:30:00Z' }), date, { closeHour:8,closeMinute:30 }), false);
});
test('locked snapshots use frozen profile and quantities, zero stays excluded', () => {
  const result = rows({ locked:true, snapshots:{ a:{ lunchCount:4, businessName:'잠금 업체', deliveryPlace:'잠금 주소' }, b:{ lunchCount:0, saladCount:0 } }, users:{ a:profile({ defaultLunch:9 }), b:profile() } });
  assert.deepEqual(result.map(r => [r.uid,r.businessName,r.lunchCount,r.address]), [['a','잠금 업체',4,'잠금 주소']]);
});
test('deleted defaults and manual tombstones stay out; manual delivery and disposable conversion stay in', () => {
  assert.equal(rows({ records:{ a:{ orderDeleted:true } } }).length, 0);
  assert.equal(rows({ users:{ a:profile({ deleted:true }) } }).length, 0);
  const result = rows({ users:{ a:profile({ disposableLunch:true }) }, records:{ manual_x:{ adminManual:true,lunchCount:3,businessName:'직접 입력',delivered:false }, manual_deleted:{ adminManual:true,lunchCount:9,deleted:true } }, orders:{ event_x:{ kind:'eventLunch',eventLunchCount:10 } } });
  assert.deepEqual(result.map(r => [r.uid,r.lunchCount,r.eventLunchCount]).sort(), [['a',0,2],['manual_x',3,0]]);
  assert.equal(rows({ users:{ a:profile({ disposableLunch:true }) }, orders:{ a:{ lunchCount:2,disposableLunch:false } } })[0].lunchCount, 2);
  assert.equal(rows({ users:{}, records:{ manual_x:{ adminManual:true,lunchCount:3 } }, orders:{ manual_x:{ selfHoliday:true } } }).length,0);
  assert.equal(rows({ users:{}, records:{ manual_x:{ adminManual:true,lunchCount:3 } }, orders:{ manual_x:{ lunchCount:0 } } }).length,0);
});
test('driver payload excludes prices and finance; content changes invalidate completion signature', () => {
  const row = rows()[0], pub = M.publicRow(row);
  for (const key of ['lunchPrice','saladPrice','eventLunchPrice','totalAmount','settlements','payments']) assert.equal(key in pub, false);
  assert.notEqual(row.signature, rows({ orders:{ a:{ lunchCount:3 } } })[0].signature);
  assert.notEqual(row.signature, rows({ users:{ a:profile({ deliveryPlace:'다른 주소' }) } })[0].signature);
});
test('catering-only monthly meals include large lunch and rice quantities at preserved prices', () => {
  const cateringItems=[{ menuId:catering.LARGE_LUNCH_MENU_ID,qty:3,unitPrice:12000,name:'곱빼기 도시락' },{ menuId:catering.RICE_MENU_ID,qty:2,unitPrice:1500,name:'공기밥' }];
  const row=rows({ orders:{ a:{ lunchCount:0,saladCount:0,cateringItems } } })[0];
  assert.equal(row.totalQty,5);assert.equal(row.cateringAmount,39000);
  assert.match(M.publicRow(row).cateringLabel,/곱빼기 도시락 3개/);
  assert.match(M.publicRow(row).cateringLabel,/공기밥 2개/);
  const record=M.completionRecord(row,{},date,true,'driver','timestamp');
  assert.equal(record.totalAmount,39000);assert.equal(billed({ records:{ [date]:record } }).amount,39000);
});
test('saved ranks survive inactive meals and new members are unassigned', () => {
  const plan = M.normalizePlan({ lanes:M.DEFAULT_LANES, order:{ center:['a','paused','b'], west:[], east:[], unassigned:[] } }, [{ uid:'a' },{ uid:'b' },{ uid:'new' }]);
  assert.deepEqual(plan.order.center, ['a','paused','b']);
  assert.deepEqual(plan.order.unassigned, ['new']);
  assert.throws(() => M.validatePlan({ ...plan,order:{ ...plan.order,west:['a'] } }), /한 번/);
  assert.throws(() => M.validatePlan({ ...plan,lanes:[{ id:'__proto__',name:'bad',driver:'' },{ id:'unassigned',name:'미배정',driver:'' }] }), /ID/);
  assert.throws(() => M.requireDate('2026-02-30'), /날짜/);
});
test('pickups are earlier stops without a delivery today, kept in their course and without disposable lunches', () => {
  const users = { a:profile(), rest:profile({ businessName:'쉬는 업체',deliveryPlace:'쉬는 주소' }), single:profile({ disposableLunch:true }), moved:profile(), gone:profile({ businessName:'해지 업체',deleted:true }) };
  const earlier = M.visitedRows({ date:'2026-10-06', users, records:{
    gone:{ delivered:true,lunchCount:3 }, unvisited:{ delivered:false,lunchCount:9 }, removed:{ delivered:true,lunchCount:9,orderDeleted:true },
    event_1:{ delivered:true,eventLunchCount:10 }, manual_x:{ adminManual:true,lunchCount:1,businessName:'직접 입력' } } });
  assert.deepEqual(earlier.map(row => row.uid).sort(), ['a','gone','manual_x','moved','rest','single']);
  const today = M.resolveRows({ date, users, orders:{ rest:{ selfHoliday:true }, single:{ selfHoliday:true }, moved:{ selfHoliday:true } } });
  assert.deepEqual(today.map(row => row.uid), ['a']);
  const plan = M.normalizePlan({ lanes:M.DEFAULT_LANES, order:{ center:['a','rest','single'], west:['gone'], east:[], unassigned:['moved'] } });
  const pickups = M.pickupRows(earlier, today, plan, { lanes:[{ id:'east' },{ id:'removed_course' }], order:{ east:['moved'], removed_course:['manual_x'] } });
  // Today's course, then the earlier board's course, then the unassigned pool.
  assert.deepEqual(pickups.map(row => [row.uid,row.laneId,row.lunchCount]), [['rest','center',2],['gone','west',3],['moved','east',2],['manual_x','unassigned',1]]);
  assert.equal(pickups[0].address, '쉬는 주소');
  for (const key of ['lunchPrice','saladPrice','eventLunchPrice','signature','delivered']) assert.equal(key in pickups[0], false);
  assert.equal(M.needsPickup(earlier.find(row => row.uid === 'single')), false);
  assert.deepEqual(M.pickupRows(earlier, earlier, plan), []);
});
test('event lunches of the date come from administrator events and unregistered public orders, without prices', () => {
  const admin = {
    'adminEvents.event_old': { eventDate:date,eventTime:'10:00',place:'옛 장소',businessName:'행사도시락',customerName:'옛 고객',name:'행사도시락',count:5 },
    'adminEvents.event_a': { eventDate:date,eventTime:'09:00',place:'덮어쓴 장소',count:1 },
    adminEvents:{
      event_a:{ eventDate:date,eventTime:'11:00',place:'행사장',businessName:'행사 업체',contactPhone:'010-0000-0000',items:[{ name:'제육 한상',qty:10,price:9000 },{ name:'공기밥',qty:2,price:1000 }],amount:92000,delivered:true },
      event_next:{ eventDate:'2026-10-08',place:'다른 날',count:3 }, event_gone:{ deleted:true }
    }
  };
  const publicOrders = { p1:{ eventDate:date,eventTime:'12:00',place:'접수 장소',businessName:'비회원 손님',requestNote:'정문',items:[{ name:'김치제육',qty:3,price:15900 }] },
    a:{ eventDate:date,eventTime:'13:00',place:'중복',items:[{ name:'x',qty:1 }] }, p2:{ eventDate:date,status:'registered',count:4 }, p3:{ eventDate:date,status:'deleted',count:4 }, p4:{ eventDate:'2026-10-08',count:4 } };
  const events = M.eventRows({ date, administrators:[admin], publicOrders });
  assert.deepEqual(events.map(row => [row.uid,row.businessName,row.eventLabel,row.eventQty,row.address,row.received,row.delivered]), [
    ['event_old','옛 고객','행사도시락 5개',5,'옛 장소',false,false],
    ['event_a','행사 업체','제육 한상 10개 · 공기밥 2개',12,'행사장',false,true],
    ['event_p1','비회원 손님','김치제육 3개',3,'접수 장소',true,false]
  ]);
  assert.equal(events[2].note,'정문');
  const pub = M.publicRow(events[1]);
  assert.equal(pub.kind,'event');assert.equal(pub.eventQty,12);assert.equal(pub.cateringLabel,'제육 한상 10개 · 공기밥 2개');
  for (const key of ['amount','price','lunchPrice','eventLunchPrice','items','totalAmount']) assert.equal(key in pub, false);
  assert.equal('kind' in M.publicRow(rows()[0]), false);
  const changed = M.eventRows({ date, administrators:[{ adminEvents:{ event_a:{ ...admin.adminEvents.event_a,items:[{ name:'제육 한상',qty:11 }] } } }] });
  assert.notEqual(changed[0].signature, events[1].signature);
  // Events never enter the weekday order, and leave no boxes to collect.
  const plan = M.normalizePlan({ lanes:M.DEFAULT_LANES, order:{ center:['a','event_a'], unassigned:['event_p1','b'] } });
  assert.deepEqual(M.withoutEvents(plan).order, { center:['a'], west:[], east:[], unassigned:['b'] });
  assert.equal(M.needsPickup(events[1]), false);
});
test('course categories can be fully replaced, keeping only the unassigned pool between edits', () => {
  const empty={ lanes:[{ id:'unassigned',name:'미배정',driver:'' }],order:{ unassigned:['a','b'] } };
  assert.deepEqual(M.validatePlan(empty),empty);
  const custom={ lanes:[{ id:'custom_route',name:'초전 B코스',driver:'임기사 · 4호차' },...empty.lanes],order:{ custom_route:['a'],unassigned:['b'] } };
  assert.deepEqual(M.validatePlan(custom),custom);
});
test('completion quantity and amounts match monthly settlement; cancellation removes the date', () => {
  const row = rows({ orders:{ a:{ lunchCount:2,saladCount:1 } } })[0];
  const record = M.completionRecord(row, {}, date, true, 'driver', 'timestamp');
  assert.equal(record.totalAmount, 25000);
  assert.equal(billed({ records:{ [date]:record } }).amount, 25000);
  const canceled = M.completionRecord(row, record, date, false, 'driver', 'later');
  assert.equal(billed({ records:{ [date]:canceled } }), null);
});
test('paid adjustment carryover and hold survive recomputation, with daily map replaced', () => {
  const saved = { invoiceNo:'old', adjust:-500, payments:[{ amount:30000,date:'2026-10-06' }], carryover:1000, carriedOverTo:'2026-11', note:'메모', daily:{ '2026-10-01':{ lunch:99 } } };
  const result = billed({ saved });
  assert.equal(result.amount,16000); assert.equal(result.status,'입금완료');
  assert.equal(result.adjust,-500); assert.equal(result.carryover,1000); assert.equal(result.carriedOverTo,'2026-11');
  assert.equal(result.invoiceNo,'old'); assert.deepEqual(result.payments,saved.payments); assert.deepEqual(Object.keys(result.daily),[date]);
  const zero = billed({ saved, records:{} });
  assert.equal(zero.amount,0); assert.equal(zero.paidAmount,30000);
  assert.equal(billed({ saved:{ status:'보류' } }).status,'보류');
  assert.equal(billed({ saved:{ status:'이월',carriedOverTo:'2026-11' } }).status,'이월');
  assert.throws(() => billed({ saved:{ type:'manualMonthly' } }), /엑셀/);
});
test('archived and legacy records follow existing precedence and free unit price remains zero', () => {
  assert.equal(M.mergeRecords({}, {}, { a:{ lunchCount:3 } }).a.lunchCount,3);
  assert.equal(M.mergeRecords({ a:{ lunchCount:2 } }, {}, { a:{ lunchCount:3 } }).a.lunchCount,2);
  assert.equal(M.mergeRecords({}, { a:{ deleted:true } }, { a:{ delivered:true } }).a,undefined);
  assert.equal(billed({ user:profile({ lunchPrice:0 }) }).amount,0);
});
test('manual quantities use record prices; registered manual-looking IDs keep customer prices', () => {
  const records = { [date]:{ adminManual:true,delivered:true,lunchQty:3,lunchPrice:11000 } };
  assert.equal(billed({ user:null,records }).amount,33000);
  assert.equal(billed({ uid:'manual_registered',records }).amount,24000);
});
test('course memo text keeps line breaks, drops control characters and stops at the limit', () => {
  assert.equal(M.memoText('어제 못 감\r\n- 가나 치과\u0007 수거\n\n  '),'어제 못 감\n- 가나 치과 수거');
  assert.equal(M.memoText(''),'');assert.equal(M.memoText('x'.repeat(M.MEMO_MAX)).length,M.MEMO_MAX);
  assert.throws(() => M.memoText('x'.repeat(M.MEMO_MAX+1)),e => e.status===400);
  assert.throws(() => M.memoText(null),e => e.status===400);
});
test('admin actions require authentication; public actions only call scoped service methods', async () => {
  let called = '';
  const handler = createMonthlyDeliveryHandler({ authorize:async () => { throw M.error(401,'인증 필요'); }, service:{ saveBoard:() => { called='save'; }, driverRead:async () => { called='driver'; return { rows:[] }; }, saveMemo:async () => { called='memo'; return { memo:{ text:'',updatedAt:'' } }; } } });
  const run = async body => { const res = { code:200,set(){},status(code){ this.code=code;return this; },json(value){ this.value=value; } }; await handler({ method:'POST',body },res);return res; };
  assert.equal((await run({ action:'save',token:'a'.repeat(64) })).code,401);
  assert.equal(called,''); assert.equal((await run({ action:'driverRead',token:'a'.repeat(64) })).code,200); assert.equal(called,'driver');
  assert.equal((await run({ action:'driverMemo',token:'a'.repeat(64),laneId:'west',text:'' })).code,200); assert.equal(called,'memo');
  assert.throws(() => shareHash('wrong'), /링크/); assert.equal(shareHash('a'.repeat(64)).length,64);
});
test('manual polling and share expiry match service constants, with cache and tab wiring', () => {
  const root = path.resolve(__dirname,'../../..');
  const manual = fs.readFileSync(path.join(root,'manual.html'),'utf8').split('id="monthly-delivery"')[1].split('</section>')[0];
  assert.match(manual,new RegExp(`${M.POLL_MS/1000}초마다`)); assert.match(manual,new RegExp(`<strong>${SHARE_TTL_DAYS}일</strong>`));
  // The pickup rule and the all-courses button are described as the code runs them.
  assert.match(manual,new RegExp(`<strong>${PICKUP_LOOKBACK_DAYS}일</strong> 전까지`));
  const board = fs.readFileSync(path.join(root,'assets/js/monthly-delivery-board.js'),'utf8');
  const shareAll = board.match(/data-share-all>([^<]+)</)[1];
  assert.ok(manual.includes(`<strong>${shareAll}</strong>`));
  const fixOrder = board.match(/data-template>([^<]+)</)[1];
  assert.equal(fixOrder,'요일 순서 고정');assert.ok(manual.includes(`${fixOrder}</strong>`));assert.ok(manual.includes('<strong>고정 풀기</strong>'));
  assert.ok(board.includes('>고정 풀기</button>'));
  const addressToggle = board.match(/data-address-toggle aria-pressed="false">([^<]+)</)[1];
  assert.equal(addressToggle,'주소 보기');assert.ok(manual.includes(`<strong>${addressToggle}</strong>`));
  assert.ok(board.includes("'주소 숨기기'"));
  const driverScript = fs.readFileSync(path.join(root,'assets/js/monthly-delivery-driver.js'),'utf8');
  assert.match(driverScript,/>코스 메모<\/label>/);assert.match(driverScript,/>메모 저장<\/button>/);assert.match(driverScript,new RegExp(`maxlength="${M.MEMO_MAX}"`));
  assert.ok(manual.includes('<strong>코스 메모</strong>'));assert.ok(manual.includes('<strong>메모 저장</strong>'));assert.ok(manual.includes(`<strong>${M.MEMO_MAX}자</strong>`));
  assert.ok(board.includes('기사님 메모'));assert.ok(manual.includes('<strong>기사님 메모</strong>'));assert.equal(MEMOS,'monthlyDeliveryMemos');assert.ok(manual.includes('<strong>주소 숨기기</strong>'));assert.ok(manual.includes('<strong>주소 미입력</strong>'));
  const admin = fs.readFileSync(path.join(root,'admin.html'),'utf8'), sw = fs.readFileSync(path.join(root,'sw.js'),'utf8');
  for (const asset of ['monthly-delivery.css','monthly-delivery-board.js']) {
    const url = admin.split(asset + '?v=')[1]?.split('"')[0];
    assert.ok(url); assert.ok(sw.includes(`${asset}?v=${url}`));
  }
  const driver = fs.readFileSync(path.join(root,'monthly-delivery.html'),'utf8');
  for (const asset of ['monthly-delivery.css','monthly-delivery-driver.js']) {
    const url = driver.split(asset + '?v=')[1]?.split('"')[0];
    assert.ok(url); assert.ok(sw.includes(`${asset}?v=${url}`));
  }
  assert.ok(admin.includes('data-tab="monthlyDelivery"')); assert.ok(sw.includes("'./monthly-delivery.html'"));
});
test('the deployed service finds the administrator document by sign-in account, not only by email', () => {
  const index = fs.readFileSync(path.resolve(__dirname,'../../index.js'),'utf8');
  assert.match(index.match(/createMonthlyDeliveryService\(\{[\s\S]*?\}\)/)[0], /adminUids: monthlyAdminUids/);
  assert.match(index, /getUserByEmail\(email\)/);
});
test('board customer editor loads the selected manual date and does not open after navigating away', async () => {
  const admin=fs.readFileSync(path.resolve(__dirname,'../../../admin.html'),'utf8').replace(/\r\n/g,'\n');
  const body=admin.match(/openCustomer: async \(uid, value\) => \{([\s\S]*?)\n      }\n    }\);/)[1];
  const calls=[], context={ currentDateStr:'2026-10-06',activeAdminTab:'monthlyDelivery',allUsers:{},deletedUsers:{},updateDateLabel(){},loadAllUsers:async()=>{},loadOrders:async()=>calls.push('orders'),openOrderMemberInfo:uid=>calls.push(uid),alert:message=>{ throw new Error(message); } };
  const open=vm.runInNewContext(`async (uid,value)=>{${body}}`,context);
  await open('manual_x',date);assert.deepEqual(calls,['orders','manual_x']);assert.equal(context.currentDateStr,date);
  calls.length=0;context.loadAllUsers=async()=>{context.activeAdminTab='orders';};
  await open('manual_x',date);assert.deepEqual(calls,[]);
});
