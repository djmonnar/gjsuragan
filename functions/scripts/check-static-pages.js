'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const pages = ['index.html', 'admin.html', 'customer.html', 'map/index.html', 'event-order.html'];
let failed = false;

for (const page of pages) {
  const filePath = path.join(root, page);
  if (!fs.existsSync(filePath)) {
    console.error(`${page}: file missing`);
    failed = true;
    continue;
  }
  const source = fs.readFileSync(filePath, 'utf8');
  if (!/<html[\s>]/i.test(source) || !/<body[\s>]/i.test(source)) {
    console.error(`${page}: basic page structure missing`);
    failed = true;
  }
  const scripts = [...source.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/gi)].map(match => match[1]);
  scripts.forEach((script, index) => {
    try {
      new Function(script);
    } catch (error) {
      console.error(`${page}: inline script ${index + 1}: ${error.message}`);
      failed = true;
    }
  });

  const localScripts = [...source.matchAll(/<script[^>]*\ssrc=["']([^"']+)["'][^>]*>/gi)]
    .map(match => match[1])
    .filter(src => !/^(?:https?:)?\/\//i.test(src));
  localScripts.forEach(src => {
    const cleanSrc = src.split(/[?#]/, 1)[0];
    const scriptPath = path.resolve(path.dirname(filePath), cleanSrc);
    if (!fs.existsSync(scriptPath)) {
      console.error(`${page}: referenced script missing: ${cleanSrc}`);
      failed = true;
      return;
    }
    try {
      new Function(fs.readFileSync(scriptPath, 'utf8'));
    } catch (error) {
      console.error(`${page}: ${cleanSrc}: ${error.message}`);
      failed = true;
    }
  });
}

if (failed) process.exit(1);
console.log('Static page smoke syntax checks passed.');
