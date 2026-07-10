'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const tmpRoot = path.join(root, '.tmp');
const previewRoot = path.join(tmpRoot, 'manual-preview');
const functionsRoot = path.join(tmpRoot, 'manual-functions');
const runtimeSource = path.join(__dirname, 'manual-safety-runtime.js');
const demoProject = 'demo-gjsuragan-safety';
const localFunctionsBase = `http://127.0.0.1:5001/${demoProject}/asia-northeast3/api`;

function assertInside(parent, target) {
  const relative = path.relative(path.resolve(parent), path.resolve(target));
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Unsafe generated path: ${target}`);
  }
}

function recreate(target) {
  assertInside(tmpRoot, target);
  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(target, { recursive: true });
}

function copyEntry(sourceRelative, targetRelative = sourceRelative) {
  const source = path.join(root, sourceRelative);
  const target = path.join(previewRoot, targetRelative);
  if (!fs.existsSync(source)) throw new Error(`Missing preview source: ${sourceRelative}`);
  fs.cpSync(source, target, { recursive: true });
}

function walkFiles(directory) {
  const out = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(absolute));
    else out.push(absolute);
  }
  return out;
}

function replaceAll(text, from, to) {
  return text.split(from).join(to);
}

function injectRuntime(html, relativeFile) {
  const marker = '<script src="/manual-safety-runtime.js"></script>';
  if (html.includes(marker)) return html;
  const patterns = [
    /<script>\s*(?=const _fbCfg\s*=)/,
    /<script>\s*(?=const firebaseConfig\s*=)/
  ];
  for (const pattern of patterns) {
    if (pattern.test(html)) return html.replace(pattern, `${marker}\n<script>\n`);
  }
  throw new Error(`Firebase initialization block not found in ${relativeFile}`);
}

function patchPreviewText(file) {
  const relative = path.relative(previewRoot, file).replaceAll('\\', '/');
  const extension = path.extname(file).toLowerCase();
  if (!['.html', '.js', '.json', '.webmanifest', '.css'].includes(extension)) return;
  let text = fs.readFileSync(file, 'utf8');
  text = replaceAll(text, 'gjsuragan-60505', demoProject);
  text = replaceAll(text, 'AIzaSyCWXHJfMLW2Cf7pjI2u6X5QVKeGW6oC_3A', 'demo-manual-safety-key');
  text = replaceAll(text, '1009198450175', '000000000000');
  text = replaceAll(text, '1:000000000000:web:4a55da7c2092dba42613ca', '1:000000000000:web:manualsafety');
  text = replaceAll(text, 'https://asia-northeast3-demo-gjsuragan-safety.cloudfunctions.net/api', localFunctionsBase);
  text = replaceAll(text, 'https://djmonnar.github.io/gjsuragan', 'http://127.0.0.1:4173');
  text = replaceAll(text, 'sun1562@naver.com', 'staff@example.invalid');
  if (relative === 'index.html' || relative === 'map/index.html') {
    text = replaceAll(text, 'admin@example.invalid', 'staff@example.invalid');
  } else if (relative === 'admin.html') {
    text = replaceAll(text, 'staff@example.invalid', 'admin@example.invalid');
  }
  if (extension === '.html' && ['index.html', 'admin.html', 'customer.html', 'event-order.html', 'map/index.html'].includes(relative)) {
    text = injectRuntime(text, relative);
  }
  fs.writeFileSync(file, text, 'utf8');
}

function preparePreview() {
  recreate(previewRoot);
  [
    'index.html',
    'admin.html',
    'customer.html',
    'event-order.html',
    'customer-settlement.html',
    'manual.html',
    'manifest.json',
    'admin-manifest.json',
    'assets',
    'icons',
    'map'
  ].forEach(entry => copyEntry(entry));
  fs.copyFileSync(runtimeSource, path.join(previewRoot, 'manual-safety-runtime.js'));
  fs.writeFileSync(path.join(previewRoot, 'sw.js'), "self.addEventListener('install',()=>self.skipWaiting());self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));\n", 'utf8');
  fs.writeFileSync(path.join(previewRoot, 'firebase-messaging-sw.js'), "// Disabled in MANUAL SAFETY PREVIEW.\n", 'utf8');
  walkFiles(previewRoot).forEach(patchPreviewText);
}

function prepareFunctions() {
  recreate(functionsRoot);
  for (const name of ['index.js', 'kakaoAuth.js', 'logenClient.js', 'logenMapper.js', 'mealPlanParser.js', 'package.json', 'package-lock.json']) {
    fs.copyFileSync(path.join(root, 'functions', name), path.join(functionsRoot, name));
  }
  for (const file of walkFiles(functionsRoot)) {
    if (!['.js', '.json'].includes(path.extname(file).toLowerCase())) continue;
    let text = fs.readFileSync(file, 'utf8');
    text = replaceAll(text, 'gjsuragan-60505', demoProject);
    text = replaceAll(text, 'sun1562@naver.com', 'admin@example.invalid');
    text = replaceAll(text, 'https://djmonnar.github.io/gjsuragan', 'http://127.0.0.1:4173');
    if (path.basename(file) === 'index.js') {
      text = text.replace(
        "const admin = require('firebase-admin');",
        "const admin = require('firebase-admin');\nconst { FieldValue: ManualFieldValue, Timestamp: ManualTimestamp, FieldPath: ManualFieldPath } = require('firebase-admin/firestore');"
      );
      text = replaceAll(text, 'admin.firestore.FieldValue', 'ManualFieldValue');
      text = replaceAll(text, 'admin.firestore.Timestamp', 'ManualTimestamp');
      text = replaceAll(text, 'admin.firestore.FieldPath', 'ManualFieldPath');
      text = text.replace(
        /const KAKAO_SESSION_TTL_MS\s*=\s*6\s*\*\s*60\s*\*\s*60\s*\*\s*1000\s*;/,
        'const KAKAO_SESSION_TTL_MS = 10 * 1000; // MANUAL SAFETY PREVIEW only'
      );
    }
    fs.writeFileSync(file, text, 'utf8');
  }
}

function prepareRulesAndConfig() {
  const generatedRoot = path.join(tmpRoot, 'manual-emulator');
  fs.mkdirSync(generatedRoot, { recursive: true });
  let rules = fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8');
  rules = replaceAll(rules, 'sun1562@naver.com', 'admin@example.invalid');
  fs.writeFileSync(path.join(generatedRoot, 'firestore.rules'), rules, 'utf8');
  const config = {
    firestore: {
      rules: 'firestore.rules',
      indexes: '../../firestore.indexes.json'
    },
    functions: { source: '../manual-functions' },
    emulators: {
      auth: { host: '127.0.0.1', port: 9099 },
      firestore: { host: '127.0.0.1', port: 8080 },
      functions: { host: '127.0.0.1', port: 5001 },
      ui: { enabled: true, host: '127.0.0.1', port: 4000 },
      singleProjectMode: true
    }
  };
  fs.writeFileSync(path.join(generatedRoot, 'firebase.json'), `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

preparePreview();
prepareFunctions();
prepareRulesAndConfig();
console.log(`Prepared emulator-only preview at ${path.relative(root, previewRoot)}`);
console.log(`Prepared emulator-only Functions copy at ${path.relative(root, functionsRoot)}`);
