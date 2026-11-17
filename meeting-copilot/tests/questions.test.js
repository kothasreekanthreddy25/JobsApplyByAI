const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { extractQuestions, loadQuestions } = require('../src/questions');

test('finds questions in bullets, numbered lists and Q: lines', () => {
  const qs = extractQuestions(`# Questions
- Tell me about yourself.
1. Why do you want this job?
2) What is a closure in JavaScript?
Q3: Describe a time you led a team
**What are your strengths?**`);
  assert.deepEqual(qs, [
    'Tell me about yourself.', 'Why do you want this job?', 'What is a closure in JavaScript?',
    'Describe a time you led a team?', 'What are your strengths?',
  ]);
});

test('strips table-row numbering so the interviewer does not read "six" aloud', () => {
  assert.deepEqual(extractQuestions('6\tHow do you protect APIs against abuse?\n12 Why should we hire you?\n2024 was a good year for us?'),
    ['How do you protect APIs against abuse?', 'Why should we hire you?', '2024 was a good year for us?']);
});

test('ignores answer lines, headings and normal sentences', () => {
  const qs = extractQuestions(`Q: What is your biggest weakness?
A: I sometimes over-prepare, so I set time limits.
Our pricing has three tiers: Starter, Team and Enterprise.
## Section title
Answer: this is an answer?`);
  assert.deepEqual(qs, ['What is your biggest weakness?']);
});

test('keeps only the question when the answer is on the same line', () => {
  assert.deepEqual(extractQuestions('Why should we hire you? Because I learn fast and ship reliably.'), ['Why should we hire you?']);
});

test('skips too-short and too-long lines', () => {
  assert.deepEqual(extractQuestions('Why?\n' + 'What '.repeat(80) + '?'), []);
});

test('loadQuestions reads docs folder, de-duplicates, and falls back to prep packs', async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-q-'));
  const docs = path.join(d, 'docs'), prep = path.join(d, 'prep');
  fs.mkdirSync(docs); fs.mkdirSync(prep);
  fs.writeFileSync(path.join(docs, 'a.md'), '- Tell me about yourself.\n- What are your strengths?\n');
  fs.writeFileSync(path.join(docs, 'b.txt'), 'Tell me about yourself!\nHow do you handle conflict?\n');
  fs.writeFileSync(path.join(prep, 'p.json'), JSON.stringify({ items: [{ questions: ['Why this company?'] }] }));
  const got = (await loadQuestions(docs, prep)).map((x) => x.q);
  assert.equal(got.length, 3); // duplicate "Tell me about yourself" collapsed
  assert.ok(got.includes('How do you handle conflict?'));
  // empty docs -> prep fallback
  const empty = path.join(d, 'empty'); fs.mkdirSync(empty);
  assert.deepEqual((await loadQuestions(empty, prep)).map((x) => x.q), ['Why this company?']);
  // nothing anywhere -> empty list, no crash
  assert.deepEqual(await loadQuestions(path.join(d, 'nope'), path.join(d, 'nope2')), []);
  fs.rmSync(d, { recursive: true, force: true });
});
