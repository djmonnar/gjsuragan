'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../../monthlyDeliverySheet');
const M = require('../../monthlyDeliveryModel');

function sheet(weekday) {
  const rows = Array.from({ length:30 }, () => []), starts = S.TABS[weekday].starts;
  rows[starts[0]] = ['하대 시내 초전','다도','동북관세법인'];
  rows[starts[0] + 1] = ['', '본인테리어'];
  rows[starts[1]] = ['평거동','목산','레디콜'];
  rows[starts[1] + 1] = ['', '진주어린이치과','목산'];
  rows[starts[2]] = [weekday === 'wed' ? '' : '혁신','코앰','멘토스스터디카페'];
  rows[starts[2] + 1] = ['', '하나기공소','행사','11','.'];
  rows[19] = ['하대 시내 초전','과거 업체'];
  return rows;
}
const users = {
  a:{ businessName:'다도 OA' }, b:{ businessName:'동북관세법인' }, c:{ businessName:'본건축인테리어' },
  d:{ businessName:'진주목산정형외과의원' }, e:{ businessName:'(주)래디콜' }, f:{ businessName:'진주어린e치과' },
  g:{ businessName:'주식회사 코엠엔지니어링' }, h:{ businessName:'멘토즈 스터디카페' }, i:{ businessName:'진주하나치과기공소' }
};
test('verified weekday blocks retain source order, deduplicate stops and keep separate Friday lower blocks from overriding them', () => {
  for (const day of Object.keys(S.TABS)) {
    const matched = S.matchRoutes(S.parseRoutes(sheet(day),day),users);
    assert.deepEqual(matched.plan.order.center,['a','b','c']);
    assert.deepEqual(matched.plan.order.west,['d','e','f']);
    assert.deepEqual(matched.plan.order.east,['g','h','i']);
    assert.deepEqual(matched.unmatched,[]); assert.deepEqual(matched.ambiguous,[]);
  }
  const broken = sheet('wed'); broken[4][0] = '違う位置';
  assert.throws(() => S.parseRoutes(broken,'wed'), /행 위치/);
});
test('matching refuses ambiguous names and unknown companies; exact names and aliases stay deterministic', () => {
  const matched = S.matchRoutes([{ laneId:'center',names:['목산','동북관세법인','미등록','constructor'] }], {
    ...users,j:{ businessName:'목산 약국' },k:{ businessName:'동북관세법인 진주지사' },x:{ businessName:'목산 테스트',deleted:true }
  });
  assert.deepEqual(matched.plan.order.center,['b']);
  assert.deepEqual(matched.ambiguous,['목산']);assert.deepEqual(matched.unmatched,['미등록','constructor']);
});
test('operator-confirmed school name maps the source abbreviation to the current customer', () => {
  const matched = S.matchRoutes([{ laneId:'center',names:['도동초'] }],{ school:{ businessName:'서부거점형 다문화교육센터' } });
  assert.deepEqual(matched.plan.order.center,['school']);assert.deepEqual(matched.unmatched,[]);
});
test('operator-confirmed separate customs office is an adjacent stop without merging customer records', () => {
  const matched = S.matchRoutes([{ laneId:'center',names:['동북관세법인','다도'] }],{ main:{ businessName:'동북관세법인' },office:{ businessName:'진주관세사무소' },a:{ businessName:'다도 OA' } });
  assert.deepEqual(matched.plan.order.center,['main','office','a']);
  const rows = M.resolveRows({ date:'2026-10-07',users:{ main:{ businessName:'동북관세법인',defaultLunch:10,defaultSalad:1 },office:{ businessName:'진주관세사무소',defaultLunch:0,defaultSalad:1 } } });
  assert.deepEqual(rows.map(row=>[row.uid,row.lunchCount,row.saladCount]).sort(),[['main',10,1],['office',0,1]]);
});
test('sheet seeding keeps manual moves, explicitly unassigned stops, custom categories and dormant ranks', () => {
  const source = S.matchRoutes(S.parseRoutes(sheet('wed'),'wed'),users).plan;
  const edited = { lanes:source.lanes,order:{ center:['d','paused','a'],west:['b'],east:[],unassigned:['e'] } };
  const result = M.planWithSource(edited,[{ uid:'new' }],source);
  assert.deepEqual(result.order.center,['d','paused','a','c']); assert.deepEqual(result.order.west,['b','f']);
  assert.deepEqual(result.order.east,['g','h','i']);assert.deepEqual(result.order.unassigned,['e','new']);
  const custom = M.planWithSource({ lanes:[{ id:'custom',name:'직접 만든 코스',driver:'' },{ id:'unassigned',name:'미배정',driver:'' }],order:{ custom:['a'],unassigned:[] } },[{ uid:'b' }],source);
  assert.deepEqual(custom.order,{ custom:['a'],unassigned:['b'] });
});
test('all weekday base plans include dormant customers and inherit a known route when one tab omits them', () => {
  const sources = Object.fromEntries(Object.keys(S.TABS).map(day => [day,{ routes:[{ laneId:day === 'wed' ? 'west' : 'center',names:day === 'fri' ? [] : ['다도'] }] }]));
  const plans = S.weekPlans(sources,{ a:{ businessName:'다도 OA',mealPaused:true },unknown:{ businessName:'미등록 업체' },deleted:{ businessName:'삭제 업체',deleted:true } });
  for (const plan of Object.values(plans)) { assert.deepEqual(Object.values(plan.order).flat().sort(),['a','unknown']);assert.deepEqual(plan.order.unassigned,['unknown']); }
  assert.deepEqual(plans.wed.order.west,['a']);assert.deepEqual(plans.fri.order.center,['a']);
});
test('Firestore map key order does not create phantom routing edits, but stop and category order do', () => {
  const plan = S.matchRoutes(S.parseRoutes(sheet('wed'),'wed'),users).plan;
  const reordered = { lanes:plan.lanes,order:Object.fromEntries(Object.entries(plan.order).reverse()) };
  assert.equal(M.samePlan(plan,reordered),true);
  assert.equal(M.samePlan(plan,{ ...plan,order:{ ...plan.order,center:[...plan.order.center].reverse() } }),false);
  assert.equal(M.samePlan(plan,{ ...plan,lanes:[...plan.lanes].reverse() }),false);
});
test('CSV export accepts Korean, quoted commas/newlines and escaped quotes', () => {
  assert.deepEqual(S.parseCsv('\ufeff코스,"업체, 이름",수량\r\n"평거\n동","가게 ""A""",2\r\n'),[['코스','업체, 이름','수량'],['평거\n동','가게 "A"','2']]);
  assert.throws(() => S.parseCsv('"끝나지 않음'), /CSV/);
});
test('source loader caches concurrent reads, retains good routes during outage, and never reads weekend sheets', async () => {
  let calls = 0, now = 0, fail = false;
  const csv = sheet('wed').map(row=>row.join(',')).join('\n');
  const loader = S.createSourceLoader({ ttlMs:100,now:()=>now,fetchImpl:async url => {
    calls++; assert.match(url,/export\?format=csv&gid=0$/);
    if (fail) throw new Error('연결 실패');
    return new Response(csv,{ headers:{ 'content-type':'text/csv; charset=utf-8' } });
  } });
  const [a,b] = await Promise.all([loader('wed'),loader('wed')]); assert.deepEqual(a,b);assert.equal(calls,1);
  now = 99; await loader('wed');assert.equal(calls,1);
  now = 101; fail = true;const retained = await loader('wed'); assert.deepEqual(retained.routes,a.routes);assert.equal(retained.warning,'연결 실패');
  await loader('wed');assert.equal(calls,2);
  assert.deepEqual((await loader('sun')).routes,[]);assert.equal(calls,2);
});
