'use strict';

// 어드민 '업체 직접 등록' 이 저장되지 않던 문제.
//
//   저장 실패: Function WriteBatch.set() called with invalid data.
//   FieldValue.delete() cannot be used with set() unless you pass {merge:true}
//   (found in field mealPauseStartDate in document users/biz_...)
//
// 새 문서를 만드는데 '월식 일시정지 해제' 표시(mealPause* 삭제)와
// userPrivate 이관 표시가 삭제 표시로 들어간다. set() 은 merge 없이는 그걸 받지 않아
// 저장이 통째로 실패한다. 새 문서에는 지울 필드가 없으니 빼고 넣어야 한다.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const rootDir = path.resolve(__dirname, '../../..');
const adminSource = fs.readFileSync(path.join(rootDir, 'admin.html'), 'utf8');

function extractFunction(name) {
  const start = adminSource.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} 함수를 찾지 못했습니다.`);
  let depth = 0;
  const bodyStart = adminSource.indexOf('{', adminSource.indexOf(')', start));
  for (let index = bodyStart; index < adminSource.length; index += 1) {
    if (adminSource[index] === '{') depth += 1;
    if (adminSource[index] === '}') {
      depth -= 1;
      if (depth === 0) return adminSource.slice(start, index + 1);
    }
  }
  throw new Error(`${name} 함수 끝을 찾지 못했습니다.`);
}

// Firestore 표시값을 흉내낸다. 실제 SDK 처럼 isEqual 로 서로를 가른다.
function fakeSentinel(methodName) {
  return {
    _methodName: `FieldValue.${methodName}`,
    isEqual(other) { return Boolean(other) && other._methodName === this._methodName; }
  };
}

function loadHelpers() {
  const context = {
    firebase: {
      firestore: {
        FieldValue: {
          delete: () => fakeSentinel('delete'),
          serverTimestamp: () => fakeSentinel('serverTimestamp')
        }
      }
    }
  };
  vm.createContext(context);
  vm.runInContext(`${extractFunction('isFieldDeleteSentinel')}\n${extractFunction('withoutFieldDeletes')}`, context);
  return context;
}

test('삭제 표시만 정확히 가려낸다', () => {
  const ctx = loadHelpers();
  const del = ctx.firebase.firestore.FieldValue.delete();
  const stamp = ctx.firebase.firestore.FieldValue.serverTimestamp();

  assert.equal(ctx.isFieldDeleteSentinel(del), true);
  assert.equal(ctx.isFieldDeleteSentinel(stamp), false, 'serverTimestamp 를 지우면 createdAt 이 사라진다');
  assert.equal(ctx.isFieldDeleteSentinel(''), false);
  assert.equal(ctx.isFieldDeleteSentinel(0), false);
  assert.equal(ctx.isFieldDeleteSentinel(null), false);
  assert.equal(ctx.isFieldDeleteSentinel(false), false);
  assert.equal(ctx.isFieldDeleteSentinel({ any: 'object' }), false);
  assert.equal(ctx.isFieldDeleteSentinel([]), false);
});

test('isEqual 이 없어도 이름으로 가려낸다', () => {
  const ctx = loadHelpers();
  assert.equal(ctx.isFieldDeleteSentinel({ _methodName: 'FieldValue.delete' }), true);
  assert.equal(ctx.isFieldDeleteSentinel({ _methodName: 'FieldValue.serverTimestamp' }), false);
});

test('새 업체 저장 payload 에서 삭제 표시가 빠지고 나머지는 남는다', () => {
  const ctx = loadHelpers();
  const del = () => ctx.firebase.firestore.FieldValue.delete();
  const stamp = ctx.firebase.firestore.FieldValue.serverTimestamp();

  const payload = ctx.withoutFieldDeletes({
    businessName: '테스트업체',
    phone: '010-0000-0000',
    defaultLunch: 0,
    mealPaused: false,
    // 일시정지 해제 표시
    mealPauseStartDate: del(),
    mealResumeDate: del(),
    mealPausedAt: del(),
    mealPausedBy: del(),
    // userPrivate 이관 표시
    deliveryPlace: del(),
    adminMemo: del(),
    lunchPrice: 8000,
    createdAt: stamp,
    updatedAt: stamp
  });

  assert.deepEqual(Object.keys(payload).sort(), [
    'businessName', 'createdAt', 'defaultLunch', 'lunchPrice',
    'mealPaused', 'phone', 'updatedAt'
  ]);
  assert.equal(payload.businessName, '테스트업체');
  assert.equal(payload.defaultLunch, 0, '0 같은 값이 같이 날아가면 안 된다');
  assert.equal(payload.mealPaused, false, 'false 도 남아야 한다');
  assert.equal(payload.createdAt, stamp);
});

test('업체 등록은 삭제 표시를 걷어내고 set 한다', () => {
  // 실수로 다시 걷어내지 않게 저장 코드 자체를 고정한다.
  const saveSource = adminSource.slice(adminSource.indexOf('const isCreate = document.getElementById(\'edit-mode\')'));
  const createBlock = saveSource.slice(0, saveSource.indexOf('} else {'));
  assert.match(createBlock, /batch\.set\(\s*db\.collection\('users'\)\.doc\(uid\),\s*withoutFieldDeletes\(/,
    '업체 등록이 withoutFieldDeletes 없이 set 하면 저장이 실패한다');
});
