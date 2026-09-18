'use strict';

// 배포본에는 functions/ 폴더만 들어간다 (firebase.json 의 functions.source).
// 그 밖의 파일을 require 하면 배포는 통과하고, 컨테이너가 뜨다가 죽는다.
//   Container Healthcheck failed. The user-provided container failed to start
// 로컬 테스트는 저장소 전체에서 도니까 멀쩡히 통과한다. 그래서 여기서 막는다.
//
// 공유해야 할 파일은 functions/ 안으로 복사해 두고 쓴다 (cateringCatalog.js 가 그 예).

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const entryPoints = ['index.js'];
const seen = new Set();
const problems = [];

// require('...') 와 require("...") 의 상대 경로만 본다. 패키지 이름은 건너뛴다.
const REQUIRE = /require\(\s*['"](\.[^'"]+)['"]\s*\)/g;

function resolveTarget(fromFile, spec) {
  const base = path.resolve(path.dirname(fromFile), spec);
  for (const candidate of [base, `${base}.js`, path.join(base, 'index.js')]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return base;
}

function walk(file) {
  if (seen.has(file)) return;
  seen.add(file);
  let source;
  try { source = fs.readFileSync(file, 'utf8'); } catch (_) { return; }
  for (const match of source.matchAll(REQUIRE)) {
    const target = resolveTarget(file, match[1]);
    const inside = path.relative(root, target);
    if (inside.startsWith('..') || path.isAbsolute(inside)) {
      problems.push(`${path.relative(root, file)} → ${match[1]}`);
      continue;
    }
    walk(target);
  }
}

entryPoints.forEach(entry => walk(path.join(root, entry)));

if (problems.length) {
  console.error('배포본에 없는 파일을 부르고 있습니다. functions/ 안으로 복사해서 쓰세요.\n');
  problems.forEach(line => console.error(`  ${line}`));
  console.error('\nfirebase.json 은 functions/ 폴더만 싣습니다. 이대로 배포하면 컨테이너가 뜨지 못합니다.');
  process.exit(1);
}

console.log(`Deploy bundle check passed: ${seen.size} files, all inside functions/.`);
