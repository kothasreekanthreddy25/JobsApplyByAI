// Run: npm test
const test = require('node:test');
const assert = require('node:assert');
const { parsePairs } = require('../src/docQA');

test('numbered Q&A guide: each question gets the paragraphs under it as its answer', () => {
  const t = '1.1  Explain closures. Where are they useful?\n\nA closure remembers its scope; it keeps variables alive. Used in debounce.\n\n1.2  What is hoisting?\n\nDeclarations move to the top of their scope before code runs.\n';
  const p = parsePairs(t);
  assert.equal(p.length, 2);
  assert.equal(p[0].questions[0], 'Explain closures. Where are they useful?');
  assert.ok(p[0].questions.includes('Explain closures.'), 'first sentence is added as a shorter phrasing');
  assert.match(p[0].headline, /closure remembers its scope; it keeps variables alive\./);
  assert.match(p[1].detail, /top of their scope/);
});

test('Q:/A: style and plain "?" lines work, code lines are not read out', () => {
  const p = parsePairs('Q: What is a closure?\nA: A function that remembers its scope. It keeps variables alive.\nconst next = makeCounter();\nWhy use const?\nIt prevents reassignment of the binding.');
  assert.equal(p.length, 2);
  assert.equal(p[0].headline, 'A function that remembers its scope.');
  assert.ok(!p[0].detail.includes('makeCounter'));
  assert.equal(p[1].questions[0], 'Why use const?');
});

test('a heading with nothing under it, and ordinary prose, produce no pairs', () => {
  assert.equal(parsePairs('1.1  What is a closure?\n\n1.2  What is hoisting?\n\nDeclarations move to the top of their scope.').length, 1);
  assert.equal(parsePairs('Just some notes about the product launch and nothing else here.').length, 0);
});
