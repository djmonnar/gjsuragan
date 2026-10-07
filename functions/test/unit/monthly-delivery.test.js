'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const M = require('../../monthlyDeliveryModel');
const catering = require('../../cateringCatalog');
const { createMonthlyDeliveryHandler, SHARE_TTL_DAYS, shareHash } = require('../../monthlyDelivery');
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
test('admin actions require authentication; public actions only call scoped service methods', async () => {
  let called = '';
  const handler = createMonthlyDeliveryHandler({ authorize:async () => { throw M.error(401,'인증 필요'); }, service:{ saveBoard:() => { called='save'; }, driverRead:async () => { called='driver'; return { rows:[] }; } } });
  const run = async body => { const res = { code:200,set(){},status(code){ this.code=code;return this; },json(value){ this.value=value; } }; await handler({ method:'POST',body },res);return res; };
  assert.equal((await run({ action:'save',token:'a'.repeat(64) })).code,401);
  assert.equal(called,''); assert.equal((await run({ action:'driverRead',token:'a'.repeat(64) })).code,200); assert.equal(called,'driver');
  assert.throws(() => shareHash('wrong'), /링크/); assert.equal(shareHash('a'.repeat(64)).length,64);
});
test('manual polling and share expiry match service constants, with cache and tab wiring', () => {
  const root = path.resolve(__dirname,'../../..');
  const manual = fs.readFileSync(path.join(root,'manual.html'),'utf8').split('id="monthly-delivery"')[1].split('</section>')[0];
  assert.match(manual,new RegExp(`${M.POLL_MS/1000}초마다`)); assert.match(manual,new RegExp(`<strong>${SHARE_TTL_DAYS}일</strong>`));
  const admin = fs.readFileSync(path.join(root,'admin.html'),'utf8'), sw = fs.readFileSync(path.join(root,'sw.js'),'utf8');
  for (const asset of ['monthly-delivery.css','monthly-delivery-board.js']) { assert.ok(admin.includes(`${asset}?v=20261007-monthly-board`)); assert.ok(sw.includes(`${asset}?v=20261007-monthly-board`)); }
  assert.ok(admin.includes('data-tab="monthlyDelivery"')); assert.ok(sw.includes("'./monthly-delivery.html'"));
});
