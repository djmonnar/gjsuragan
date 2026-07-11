'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const test = require('node:test');
const assert = require('node:assert/strict');

const source = fs.readFileSync(path.resolve(__dirname, '../../../assets/js/rendering-formatters.js'), 'utf8');
const helperSource = source.match(/function escHtml\(v\)\{[\s\S]*?\n\}/)?.[0];
assert.ok(helperSource, 'escHtml helper must exist');
const escHtml = vm.runInNewContext(`(${helperSource})`);

test('external strings are rendered as text rather than executable HTML', () => {
  const cases = [
    ['궁중회사 <테스트>', '궁중회사 &lt;테스트&gt;'],
    ['<img src=x onerror=alert(1)>', '&lt;img src=x onerror=alert(1)&gt;'],
    ['101동 "공동현관" 앞', '101동 &quot;공동현관&quot; 앞'],
    ['김&이 고객', '김&amp;이 고객'],
    ["<script>alert('test')</script>", '&lt;script&gt;alert(&#39;test&#39;)&lt;/script&gt;']
  ];
  cases.forEach(([input, expected]) => assert.equal(escHtml(input), expected));
});
