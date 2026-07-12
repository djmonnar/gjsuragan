'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const sourceRoot = path.join(root, 'src', 'index');
const partsRoot = path.join(sourceRoot, 'parts');
const manifestPath = path.join(sourceRoot, 'manifest.json');

const expectedPageIds = [
  'page-dash', 'page-today', 'page-route', 'page-notice', 'page-report',
  'page-settlement', 'page-customers', 'page-export', 'page-import', 'page-manual'
];
const expectedModalIds = ['noticePopupM', 'addM', 'addrM', 'editM', 'pauseM', 'parseM'];
const expectedScriptSources = [
  'https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth-compat.js',
  'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore-compat.js',
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
  'assets/js/auth-core.js?v=20260706-pause2',
  'assets/js/delivery-transaction.js?v=20260710-safety1',
  'assets/js/imweb.js?v=20260712-phone1',
  'assets/js/schedule-report.js?v=20260507-3',
  'assets/js/rendering-formatters.js?v=20260711-helper1',
  'assets/js/rendering.js?v=20260706-pause2',
  'assets/js/order-settlement.js?v=20260712-sales1',
  'assets/js/route-map.js?v=20260626-roundtrip1',
  'assets/js/import-export.js?v=20260625-door-x1',
  'assets/js/logen.js?v=20260625-logen-change1',
  'assets/js/ui.js?v=20260706-manual1',
  'assets/js/notice-memos.js?v=20260709-notice1'
];
const expectedStylesheets = ['assets/css/index.css?v=20260710-cssmod1'];

function fail(message) {
  console.error(`index build: ${message}`);
  process.exit(1);
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function lineCount(buffer) {
  if (!buffer.length) return 0;
  let count = 0;
  for (const byte of buffer) if (byte === 10) count += 1;
  return buffer[buffer.length - 1] === 10 ? count : count + 1;
}

function countMatches(source, pattern) {
  return [...source.matchAll(pattern)].length;
}

function sameValues(actual, expected) {
  return actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}

function firstDifferentByte(expected, actual) {
  const length = Math.min(expected.length, actual.length);
  for (let index = 0; index < length; index += 1) {
    if (expected[index] !== actual[index]) return index;
  }
  return expected.length === actual.length ? -1 : length;
}

function readManifest() {
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    fail(`cannot read manifest: ${error.message}`);
  }

  if (manifest.output !== 'index.html') {
    fail('manifest output must be repository-root index.html');
  }
  if (!Array.isArray(manifest.parts) || !manifest.parts.length) {
    fail('manifest parts must be a non-empty array');
  }
  return manifest;
}

function resolveParts(manifest) {
  const seen = new Set();
  const resolved = manifest.parts.map(part => {
    if (typeof part !== 'string' || !part.trim()) fail('part paths must be non-empty strings');
    if (path.isAbsolute(part)) fail(`absolute part path is not allowed: ${part}`);

    const normalized = part.replace(/\\/g, '/');
    if (normalized.split('/').includes('..')) fail(`part path escapes source root: ${part}`);
    if (!normalized.startsWith('parts/') || !normalized.endsWith('.html')) {
      fail(`part must be an HTML file under parts/: ${part}`);
    }
    if (seen.has(normalized)) fail(`duplicate part path: ${part}`);
    seen.add(normalized);

    const filePath = path.resolve(sourceRoot, normalized);
    const expectedPrefix = `${path.resolve(partsRoot)}${path.sep}`;
    if (!filePath.startsWith(expectedPrefix)) fail(`part path escapes parts directory: ${part}`);
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) fail(`part is missing: ${part}`);

    const content = fs.readFileSync(filePath);
    if (!content.length) fail(`part is empty: ${part}`);
    return { content, filePath, normalized };
  });

  const listed = new Set(resolved.map(item => item.normalized));
  const unlisted = fs.readdirSync(partsRoot, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.html'))
    .map(entry => `parts/${entry.name}`)
    .filter(part => !listed.has(part));
  if (unlisted.length) fail(`HTML parts are not listed in manifest: ${unlisted.join(', ')}`);

  return resolved;
}

