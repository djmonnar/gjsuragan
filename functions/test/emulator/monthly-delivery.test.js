'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { initializeApp,deleteApp } = require('firebase-admin/app');
const { getFirestore,FieldValue } = require('firebase-admin/firestore');
const { createMonthlyDeliveryService,BOARDS,TEMPLATES,SHARES,shareHash } = require('../../monthlyDelivery');
const date = '2026-10-07', actor = { uid:'monthly-admin' }, projectId = 'demo-gjsuragan-safety';
let app,db,service;
let clock = new Date('2026-10-07T03:00:00Z');
const noDelivery = (day,custom={}) => [0,6].includes(new Date(`${day}T00:00:00Z`).getUTCDay()) || Boolean(custom[day]);
test.before(() => {
  assert.ok(process.env.FIRESTORE_EMULATOR_HOST,'Run with Firestore emulator only');
  app = initializeApp({ projectId },`monthly-${Date.now()}`); db = getFirestore(app);
  service = createMonthlyDeliveryService({ db,timestamp:() => FieldValue.serverTimestamp(),isNoDeliveryDate:noDelivery,adminEmails:() => ['admin@example.invalid'],now:() => clock });
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
