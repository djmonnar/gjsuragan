const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.resolve(__dirname, '..');
const architecturePath = path.join(root, 'docs', 'index-js-architecture.json');
const indexPath = path.join(root, 'index.html');

function fail(message) {
  console.error(`index JS architecture check failed: ${message}`);
  process.exitCode = 1;
}

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

function scriptSources(html) {
  return [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)]
    .map(match => match[1].split('?')[0])
    .filter(src => src.startsWith('assets/js/'));
}

function functionNames(source) {
  return [...source.matchAll(/(?:^|\n)\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g)]
    .map(match => match[1]);
}

function asyncFunctionCount(source) {
  return [...source.matchAll(/(?:^|\n)\s*async\s+function\s+[A-Za-z_$][\w$]*\s*\(/g)].length;
}

function countLines(source) {
  return source.length ? source.split(/\r?\n/).length - (source.endsWith('\n') ? 1 : 0) : 0;
}

function normalizedBytes(source) {
  return Buffer.byteLength(source.replace(/\r\n/g, '\n'), 'utf8');
}

function functionSource(source, name) {
  const escaped = name.replace(/[$]/g, '\\$&');
  return source.match(new RegExp(`function ${escaped}\\([^)]*\\)\\{[\\s\\S]*?\\n\\}`))?.[0] || '';
}

function normalizedFunctionHash(source) {
  return crypto.createHash('sha256').update(source.replace(/\s+/g, '')).digest('hex');
}

function inlineHandlerCalls(html) {
  const calls = new Set();
  for (const attribute of html.matchAll(/\bon(?:click|change|keydown|drop|dragover|dragleave|input|submit)=["']([^"']*)["']/gi)) {
    for (const call of attribute[1].matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)) calls.add(call[1]);
  }
  return calls;
}

if (!fs.existsSync(architecturePath)) {
  fail('missing docs/index-js-architecture.json');
  process.exit();
}

const architecture = JSON.parse(read(architecturePath));
const html = read(indexPath);
const actualOrder = scriptSources(html);

if (JSON.stringify(actualOrder) !== JSON.stringify(architecture.scriptLoadOrder)) {
  fail(`script load order changed\nexpected: ${architecture.scriptLoadOrder.join(' -> ')}\nactual:   ${actualOrder.join(' -> ')}`);
}

const declaredBy = new Map();
const totals = {bytes:0, lines:0, functionDeclarations:0, asyncFunctions:0};
for (const entry of architecture.files) {
  const absolute = path.join(root, entry.path);
  if (!fs.existsSync(absolute)) {
    fail(`missing audited file ${entry.path}`);
    continue;
  }
  const source = read(absolute);
  if (!source.trim()) fail(`audited file is empty: ${entry.path}`);

  const names = functionNames(source);
  const uniqueNames = [...new Set(names)];
  for (const name of uniqueNames) {
    if (!declaredBy.has(name)) declaredBy.set(name, []);
    declaredBy.get(name).push(entry.path);
  }

  const metrics = {
    bytes: normalizedBytes(source),
    lines: countLines(source),
    functionDeclarations: names.length,
    asyncFunctions: asyncFunctionCount(source),
  };
  for (const key of Object.keys(metrics)) {
    totals[key] += metrics[key];
    if (metrics[key] !== entry.metrics[key]) {
      fail(`${entry.path} ${key} drifted: documented ${entry.metrics[key]}, actual ${metrics[key]}`);
    }
  }

  for (const name of entry.requiredDefinitions || []) {
    if (!uniqueNames.includes(name) && !new RegExp(`(?:window|root)\\.${name}\\s*=`).test(source)) {
      fail(`${entry.path} no longer defines required global ${name}`);
    }
  }

  for (const collection of entry.firestoreCollections || []) {
    const literal = `collection('${collection}')`;
    const literalDouble = `collection("${collection}")`;
    const viaNoticeConstant = collection === 'deliveryNoticeMemos'
      && /const\s+COLLECTION\s*=\s*['"]deliveryNoticeMemos['"]/.test(source)
      && /collection\(COLLECTION\)/.test(source);
    if (!source.includes(literal) && !source.includes(literalDouble) && !viaNoticeConstant) {
      fail(`${entry.path} no longer references documented collection ${collection}`);
    }
  }
}

if (totals.bytes !== architecture.summary.normalizedBytes) fail('normalized byte total drifted');
if (totals.lines !== architecture.summary.lines) fail('line total drifted');
if (totals.functionDeclarations !== architecture.summary.functionDeclarations) fail('function declaration total drifted');
if (totals.asyncFunctions !== architecture.summary.asyncFunctions) fail('async function total drifted');

const formatterPath = path.join(root, 'assets/js/rendering-formatters.js');
const renderingPath = path.join(root, 'assets/js/rendering.js');
const formatterSource = read(formatterPath);
const renderingSource = read(renderingPath);
const formatterIndex = actualOrder.indexOf('assets/js/rendering-formatters.js');
const renderingIndex = actualOrder.indexOf('assets/js/rendering.js');
if (formatterIndex < 0 || formatterIndex + 1 !== renderingIndex) {
  fail('rendering-formatters.js must load immediately before rendering.js');
}

const forbiddenFormatterPatterns = [
  [/\bdocument\b/, 'DOM document'],
  [/\bwindow\b/, 'window'],
  [/\b(?:localStorage|sessionStorage)\b/, 'browser storage'],
  [/\b(?:firebase|Firestore|__DB)\b/, 'Firebase'],
  [/\.collection\s*\(/, 'Firestore collection'],
  [/\b(?:setTimeout|setInterval|clearTimeout|clearInterval)\s*\(/, 'timer'],
  [/\baddEventListener\s*\(/, 'event listener'],
];
for (const [pattern, label] of forbiddenFormatterPatterns) {
  if (pattern.test(formatterSource)) fail(`rendering formatter gained forbidden ${label} access`);
}

for (const formatter of architecture.extractedFormatterFunctions || []) {
  const extracted = functionSource(formatterSource, formatter.name);
  if (!extracted) fail(`missing extracted formatter ${formatter.name}`);
  if (functionSource(renderingSource, formatter.name)) fail(`formatter remains duplicated in rendering.js: ${formatter.name}`);
  if (extracted && normalizedFunctionHash(extracted) !== formatter.normalizedBodySha256) {
    fail(`formatter body changed: ${formatter.name}`);
  }
  const owners = declaredBy.get(formatter.name) || [];
  if (owners.length !== 1 || owners[0] !== 'assets/js/rendering-formatters.js') {
    fail(`formatter ownership changed: ${formatter.name}`);
  }
}

for (const relation of architecture.overwriteRelationships) {
  const source = read(path.join(root, relation.file));
  if (!source.includes(relation.requiredSnippet)) {
    fail(`overwrite relationship changed: ${relation.target} in ${relation.file}`);
  }
}

const inlineCalls = inlineHandlerCalls(html);
for (const name of architecture.requiredInlineGlobals) {
  if (!inlineCalls.has(name)) fail(`documented inline global is no longer called by HTML: ${name}`);
  if (!declaredBy.has(name) && !architecture.explicitWindowExports.includes(name)) {
    fail(`inline global has no audited owner: ${name}`);
  }
}

if (!process.exitCode) {
  console.log(
    `Index JS architecture check passed: ${architecture.files.length} files, `
    + `${architecture.summary.functionDeclarations} function declarations, `
    + `${architecture.overwriteRelationships.length} protected overwrite relationships.`
  );
}