function validateGenerated(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    fail('generated index.html must not contain a UTF-8 BOM');
  }
  const source = buffer.toString('utf8');
  if (!Buffer.from(source, 'utf8').equals(buffer)) fail('generated index.html is not valid UTF-8');

  const exactCounts = [
    ['doctype', /<!DOCTYPE html>/g, 1],
    ['html start', /<html\b[^>]*>/g, 1],
    ['html end', /<\/html>/g, 1],
    ['head start', /<head>/g, 1],
    ['head end', /<\/head>/g, 1],
    ['body start', /<body>/g, 1],
    ['body end', /<\/body>/g, 1]
  ];
  for (const [label, pattern, expected] of exactCounts) {
    const actual = countMatches(source, pattern);
    if (actual !== expected) fail(`${label} count is ${actual}; expected ${expected}`);
  }

  for (const id of [...expectedPageIds, ...expectedModalIds]) {
    if (!source.includes(`id="${id}"`)) fail(`required DOM id is missing: ${id}`);
  }

  const ids = [...source.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  if (ids.length !== 235) fail(`DOM id count is ${ids.length}; expected 235`);
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  if (duplicates.length) fail(`duplicate DOM ids: ${[...new Set(duplicates)].join(', ')}`);

  const pageIds = [...source.matchAll(/\bid="(page-[^"]+)"/g)].map(match => match[1]);
  if (!sameValues(pageIds, expectedPageIds)) fail('page id list or order changed');
  const modalIds = [...source.matchAll(/<div\b[^>]*\bclass="[^"]*\bmbg\b[^"]*"[^>]*\bid="([^"]+)"/gi)]
    .map(match => match[1]);
  if (!sameValues(modalIds, expectedModalIds)) fail('modal id list or order changed');

  const inlineEventCount = countMatches(source, /\son[a-z]+\s*=/gi);
  if (inlineEventCount !== 145) fail(`inline event count is ${inlineEventCount}; expected 145`);

  const scriptSources = [...source.matchAll(/<script\b[^>]*\bsrc="([^"]+)"[^>]*>/gi)]
    .map(match => match[1]);
  if (!sameValues(scriptSources, expectedScriptSources)) fail('script source list or order changed');
  for (const src of scriptSources) {
    if (/^(?:https?:)?\/\//i.test(src)) continue;
    const clean = src.split(/[?#]/, 1)[0];
    if (!fs.existsSync(path.resolve(root, clean))) fail(`local script is missing: ${clean}`);
  }

  const stylesheetLinks = [...source.matchAll(/<link\b[^>]*\brel="stylesheet"[^>]*\bhref="([^"]+)"[^>]*>/gi)]
    .map(match => match[1]);
  if (!sameValues(stylesheetLinks, expectedStylesheets)) fail('stylesheet list or order changed');
  for (const href of stylesheetLinks) {
    if (/^(?:https?:)?\/\//i.test(href)) continue;
    const clean = href.split(/[?#]/, 1)[0];
    if (!fs.existsSync(path.resolve(root, clean))) fail(`local stylesheet is missing: ${clean}`);
  }

  const requiredSource = [
    'firebase.initializeApp(_fbCfg);',
    'const DELIVERY_ADMIN_EMAIL =',
    'window.__AUTH = firebase.auth();',
    'window.__DB = firebase.firestore();'
  ];
  for (const value of requiredSource) {
    if (!source.includes(value)) fail(`required initialization is missing: ${value}`);
  }
}

function replaceOutput(outputPath, buffer) {
  const suffix = `${process.pid}-${crypto.randomUUID()}`;
  const temporaryPath = `${outputPath}.${suffix}.tmp`;
  const backupPath = `${outputPath}.${suffix}.bak`;
  fs.writeFileSync(temporaryPath, buffer, { flag: 'wx' });

  if (!fs.existsSync(outputPath)) {
    fs.renameSync(temporaryPath, outputPath);
    return;
  }

  fs.renameSync(outputPath, backupPath);
  try {
    fs.renameSync(temporaryPath, outputPath);
    fs.unlinkSync(backupPath);
  } catch (error) {
    if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
    fs.renameSync(backupPath, outputPath);
    if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
    throw error;
  }
}

const args = new Set(process.argv.slice(2));
for (const arg of args) {
  if (!['--check', '--stdout'].includes(arg)) fail(`unknown option: ${arg}`);
}
if (args.has('--check') && args.has('--stdout')) fail('--check and --stdout cannot be combined');

const manifest = readManifest();
const parts = resolveParts(manifest);
const generated = Buffer.concat(parts.map(part => part.content));
validateGenerated(generated);

if (args.has('--stdout')) {
  process.stdout.write(generated);
  process.exit(0);
}

const outputPath = path.resolve(root, manifest.output);
if (outputPath !== path.join(root, 'index.html')) fail('output path must be repository-root index.html');

const current = fs.existsSync(outputPath) ? fs.readFileSync(outputPath) : Buffer.alloc(0);
const generatedHash = sha256(generated);
const currentHash = sha256(current);

if (args.has('--check')) {
  if (!generated.equals(current)) {
    console.error(`index build check failed at byte ${firstDifferentByte(generated, current)}`);
    console.error(`expected size ${generated.length}, actual size ${current.length}`);
    console.error(`expected SHA-256 ${generatedHash}`);
    console.error(`actual SHA-256 ${currentHash}`);
    process.exit(1);
  }
  console.log(`index build check passed: ${generated.length} bytes, ${lineCount(generated)} lines, SHA-256 ${generatedHash}`);
  process.exit(0);
}

if (!generated.equals(current)) replaceOutput(outputPath, generated);
console.log(`index.html ready: ${generated.length} bytes, ${lineCount(generated)} lines, SHA-256 ${generatedHash}`);
