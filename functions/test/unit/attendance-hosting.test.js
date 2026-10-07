'use strict';

// 오래된 태블릿(안드로이드 6)은 github.io 인증서를 믿지 못해 출퇴근 화면이 안 열렸다.
// 출퇴근 화면만 Firebase Hosting(web.app)에도 올린다. 빠진 파일이 있으면 그 주소에서 화면이 깨진다.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../../..');
const { localRefs } = require('../../../scripts/build-attendance-hosting.js');

test('출퇴근 화면이 부르는 로컬 파일을 모두 모으고, 그 파일들이 실제로 있다', () => {
  const html = fs.readFileSync(path.join(root, 'attendance.html'), 'utf8');
  const refs = localRefs(html);
  for (const file of ['assets/js/attendance-kiosk.js', 'assets/js/attendance-ui.js', 'assets/css/attendance.css']) {
    assert.ok(refs.includes(file), `${file} 이 빠졌습니다`);
  }
  for (const ref of refs) assert.ok(fs.existsSync(path.join(root, ref)), `${ref} 가 없습니다`);
});

test('web.app 에서 열려도 다른 페이지로 가는 링크는 github.io 로 간다', () => {
  const html = fs.readFileSync(path.join(root, 'attendance.html'), 'utf8');
  assert.doesNotMatch(html, /href=["']\.\/[^"']+\.html/);
});

test('firebase.json 호스팅은 모은 폴더만 올리고, 매뉴얼의 주소가 프로젝트와 같다', () => {
  const config = JSON.parse(fs.readFileSync(path.join(root, 'firebase.json'), 'utf8'));
  assert.equal(config.hosting.public, '.hosting');
  const project = /FIREBASE_PROJECT_ID: (\S+)/.exec(fs.readFileSync(path.join(root, '.github/workflows/deploy-hosting.yml'), 'utf8'))[1];
  const manual = fs.readFileSync(path.join(root, 'assets/js/staff-manual.js'), 'utf8');
  assert.match(manual, new RegExp(`https://${project}\\.web\\.app/\\?store=suragan`));
});
