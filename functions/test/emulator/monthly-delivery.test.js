'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { initializeApp,deleteApp } = require('firebase-admin/app');
const { getFirestore,FieldValue } = require('firebase-admin/firestore');
const { createMonthlyDeliveryService,BOARDS,TEMPLATES,SHARES,MEMOS,shareHash } = require('../../monthlyDelivery');
const date = '2026-10-07', actor = { uid:'monthly-admin' }, projectId = 'demo-gjsuragan-safety';
let app,db,service;
let clock = new Date('2026-10-07T03:00:00Z');
const noDelivery = (day,custom={}) => [0,6].includes(new Date(`${day}T00:00:00Z`).getUTCDay()) || Boolean(custom[day]);
test.before(() => {
  assert.ok(process.env.FIRESTORE_EMULATOR_HOST,'Run with Firestore emulator only');
  app = initializeApp({ projectId },`monthly-${Date.now()}`); db = getFirestore(app);
  service = createMonthlyDeliveryService({ db,timestamp:() => FieldValue.serverTimestamp(),isNoDeliveryDate:noDelivery,adminEmails:() => ['admin@example.invalid'],adminUids:async () => ['monthly-admin'],now:() => clock,sourceLoader:async () => ({ routes:[],tab:'',url:'' }) });
});
test.after(async () => { await deleteApp(app); });
test.beforeEach(async () => {
  const response = await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${projectId}/databases/(default)/documents`, { method:'DELETE' }); assert.ok(response.ok);
  clock = new Date('2026-10-07T03:00:00Z');
  await Promise.all(['a','b','c'].map(uid => db.collection('users').doc(uid).set({ businessName:`테스트 ${uid}`,email:`${uid}@example.invalid`,defaultLunch:2,lunchPrice:8000,saladPrice:9000,deliveryPlace:`주소 ${uid}`,mealTime:'11:30' })));
});
async function assigned() {
  const board = await service.readBoard(date); board.plan.order.center=['a','b'];board.plan.order.west=['c'];board.plan.order.unassigned=[];
  const saved = await service.saveBoard({ date,revision:board.revision,plan:board.plan },actor);
  const link = await service.share({ date,laneId:'center',revision:saved.revision },actor);
  return { board,link };
}
async function check(uid,token,delivered=true) {
  const read = await service.driverRead({ token }), row = read.rows.find(r => r.uid===uid);
  return service.complete({ token,uid,delivered,signature:row?.signature || '' });
}
test('scoped driver sees one course, live cancellations drop out and recovered meals retain rank', async () => {
  const { link } = await assigned();
  const read = await service.driverRead({ token:link.token }); assert.deepEqual(read.rows.map(r => r.uid),['a','b']); assert.equal(read.rows[0].lunchPrice,undefined);
  await db.collection('orders').doc(date).collection('items').doc('a').set({ selfHoliday:true });
  assert.deepEqual((await service.driverRead({ token:link.token })).rows.map(r => r.uid),['b']);
  assert.deepEqual((await db.collection(BOARDS).doc(date).get()).data().order.center,['a','b']);
  await db.collection('orders').doc(date).collection('items').doc('a').delete();
  assert.deepEqual((await service.driverRead({ token:link.token })).rows.map(r => r.uid),['a','b']);
  await assert.rejects(service.complete({ token:link.token,uid:'c',delivered:true,signature:'any' }),e => e.status===403);
});
test('board revisions conflict and templates apply only to unsaved dates', async () => {
  const { board } = await assigned();
  await assert.rejects(service.saveBoard({ date,revision:0,plan:board.plan },actor),e => e.status===409);
  await service.saveTemplate({ date,templateRevision:0,plan:board.plan },actor);
  assert.equal((await db.collection(TEMPLATES).doc('wed').get()).data().revision,1);
  assert.deepEqual((await service.readBoard('2026-10-14')).plan.order.center,['a','b']);
  const stored = await service.readBoard(date); const newer = structuredClone(board.plan);newer.order.center=[];newer.order.west=['a','b','c'];
  await service.saveTemplate({ date,templateRevision:1,plan:newer },actor);
  assert.deepEqual((await service.readBoard(date)).plan,stored.plan);
});

test('weekday sheet routes automatically seed fresh boards and preserve manual templates and live shared courses', async () => {
  const sourceService = createMonthlyDeliveryService({ db,timestamp:() => FieldValue.serverTimestamp(),isNoDeliveryDate:noDelivery,adminEmails:() => ['admin@example.invalid'],now:() => clock,
    sourceLoader:async day => ({ tab:day === 'wed' ? '수' : '목',url:'https://docs.google.com/spreadsheets/d/example/edit',routes:[
      { laneId:'center',names:day === 'wed' ? ['테스트 b','테스트 a','신규 테스트'] : ['테스트 c'] },
      { laneId:'west',names:day === 'wed' ? ['테스트 c'] : ['테스트 a','테스트 b'] }
    ] }) });
  let board = await sourceService.readBoard(date);
  assert.deepEqual(board.plan.order.center,['b','a']);assert.deepEqual(board.plan.order.west,['c']);assert.deepEqual(board.plan.order.unassigned,[]);
  assert.equal(board.routeSource.weekReady,true);
  for (const day of ['mon','tue','wed','thu','fri']) assert.equal((await db.collection(TEMPLATES).doc(day).get()).exists,true);
  assert.equal((await sourceService.readBoard(date)).templateRevision,board.templateRevision);
  assert.equal((await db.collection(BOARDS).doc(date).get()).exists,false);
  assert.deepEqual((await sourceService.readBoard('2026-10-08')).plan.order.west,['a','b']);
  const link = await sourceService.share({ date,laneId:'center',revision:0 },actor);
  assert.deepEqual((await sourceService.driverRead({ token:link.token })).rows.map(row=>row.uid),['b','a']);
  await db.collection('orders').doc(date).collection('items').doc('b').set({ selfHoliday:true });
  assert.deepEqual((await sourceService.driverRead({ token:link.token })).rows.map(row=>row.uid),['a']);
  await db.collection('orders').doc(date).collection('items').doc('b').delete();
  assert.deepEqual((await sourceService.driverRead({ token:link.token })).rows.map(row=>row.uid),['b','a']);
  await db.collection('users').doc('new').set({ businessName:'신규 테스트',defaultLunch:3 });
  const refreshed = await sourceService.driverRead({ token:link.token });
  assert.deepEqual(refreshed.rows.map(row=>row.uid),['b','a','new']);
  const newRow = refreshed.rows.find(row=>row.uid==='new');
  await sourceService.complete({ token:link.token,uid:'new',delivered:true,signature:newRow.signature });
  assert.equal((await db.collection('deliveryRecords').doc(date).get()).data().records.new.delivered,true);
  board = await sourceService.readBoard(date); board.plan.order.center=['new'];board.plan.order.west=['c','a'];board.plan.order.unassigned=['b'];
  await sourceService.saveBoard({ date,revision:board.revision,plan:board.plan },actor);
  assert.deepEqual((await sourceService.readBoard(date)).plan.order,board.plan.order);
  await sourceService.saveTemplate({ date,templateRevision:board.templateRevision,plan:board.plan },actor);
  assert.deepEqual((await sourceService.readBoard('2026-10-14')).plan.order,board.plan.order);
});
test('a new member with a route on another weekday is added to an existing driver course', async () => {
  const sourceService = createMonthlyDeliveryService({ db,timestamp:() => FieldValue.serverTimestamp(),isNoDeliveryDate:noDelivery,adminEmails:() => ['admin@example.invalid'],now:() => clock,
    sourceLoader:async day => ({ tab:day,url:'',routes:[{ laneId:'center',names:['테스트 a'] },{ laneId:'west',names:day === 'wed' ? [] : ['다른 요일 업체'] }] }) });
  await sourceService.readBoard(date);
  const link = await sourceService.share({ date,laneId:'west',revision:0 },actor);
  assert.deepEqual((await sourceService.driverRead({ token:link.token })).rows,[]);
  await db.collection('users').doc('new').set({ businessName:'다른 요일 업체',defaultLunch:2 });
  assert.deepEqual((await sourceService.driverRead({ token:link.token })).rows.map(row=>row.uid),['new']);
});

test('all weekday seeds retain separate same-office registrations and apply their route to future deliveries', async () => {
  const sourceService = createMonthlyDeliveryService({ db,timestamp:() => FieldValue.serverTimestamp(),isNoDeliveryDate:noDelivery,adminEmails:() => ['admin@example.invalid'],now:() => clock,
    sourceLoader:async day => ({ tab:day,url:'',routes:[{ laneId:'east',names:['센코필라테스'] },{ laneId:'west',names:['하얀약국'] }] }) });
  await db.collection('users').doc('a').update({ businessName:'센코필라테스',deliveryPlace:'경남 진주시 에나로128번길 29',deliveryPlaceDetail:'3층' });
  await db.collection('users').doc('b').update({ businessName:'센코필라테스',deliveryPlace:'경남 진주시 에나로128번길 29',deliveryPlaceDetail:'307호',defaultLunch:0 });
  await db.collection('users').doc('c').update({ businessName:'진주하얀약국',deliveryPlace:'경남 진주시 진양호로 288' });
  await db.collection('users').doc('earlier').set({ businessName:'신안동 하얀약국',defaultLunch:0 });
  let board = await sourceService.readBoard(date);
  assert.deepEqual(board.plan.order.east,['a','b']);assert.deepEqual(board.plan.order.west,['c','earlier']);
  assert.deepEqual(board.rows.map(row=>row.uid).sort(),['a','c']);
  for (const day of ['mon','tue','wed','thu','fri']) {
    const template = (await db.collection(TEMPLATES).doc(day).get()).data();
    assert.deepEqual(template.order.east,['a','b']);assert.deepEqual(template.order.west,['c','earlier']);
  }
  await db.collection('orders').doc('2026-10-08').collection('items').doc('b').set({ lunchCount:3 });
  board = await sourceService.readBoard('2026-10-08');
  assert.deepEqual(board.plan.order.east,['a','b']);assert.deepEqual(board.rows.filter(row=>['a','b'].includes(row.uid)).map(row=>[row.uid,row.lunchCount]).sort(),[['a',2],['b',3]]);
  assert.equal((await db.collection(BOARDS).doc('2026-10-08').get()).exists,false);
  assert.deepEqual(board.routeSource.ambiguous,[]);
});
test('pickups follow the previous delivery day into the board and the driver course', async () => {
  const { link } = await assigned();
  let board = await service.readBoard(date);
  assert.equal(board.pickupDate,'2026-10-06');assert.deepEqual(board.pickups,[]);
  await db.collection('orders').doc(date).collection('items').doc('b').set({ selfHoliday:true });
  board = await service.readBoard(date);
  assert.deepEqual(board.pickups.map(row=>[row.uid,row.laneId,row.lunchCount,row.address]),[['b','center',2,'주소 b']]);
  assert.equal('lunchPrice' in board.pickups[0],false);
  const read = await service.driverRead({ token:link.token });
  assert.deepEqual(read.rows.map(row=>row.uid),['a']);assert.deepEqual(read.pickups.map(row=>row.uid),['b']);assert.equal(read.pickupDate,'2026-10-06');
  // A member removed since the last delivery is still collected from, by the delivery record.
  await db.collection('deliveryRecords').doc('2026-10-06').set({ records:{ c:{ delivered:true,lunchCount:4 } } });
  await db.collection('users').doc('c').update({ deleted:true });
  board = await service.readBoard(date);
  assert.deepEqual(board.rows.map(row=>row.uid),['a']);
  assert.deepEqual(board.pickups.map(row=>[row.uid,row.laneId,row.lunchCount]),[['b','center',2],['c','west',4]]);
  // Not visited on the previous delivery day: nothing was left there.
  await db.collection('orders').doc('2026-10-06').collection('items').doc('b').set({ selfHoliday:true });
  assert.deepEqual((await service.readBoard(date)).pickups.map(row=>row.uid),['c']);
  // A registered holiday is skipped, as is the weekend before a Monday.
  await db.collection('config').doc('holidays').set({ custom:{ '2026-10-06':'임시 휴무' } });
  board = await service.readBoard(date);
  assert.equal(board.pickupDate,'2026-10-05');assert.deepEqual(board.pickups.map(row=>row.uid),['b']);
  assert.equal((await service.readBoard('2026-10-12')).pickupDate,'2026-10-09');
  await db.collection('config').doc('holidays').set({ custom:{ [date]:'휴무' } });
  board = await service.readBoard(date);
  assert.equal(board.pickupDate,'');assert.deepEqual(board.pickups,[]);
});
test('all-courses link lists every course, completes any stop of the date and is revoked on its own', async () => {
  const { link } = await assigned();
  let board = await service.readBoard(date);
  await assert.rejects(service.share({ date,all:true,revision:board.revision+1 },actor),e => e.status===409);
  const all = await service.share({ date,all:true,revision:board.revision },actor);
  assert.notEqual(all.token,link.token);
  assert.equal((await service.share({ date,all:true,revision:all.revision },actor)).token,all.token);
  assert.equal((await db.collection(SHARES).doc(shareHash(all.token)).get()).data().all,true);
  await db.collection('orders').doc(date).collection('items').doc('b').set({ selfHoliday:true });
  let read = await service.driverRead({ token:all.token });
  assert.equal(read.all,true);assert.equal(read.canComplete,true);
  assert.deepEqual(read.courses.map(course=>[course.lane.id,course.rows.map(row=>row.uid),course.pickups.map(row=>row.uid)]),[['center',['a'],['b']],['west',['c'],[]],['east',[],[]]]);
  assert.deepEqual(read.rows.map(row=>row.uid),['a','c']);assert.equal(read.rows[0].lunchPrice,undefined);
  // The single-course link still cannot reach another course; the all-courses link can.
  const stop = read.rows.find(row=>row.uid==='c');
  await assert.rejects(service.complete({ token:link.token,uid:'c',delivered:true,signature:stop.signature }),e => e.status===403);
  assert.equal((await service.complete({ token:all.token,uid:'c',delivered:true,signature:stop.signature })).changed,true);
  assert.equal((await db.collection('deliveryRecords').doc(date).get()).data().records.c.delivered,true);
  await assert.rejects(service.complete({ token:all.token,uid:'ghost',delivered:true,signature:'any' }),e => e.status===403);
  // A member not yet given a course is listed, so no stop is missed.
  await db.collection('users').doc('new').set({ businessName:'신규 테스트',defaultLunch:3 });
  read = await service.driverRead({ token:all.token });
  assert.deepEqual(read.courses.map(course=>course.lane.id),['center','west','east','unassigned']);
  assert.deepEqual(read.courses.at(-1).rows.map(row=>row.uid),['new']);
  // Each link is revoked on its own, and editing courses leaves the all-courses link alone.
  await service.revoke({ date,laneId:'center' },actor);
  await assert.rejects(service.driverRead({ token:link.token }),e => e.status===403);
  board = await service.readBoard(date);
  board.plan.lanes=board.plan.lanes.filter(lane=>lane.id!=='east');delete board.plan.order.east;
  await service.saveBoard({ date,revision:board.revision,plan:board.plan },actor);
  assert.deepEqual((await service.driverRead({ token:all.token })).courses.map(course=>course.lane.id),['center','west','unassigned']);
  await service.revoke({ date,all:true },actor);
  await assert.rejects(service.driverRead({ token:all.token }),e => e.status===403);
  await assert.rejects(service.complete({ token:all.token,uid:'a',delivered:true,signature:'any' }),e => e.status===403);
  board = await service.readBoard(date);
  assert.notEqual((await service.share({ date,all:true,revision:board.revision },actor)).token,all.token);
  clock = new Date('2026-10-08T03:00:00Z');
  await assert.rejects(service.share({ date,all:true,revision:board.revision },actor),e => e.status===400);
});
test('event lunches join the board, drivers complete registered events and weekday orders keep members only', async () => {
  const { link } = await assigned(), adminRef = db.collection('users').doc('monthly-admin');
  // As in production, the administrator's document has no email; its sign-in account finds it.
  await adminRef.set({ deleted:true, adminEvents:{
    event_party:{ kind:'eventLunch',eventDate:date,eventTime:'11:00',place:'행사장',businessName:'행사 업체',items:[{ name:'제육 한상',qty:10,price:9000 }],count:10,delivered:false,settlement:{ status:'미정산',note:'보존' } },
    event_gone:{ deleted:true }
  } });
  await db.collection('eventOrders').doc('pub1').set({ eventDate:date,eventTime:'12:00',place:'접수 장소',businessName:'비회원 손님',items:[{ name:'김치제육',qty:3 }],status:'new' });
  await db.collection('eventOrders').doc('pub2').set({ eventDate:date,status:'registered',items:[{ name:'x',qty:1 }] });
  let board = await service.readBoard(date);
  assert.deepEqual(board.rows.filter(row=>row.kind==='event').map(row=>[row.uid,row.eventQty,row.received]),[['event_party',10,false],['event_pub1',3,true]]);
  assert.deepEqual(board.plan.order.unassigned,['event_party','event_pub1']);
  board.plan.order.unassigned=['event_pub1'];board.plan.order.center.push('event_party');
  await service.saveBoard({ date,revision:board.revision,plan:board.plan },actor);
  let read = await service.driverRead({ token:link.token });
  const party = read.rows.find(row=>row.uid==='event_party');
  assert.deepEqual(read.rows.map(row=>row.uid),['a','b','event_party']);
  assert.equal(party.cateringLabel,'제육 한상 10개');assert.equal(party.amount,undefined);assert.equal(party.price,undefined);
  await assert.rejects(service.pause({ date,uid:'event_party',signature:party.signature },actor),e => e.status===400);
  assert.equal((await service.complete({ token:link.token,uid:'event_party',delivered:true,signature:party.signature })).changed,true);
  let saved = (await adminRef.get()).data().adminEvents.event_party;
  assert.equal(saved.delivered,true);assert.match(saved.deliveredBy,/^monthlyDriver:/);assert.deepEqual(saved.settlement,{ status:'미정산',note:'보존' });assert.equal(saved.items[0].price,9000);
  assert.equal((await adminRef.get()).data().adminEvents.event_gone.deleted,true);
  read = await service.driverRead({ token:link.token });assert.equal(read.rows.at(-1).delivered,true);
  await service.complete({ token:link.token,uid:'event_party',delivered:false,signature:party.signature });
  saved = (await adminRef.get()).data().adminEvents.event_party;assert.equal(saved.delivered,false);assert.equal(saved.deliveredAt,'');
  // A changed event and a public order still waiting for the administrator cannot be completed.
  await adminRef.set({ adminEvents:{ event_party:{ items:[{ name:'제육 한상',qty:12,price:9000 }] } } },{ merge:true });
  await assert.rejects(service.complete({ token:link.token,uid:'event_party',delivered:true,signature:party.signature }),e => e.status===409);
  board = await service.readBoard(date);
  const all = await service.share({ date,all:true,revision:board.revision },actor), pending = (await service.driverRead({ token:all.token })).rows.find(row=>row.uid==='event_pub1');
  assert.equal(pending.received,true);
  await assert.rejects(service.complete({ token:all.token,uid:'event_pub1',delivered:true,signature:pending.signature }),e => e.status===409 && /비회원/.test(e.message));
  // Fixing the weekday order keeps members and drops the one-day events.
  board = await service.readBoard(date);
  await service.saveTemplate({ date,templateRevision:board.templateRevision,plan:board.plan },actor);
  const template = (await db.collection(TEMPLATES).doc('wed').get()).data();
  assert.deepEqual(Object.values(template.order).flat().filter(uid=>uid.startsWith('event_')),[]);
  assert.equal((await service.readBoard(date)).templateFixed,true);
  // Weekend events still get a board, with no monthly meal.
  await adminRef.set({ adminEvents:{ event_sat:{ eventDate:'2026-10-10',eventTime:'10:00',place:'토요 행사장',count:20,businessName:'토요 업체' } } },{ merge:true });
  const weekend = await service.readBoard('2026-10-10');
  assert.equal(weekend.noDelivery,true);assert.deepEqual(weekend.rows.map(row=>row.uid),['event_sat']);assert.deepEqual(weekend.pickups,[]);
});
test('a fixed weekday order survives route sheet edits until it is unfixed', async () => {
  let routes = [{ laneId:'center',names:['테스트 a','테스트 b'] },{ laneId:'west',names:['테스트 c'] }];
  const sourceService = createMonthlyDeliveryService({ db,timestamp:() => FieldValue.serverTimestamp(),isNoDeliveryDate:noDelivery,adminEmails:() => ['admin@example.invalid'],now:() => clock,
    sourceLoader:async () => ({ tab:'수',url:'',routes }) });
  let board = await sourceService.readBoard(date);
  assert.equal(board.templateFixed,false);assert.deepEqual(board.plan.order.center,['a','b']);
  routes = [{ laneId:'center',names:['테스트 b','테스트 a'] },{ laneId:'west',names:['테스트 c'] }];
  board = await sourceService.readBoard(date);
  assert.deepEqual(board.plan.order.center,['b','a']);
  board.plan.order.center=['a','b'];
  await assert.rejects(sourceService.saveTemplate({ date,templateRevision:board.templateRevision+1,plan:board.plan },actor),e => e.status===409);
  await sourceService.saveTemplate({ date,templateRevision:board.templateRevision,plan:board.plan },actor);
  await db.collection('users').doc('new').set({ businessName:'신규 테스트',defaultLunch:2 });
  routes = [{ laneId:'center',names:['테스트 c','테스트 b','테스트 a','신규 테스트'] },{ laneId:'west',names:[] }];
  board = await sourceService.readBoard(date);
  assert.equal(board.templateFixed,true);
  assert.deepEqual(board.plan.order.center,['a','b','new']);assert.deepEqual(board.plan.order.west,['c']);
  assert.equal((await db.collection(BOARDS).doc(date).get()).exists,false);
  await sourceService.unfixTemplate({ date,templateRevision:board.templateRevision },actor);
  board = await sourceService.readBoard(date);
  assert.equal(board.templateFixed,false);assert.deepEqual(board.plan.order.center,['c','b','a','new']);
  await assert.rejects(sourceService.unfixTemplate({ date:'2026-10-10',templateRevision:0 },actor),e => e.status===400);
});
test('a course memo stays with the course across dated links, within each link scope', async () => {
  const { link } = await assigned();
  let read = await service.driverRead({ token:link.token });
  assert.deepEqual(read.memo,{ text:'',updatedAt:'' });
  await service.saveMemo({ token:link.token,text:'어제 못 감\r\n- 테스트 b 수거\n' });
  read = await service.driverRead({ token:link.token });
  assert.equal(read.memo.text,'어제 못 감\n- 테스트 b 수거');assert.ok(read.memo.updatedAt);
  assert.match((await db.collection(MEMOS).doc('center').get()).data().updatedBy,/^monthlyDriver:/);
  // The course link cannot reach another course, an unassigned pool or an over-long memo.
  await assert.rejects(service.saveMemo({ token:link.token,laneId:'west',text:'x' }),e => e.status===403);
  await assert.rejects(service.saveMemo({ token:link.token,text:'x'.repeat(1001) }),e => e.status===400);
  // The next day's link for the same course still shows it, and the admin board sees it.
  const next = '2026-10-08', nextBoard = await service.readBoard(next);
  const nextLink = await service.share({ date:next,laneId:'center',revision:nextBoard.revision },actor);
  assert.equal((await service.driverRead({ token:nextLink.token })).memo.text,'어제 못 감\n- 테스트 b 수거');
  assert.equal((await service.readBoard(date)).memos.center.text,'어제 못 감\n- 테스트 b 수거');
  assert.equal((await service.readBoard(date)).memos.unassigned,undefined);
  // The all-courses link writes any course of the date and lists each course memo.
  let board = await service.readBoard(date);
  const all = await service.share({ date,all:true,revision:board.revision },actor);
  await service.saveMemo({ token:all.token,laneId:'west',text:'평거 꼭 할 일' });
  await assert.rejects(service.saveMemo({ token:all.token,laneId:'unassigned',text:'x' }),e => e.status===403);
  await assert.rejects(service.saveMemo({ token:all.token,laneId:'nowhere',text:'x' }),e => e.status===403);
  read = await service.driverRead({ token:all.token });
  assert.deepEqual(read.courses.map(course=>[course.lane.id,course.memo?.text]),[['center','어제 못 감\n- 테스트 b 수거'],['west','평거 꼭 할 일'],['east','']]);
  // Clearing saves an empty memo; a revoked link writes nothing.
  await service.saveMemo({ token:link.token,text:'' });
  assert.equal((await service.driverRead({ token:link.token })).memo.text,'');
  await service.revoke({ date,laneId:'center' },actor);
  await assert.rejects(service.saveMemo({ token:link.token,text:'x' }),e => e.status===403);
  assert.equal((await db.collection(MEMOS).doc('center').get()).data().text,'');
});
test('share revocation, expiry and deleting course deny old links', async () => {
  const { link } = await assigned();
  await service.revoke({ date,laneId:'center' },actor);
  await assert.rejects(service.driverRead({ token:link.token }),e => e.status===403);
  const board = await service.readBoard(date), next = await service.share({ date,laneId:'center',revision:board.revision },actor);
  assert.notEqual(next.token,link.token);assert.equal((await db.collection(SHARES).doc(shareHash(next.token)).get()).data().revoked,false);
  clock = new Date(next.expiresAt+1);
  await assert.rejects(service.driverRead({ token:next.token }),e => e.status===403);
  clock = new Date('2026-10-07T03:00:00Z');
  board.plan.lanes=board.plan.lanes.filter(l => l.id!=='center');delete board.plan.order.center;board.plan.order.unassigned.push('a','b');
  await service.saveBoard({ date,revision:board.revision,plan:board.plan },actor);
  await assert.rejects(service.driverRead({ token:next.token }),e => e.status===403);
  // Undoing a removed course must not reactivate its already revoked secret link.
  const restored=await service.readBoard(date);restored.plan.lanes.unshift({ id:'center',name:'복원',driver:'' });restored.plan.order.center=['a','b'];restored.plan.order.unassigned=[];
  await service.saveBoard({ date,revision:restored.revision,plan:restored.plan },actor);
  await assert.rejects(service.driverRead({ token:next.token }),e => e.status===403);
});
test('future link is read only and cancelled or changed orders cannot be completed from stale view', async () => {
  const { link } = await assigned();
  const read = await service.driverRead({ token:link.token });
  await db.collection('orders').doc(date).collection('items').doc('a').set({ lunchCount:5 });
  await assert.rejects(service.complete({ token:link.token,uid:'a',delivered:true,signature:read.rows[0].signature }),e => e.status===409);
  await db.collection('orders').doc(date).collection('items').doc('a').set({ selfHoliday:true });
  await assert.rejects(service.complete({ token:link.token,uid:'a',delivered:true,signature:read.rows[0].signature }),e => e.status===409);
  clock=new Date('2026-10-06T03:00:00Z');assert.equal((await service.driverRead({ token:link.token })).canComplete,false);
  await assert.rejects(check('b',link.token),e => e.status===400);
});
test('concurrent completion writes one record and one bill; cancel removes its daily line and unpaid bill', async () => {
  const { link } = await assigned();
  const results = await Promise.all([check('a',link.token),check('a',link.token)]);
  assert.equal(results.filter(r => r.changed).length,1);
  const record = (await db.collection('deliveryRecords').doc(date).get()).data().records.a;
  assert.equal(record.delivered,true);assert.equal(record.lunchQty,2);
  const billRef=db.collection('settlements').doc('2026-10').collection('items').doc('a');
  assert.equal((await billRef.get()).data().amount,16000);
  await check('a',link.token,false); assert.equal((await billRef.get()).exists,false);
  assert.equal((await db.collection('deliveryRecords').doc(date).get()).data().records.a.delivered,false);
});
test('completion and cancellation preserve payments adjustments carryover and unrelated legacy days', async () => {
  const { link } = await assigned(), billRef=db.collection('settlements').doc('2026-10').collection('items').doc('a');
  await db.collection('users').doc('monthly-admin').set({ email:'admin@example.invalid', deliveryRecords:{ '2026-10-06':{ a:{ delivered:true,lunchQty:1 } } } });
  await billRef.set({ status:'입금완료',amount:8000,adjust:-500,payments:[{ amount:25000,date:'2026-10-06' }],carryover:2000,carriedOverTo:'2026-11',invoiceNo:'saved',note:'보존' });
  await check('a',link.token);let saved=(await billRef.get()).data();assert.equal(saved.amount,24000);assert.equal(saved.paidAmount,25000);assert.equal(saved.invoiceNo,'saved');
  assert.equal(saved.adjust,-500);assert.equal(saved.carryover,2000);assert.equal(saved.carriedOverTo,'2026-11');assert.equal(saved.note,'보존');
  await check('a',link.token,false);saved=(await billRef.get()).data();assert.equal(saved.amount,8000);assert.deepEqual(Object.keys(saved.daily),['2026-10-06']);
});
test('held settlement is skipped on completion; manual spreadsheet bill aborts entire completion', async () => {
  const { link } = await assigned(), items=db.collection('settlements').doc('2026-10').collection('items');
  await items.doc('a').set({ status:'보류',amount:1234,note:'보류 유지' });
  await check('a',link.token);assert.deepEqual((await items.doc('a').get()).data(),{ status:'보류',amount:1234,note:'보류 유지' });
  await check('a',link.token,false);assert.equal((await items.doc('a').get()).data().status,'보류');
  await items.doc('b').set({ type:'manualMonthly',amount:999 });
  await assert.rejects(check('b',link.token),e => e.status===409);
  assert.equal((await db.collection('deliveryRecords').doc(date).get()).data().records.b,undefined);
});
test('pause uses signature, blocks completed meals, and custom holidays remove all deliveries', async () => {
  const { link } = await assigned();
  const board=await service.readBoard(date),row=board.rows.find(r => r.uid==='a');
  await service.pause({ date,uid:'a',signature:row.signature },actor);
  assert.equal((await db.collection('orders').doc(date).collection('items').doc('a').get()).data().selfHoliday,true);
  await check('b',link.token);const done=(await service.driverRead({ token:link.token })).rows.find(r => r.uid==='b');
  await assert.rejects(service.pause({ date,uid:'b',signature:done.signature },actor),e => e.status===409);
  await db.collection('config').doc('holidays').set({ custom:{ [date]:'휴무' } });
  assert.deepEqual((await service.driverRead({ token:link.token })).rows,[]);
});
test('manual deliveries also disappear on pause and concurrent bills receive distinct invoice numbers', async () => {
  const { link } = await assigned();
  await db.collection('deliveryRecords').doc(date).set({ records:{ manual_x:{ adminManual:true,lunchCount:3,businessName:'직접 입력' } } });
  const row=(await service.readBoard(date)).rows.find(r => r.uid==='manual_x');assert.ok(row);
  await service.pause({ date,uid:'manual_x',signature:row.signature },actor);
  assert.equal((await service.readBoard(date)).rows.some(r => r.uid==='manual_x'),false);
  await Promise.all([check('a',link.token),check('b',link.token)]);
  const bills=await db.collection('settlements').doc('2026-10').collection('items').get();
  assert.equal(new Set(bills.docs.map(doc => doc.data().invoiceNo)).size,2);
});
test('custom categories rename and reorder without losing assignments; deleting every course is allowed', async () => {
  const { link }=await assigned();let board=await service.readBoard(date);
  board.plan.lanes.unshift({ id:'custom_route',name:'초전 B코스',driver:'임기사 · 4호차' });
  board.plan.order.custom_route=['c'];board.plan.order.west=[];
  await service.saveBoard({ date,revision:board.revision,plan:board.plan },actor);
  board=await service.readBoard(date);
  board.plan.lanes.find(l=>l.id==='center').name='하대 커스텀';board.plan.lanes.find(l=>l.id==='center').driver='박기사';
  await service.saveBoard({ date,revision:board.revision,plan:board.plan },actor);
  const read=await service.driverRead({ token:link.token });assert.equal(read.lane.name,'하대 커스텀');assert.equal(read.lane.driver,'박기사');assert.deepEqual(read.rows.map(r=>r.uid),['a','b']);
  board=await service.readBoard(date);board.plan={ lanes:[{ id:'unassigned',name:'미배정',driver:'' }],order:{ unassigned:['a','b','c'] } };
  await service.saveBoard({ date,revision:board.revision,plan:board.plan },actor);
  assert.deepEqual((await service.readBoard(date)).plan,board.plan);
  await assert.rejects(service.driverRead({ token:link.token }),e=>e.status===403);
  assert.equal((await db.collection('orders').doc(date).collection('items').get()).empty,true);
});
