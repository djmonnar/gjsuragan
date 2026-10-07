'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { timeMinutes,sortPlanByTime } = require('../../../assets/js/monthly-delivery-board');

test('time order handles the 24-hour clock and leaves missing or invalid times last', () => {
  assert.equal(timeMinutes(' 09:05 '),545);assert.equal(timeMinutes('00:00'),0);assert.equal(timeMinutes('23:59'),1439);
  for (const value of ['',null,'24:00','12:60','시간 미입력','오전']) assert.equal(timeMinutes(value),Infinity);
});

test('time sorting keeps course membership, ties, dormant ranks and original input intact', () => {
  const plan = { lanes:[{ id:'center' },{ id:'west' },{ id:'unassigned' }],order:{ center:['late','paused','tieA','missing','early','tieB'],west:['westLate','westEarly'],unassigned:['unknown'] } };
  const original = structuredClone(plan), rows = [
    { uid:'late',mealTime:'12:00',lunchCount:9,delivered:true },{ uid:'tieA',mealTime:'11:30' },{ uid:'missing',mealTime:'' },
    { uid:'early',mealTime:'09:00' },{ uid:'tieB',mealTime:'11:30' },{ uid:'westLate',mealTime:'12:30' },{ uid:'westEarly',mealTime:'10:00' },{ uid:'unknown',mealTime:'08:00' }
  ];
  const originalRows = structuredClone(rows), sorted = sortPlanByTime(plan,rows);
  assert.deepEqual(sorted.order.center,['early','paused','tieA','tieB','late','missing']);
  assert.deepEqual(sorted.order.west,['westEarly','westLate']);assert.deepEqual(sorted.order.unassigned,['unknown']);
  assert.deepEqual(plan,original);assert.deepEqual(rows,originalRows);
  assert.deepEqual(sortPlanByTime(plan,rows,'west').order.center,plan.order.center);
  assert.deepEqual(sortPlanByTime(sorted,rows),sorted);
});
