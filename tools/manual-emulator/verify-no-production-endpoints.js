'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const previewRoot = path.join(root, '.tmp', 'manual-preview');
const functionsRoot = path.join(root, '.tmp', 'manual-functions');
const projectId = 'demo-gjsuragan-safety';
const forbidden = [
  'gjsuragan-60505',
  'asia-northeast3-gjsuragan-60505.cloudfunctions.net',
  'https://firestore.googleapis.com',
  'https://identitytoolkit.googleapis.com',
  'https://securetoken.googleapis.com',
  'https://firebasestorage.googleapis.com',
  'sun1562@naver.com',
  'AIzaSyCWXHJfMLW2Cf7pjI2u6X5QVKeGW6oC_3A'
];

function walk(directory) {
  if (!fs.existsSync(directory)) throw new Error(`Generated directory is missing: ${directory}`);
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const absolute = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(absolute) : [absolute];
  });
}

function scan(directory) {
  const failures = [];
  for (const file of walk(directory)) {
    if (path.basename(file) === 'manual-safety-runtime.js') continue;
    if (!['.html', '.js', '.json', '.css', '.md'].includes(path.extname(file).toLowerCase())) continue;
    const text = fs.readFileSync(file, 'utf8');
    for (const token of forbidden) {
      if (text.includes(token)) failures.push(`${path.relative(root, file)} contains ${token}`);
    }
  }
  return failures;
}

if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  throw new Error('GOOGLE_APPLICATION_CREDENTIALS is set. Refusing manual Emulator validation.');
}
if (process.env.GCLOUD_PROJECT && process.env.GCLOUD_PROJECT !== projectId) {
  throw new Error(`Unsafe GCLOUD_PROJECT: ${process.env.GCLOUD_PROJECT}`);
}
if (process.env.GOOGLE_CLOUD_PROJECT && process.env.GOOGLE_CLOUD_PROJECT !== projectId) {
  throw new Error(`Unsafe GOOGLE_CLOUD_PROJECT: ${process.env.GOOGLE_CLOUD_PROJECT}`);
}

const failures = [...scan(previewRoot), ...scan(functionsRoot)];
if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}

const requiredPreview = ['index.html', 'admin.html', 'customer.html', 'event-order.html', 'map/index.html'];
for (const file of requiredPreview) {
  const text = fs.readFileSync(path.join(previewRoot, file), 'utf8');
  if (!text.includes('manual-safety-runtime.js')) throw new Error(`${file} is missing the safety runtime.`);
  if (!text.includes(projectId)) throw new Error(`${file} is missing the demo project ID.`);
}

console.log('Static safety verification passed.');
console.log(`Firebase project: ${projectId}`);
console.log('Generated production endpoint references: 0');
