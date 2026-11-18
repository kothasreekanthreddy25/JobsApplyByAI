// Run: npm test
const test = require('node:test');
const assert = require('node:assert');
const { analyzeSpeech, overallSpeech, buildReview, toMarkdown, paceNote, gradeBand, extractJson } = require('../src/review');

const W = (word, start, end, confidence = 0.99) => ({ word, punctuated_word: word, start, end, confidence });

test('analyzeSpeech: pace, fillers, pauses and low-confidence words', () => {
  const words = [W('Um', 0, 0.4), W('a', 0.5, 0.6), W('closure', 0.7, 1.3, 0.62), W('remembers', 1.4, 2.0), W('scope', 4.5, 5.0, 0.7), W('uh', 5.1, 5.3)];
  const s = analyzeSpeech(words);
  assert.equal(s.words, 4, 'fillers are not counted as words');
  assert.equal(s.fillerCount, 2); assert.deepEqual(s.fillers, { um: 1, uh: 1 });
  assert.equal(s.longPauses, 1, 'the 2.5 s gap before "scope"');
  assert.deepEqual(s.lowWords.map((w) => w.word), ['closure', 'scope'], 'lowest confidence first');
  assert.ok(s.clarity > 0 && s.clarity < 10);
  assert.equal(s.wpm, Math.round(4 / 5.3 * 60));
});

test('analyzeSpeech: empty input is safe, and perfect confidence scores 10', () => {
  assert.equal(analyzeSpeech([]).words, 0);
  assert.equal(analyzeSpeech(null).wpm, 0);
  assert.equal(analyzeSpeech([W('hello', 0, 1, 1), W('world', 1, 2, 1)]).clarity, 10);
  assert.equal(analyzeSpeech([W('hello', 0, 1, 0.7)]).clarity, 0);
});

test('paceNote and gradeBand', () => {
  assert.match(paceNote(90), /slow/); assert.match(paceNote(190), /fast/); assert.match(paceNote(140), /comfortable/); assert.match(paceNote(0), /No speech/);
  assert.equal(gradeBand(90), 'Excellent'); assert.equal(gradeBand(72), 'Good'); assert.equal(gradeBand(55), 'Fair'); assert.equal(gradeBand(10), 'Needs work');
});

test('extractJson tolerates text around the JSON', () => {
  assert.deepEqual(extractJson('Here you go:\n{"a":1}\nthanks'), { a: 1 });
  assert.throws(() => extractJson('no json'));
});

const fakeClient = (answers) => ({
  messages: {
    create: async (req) => {
      const sys = req.system || '';
      if (/mock interview/.test(sys)) return { content: [{ type: 'text', text: 'Sure:\n' + JSON.stringify({ answers, summary: 'Solid effort.', topTips: ['Add examples'] }) }] };
      return { content: [{ type: 'text', text: '- Stress the first syllable of "closure".' }] };
    },
  },
});

test('buildReview: marks heard answers, gives 0 to unheard ones, totals and writes markdown', async () => {
  const turns = [
    { q: 'What is a closure?', reference: 'A function that remembers its scope.', words: [W('A', 0, 0.2), W('closure', 0.3, 0.9, 0.7), W('remembers', 1, 1.6)], transcript: 'A closure remembers' },
    { q: 'What is hoisting?', reference: '', words: [], transcript: '' },
  ];
  const rv = await buildReview({ turns, client: fakeClient([{ n: 1, score: 7, verdict: 'Correct but short.', strengths: ['Right idea'], improve: ['Give an example'], missing: ['lexical scope'] }]), model: 'x', now: new Date('2026-01-02T03:04:00Z') });
  assert.equal(rv.total, 7); assert.equal(rv.max, 20); assert.equal(rv.pct, 35); assert.equal(rv.band, 'Needs work');
  assert.equal(rv.answers[0].score, 7); assert.equal(rv.answers[0].scored, true);
  assert.equal(rv.answers[1].score, 0); assert.match(rv.answers[1].verdict, /No answer was heard/);
  assert.equal(rv.pronunciation.lowWords[0].word, 'closure');
  assert.match(rv.pronunciation.advice, /closure/);
  const md = toMarkdown(rv);
  assert.match(md, /Marks: 7 \/ 20/); assert.match(md, /Q1 \(7\/10\)/); assert.match(md, /Words to practise/); assert.match(md, /not a phoneme-level/);
});

test('buildReview: nothing heard means no AI call, zero marks and a microphone hint', async () => {
  let calls = 0;
  const client = { messages: { create: async () => { calls++; return { content: [] }; } } };
  const rv = await buildReview({ turns: [{ q: 'Q?', words: [], transcript: '' }], client, model: 'x' });
  assert.equal(calls, 0); assert.equal(rv.total, 0); assert.match(rv.summary, /microphone/);
});

test('buildReview: if the AI fails, speech measurements are still reported', async () => {
  const client = { messages: { create: async () => { throw new Error('boom'); } } };
  const rv = await buildReview({ turns: [{ q: 'Q?', words: [W('hello', 0, 1), W('there', 1, 2)], transcript: 'hello there' }], client, model: 'x' });
  assert.equal(rv.gradeError, 'boom'); assert.equal(rv.answers[0].scored, false); assert.equal(rv.pronunciation.words, 2);
});

test('overallSpeech: pace is measured over talking time, not the gaps between answers', () => {
  const a = { words: [W('one', 0, 1), W('two', 1, 2)] }, b = { words: [W('three', 100, 101), W('four', 101, 102)] };
  assert.equal(overallSpeech([a, b]).wpm, Math.round(4 / 4 * 60));
});
