'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const pages = ['index.html', 'admin.html', 'customer.html', 'map/index.html', 'event-order.html'];
let failed = false;

function isRemoteAsset(ref) {
  return /^(?:https?:)?\/\//i.test(ref) || /^data:/i.test(ref);
}

function cleanAssetRef(ref) {
  return ref.split(/[?#]/, 1)[0];
}

function resolveLocalAsset(ownerPath, ref) {
  const cleanRef = cleanAssetRef(ref);
  return cleanRef.startsWith('/')
    ? path.resolve(root, `.${cleanRef}`)
    : path.resolve(path.dirname(ownerPath), cleanRef);
}

function readTagAttribute(tag, name) {
  const match = tag.match(new RegExp(`\\b${name}=["']([^"']+)["']`, 'i'));
  return match ? match[1] : '';
}

const validatedStylesheets = new Set();

function validateStylesheet(filePath, stack = []) {
  const normalizedPath = path.normalize(filePath);
  if (stack.includes(normalizedPath)) {
    console.error(`stylesheet import cycle: ${[...stack, normalizedPath].map(item => path.relative(root, item)).join(' -> ')}`);
    failed = true;
    return;
  }
  if (validatedStylesheets.has(normalizedPath)) return;
  if (!fs.existsSync(normalizedPath)) {
    console.error(`referenced stylesheet missing: ${path.relative(root, normalizedPath)}`);
    failed = true;
    return;
  }

  const source = fs.readFileSync(normalizedPath, 'utf8');
  if (!source.replace(/\/\*[\s\S]*?\*\//g, '').trim()) {
    console.error(`stylesheet is empty: ${path.relative(root, normalizedPath)}`);
    failed = true;
    return;
  }

  const imports = [...source.matchAll(/@import\s+(?:url\(\s*)?["']([^"']+)["']\s*\)?[^;]*;/gi)]
    .map(match => match[1])
    .filter(ref => !isRemoteAsset(ref));
  const seenImports = new Set();
  for (const ref of imports) {
    const importPath = path.normalize(resolveLocalAsset(normalizedPath, ref));
    if (seenImports.has(importPath)) {
      console.error(`${path.relative(root, normalizedPath)}: duplicate stylesheet import: ${cleanAssetRef(ref)}`);
      failed = true;
      continue;
    }
    seenImports.add(importPath);
    validateStylesheet(importPath, [...stack, normalizedPath]);
  }
  validatedStylesheets.add(normalizedPath);
}

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
  const localStylesheets = [...source.matchAll(/<link\b[^>]*>/gi)]
    .map(match => match[0])
    .filter(tag => readTagAttribute(tag, 'rel').split(/\s+/).includes('stylesheet'))
    .map(tag => readTagAttribute(tag, 'href'))
    .filter(Boolean)
    .filter(href => !isRemoteAsset(href));
  const seenStylesheets = new Set();
  localStylesheets.forEach(href => {
    const stylesheetPath = path.normalize(resolveLocalAsset(filePath, href));
    if (seenStylesheets.has(stylesheetPath)) {
      console.error(`${page}: duplicate stylesheet link: ${cleanAssetRef(href)}`);
      failed = true;
      return;
    }
    seenStylesheets.add(stylesheetPath);
    validateStylesheet(stylesheetPath);
  });
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
