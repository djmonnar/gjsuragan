'use strict';

// 이 브라우저 자체가 출퇴근 태블릿으로 연결돼 있으면 관리 화면이 알려줘야 한다.
// 모르면 '궁중수라간 태블릿' 을 눌러도 돌담명가가 열려 고장으로 보인다.

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const nodeCrypto = require('node:crypto');

const root = path.resolve(__dirname, '../../..');
const TOKEN = 'a'.repeat(64);
// 서버가 기기 id 를 만드는 방식과 같아야 한다 (attendance.js 의 digest).
const DEVICE_ID = nodeCrypto.createHash('sha256').update(TOKEN).digest('hex');

function load(stored) {
  const store = new Map(stored === undefined ? [] : [['gjsuragan-attendance-device', stored]]);
  const window = { crypto: nodeCrypto.webcrypto };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'assets/js/attendance-ui.js'), 'utf8'), { window, URLSearchParams });
  const document = { getElementById: () => ({ innerHTML: '', textContent: '', value: '', classList: { toggle() {}, add() {} } }), querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, removeEventListener() {} };
  const source = fs.readFileSync(path.join(root, 'assets/js/attendance-admin.js'), 'utf8')
    .replace('window.AttendanceAdmin = { init, dispose };', 'window.AttendanceAdmin = { deviceIdInThisBrowser, markConnectedDeviceHere };');
  vm.runInNewContext(source, {
    window, document, Intl, URLSearchParams, TextEncoder, Uint8Array, setTimeout, clearTimeout, navigator: {},
    localStorage: { getItem: key => (store.has(key) ? store.get(key) : null), setItem() {}, removeItem() {} }
  });
  return window.AttendanceAdmin;
}

const box = () => {
  const node = { innerHTML: '' };
  return { node, el: { querySelector: sel => (sel === '#att-device-here' ? node : null) } };
};

test('저장된 토큰에서 서버와 같은 기기 id 를 만든다', async () => {
  // 이 해시가 서버와 다르면 어떤 기기도 못 찾아서 안내가 영영 안 뜬다.
  assert.equal(await load(TOKEN).deviceIdInThisBrowser(), DEVICE_ID);
});

test('연결된 기기면 어느 기기인지와 왜 그 매장이 열리는지 알려준다', async () => {
  const api = load(TOKEN);
  const { node, el } = box();
  await api.markConnectedDeviceHere(el, [{ id: DEVICE_ID, name: '매장 출퇴근 태블릿', floor: 1, enabled: true }]);
  assert.match(node.innerHTML, /돌담명가/);
  assert.match(node.innerHTML, /매장 변경/);
});

test('궁중수라간으로 연결된 기기면 궁중수라간이라고 나온다', async () => {
  const api = load(TOKEN);
  const { node, el } = box();
  await api.markConnectedDeviceHere(el, [{ id: DEVICE_ID, name: '매장 출퇴근 태블릿', floor: 2, enabled: true }]);
  assert.match(node.innerHTML, /궁중수라간/);
  assert.doesNotMatch(node.innerHTML, /돌담명가/);
});

test('연결 안 된 브라우저에서는 아무 말도 하지 않는다', async () => {
  for (const stored of [undefined, '', 'not-a-token', 'b'.repeat(64)]) {
    const api = load(stored);
    const { node, el } = box();
    await api.markConnectedDeviceHere(el, [{ id: DEVICE_ID, name: '매장 출퇴근 태블릿', floor: 1, enabled: true }]);
    assert.equal(node.innerHTML, '', String(stored));
  }
});

test('저장소를 못 읽어도 터지지 않는다', async () => {
  // 저장소를 막아둔 브라우저가 있다. 안내만 못 할 뿐 목록은 그대로 써야 한다.
  const window = { crypto: nodeCrypto.webcrypto };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'assets/js/attendance-ui.js'), 'utf8'), { window, URLSearchParams });
  const source = fs.readFileSync(path.join(root, 'assets/js/attendance-admin.js'), 'utf8')
    .replace('window.AttendanceAdmin = { init, dispose };', 'window.AttendanceAdmin = { deviceIdInThisBrowser, markConnectedDeviceHere };');
  vm.runInNewContext(source, {
    window, document: { getElementById: () => ({}), querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, removeEventListener() {} },
    Intl, URLSearchParams, TextEncoder, Uint8Array, setTimeout, clearTimeout, navigator: {},
    localStorage: { getItem() { throw new Error('blocked'); } }
  });
  assert.equal(await window.AttendanceAdmin.deviceIdInThisBrowser(), '');
  // 안내 칸이 없는 화면에서 불려도 조용히 넘어간다.
  await window.AttendanceAdmin.markConnectedDeviceHere({ querySelector: () => null }, []);
});
