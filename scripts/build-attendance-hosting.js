'use strict';

// 출퇴근 태블릿 화면만 Firebase Hosting(gjsuragan-60505.web.app)에 올린다.
// 안드로이드 6 같은 오래된 태블릿이 djmonnar.github.io 인증서를 믿지 못해
// NET::ERR_CERT_AUTHORITY_INVALID 로 화면이 안 열렸다. web.app 은 출퇴근 서버
// (cloudfunctions.net)와 같은 구글 인증서를 써서 그런 기기에서도 열린다.
//
// attendance.html 이 부르는 로컬 파일을 그대로 따라가 .hosting/ 에 복사한다.
// 화면에 파일을 더하거나 ?v= 를 올려도 이 목록을 따로 고칠 필요가 없다.

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const out = path.join(root, '.hosting');
const PAGES = ['attendance.html'];

function localRefs(html) {
  return [...html.matchAll(/\b(?:src|href)=["']\.\/([^"'#?]+)(?:\?[^"']*)?["']/g)]
    .map(match => match[1])
    .filter(ref => !ref.endsWith('.html'));
}

function build() {
  fs.rmSync(out, { recursive: true, force: true });
  const files = new Set();
  for (const page of PAGES) {
    files.add(page);
    localRefs(fs.readFileSync(path.join(root, page), 'utf8')).forEach(ref => files.add(ref));
  }
  for (const file of files) {
    const from = path.join(root, file);
    if (!fs.existsSync(from)) throw new Error(`${file} 이 없습니다. attendance.html 이 부르는 파일입니다.`);
    fs.mkdirSync(path.dirname(path.join(out, file)), { recursive: true });
    fs.copyFileSync(from, path.join(out, file));
  }
  // 주소만 치면 바로 출퇴근 화면이 뜨게 한다.
  fs.copyFileSync(path.join(root, 'attendance.html'), path.join(out, 'index.html'));
  return [...files].sort();
}

if (require.main === module) {
  const files = build();
  console.log(`출퇴근 화면 ${files.length}개 파일을 .hosting/ 에 모았습니다.`);
  files.forEach(file => console.log(`  ${file}`));
}

module.exports = { build, localRefs };
