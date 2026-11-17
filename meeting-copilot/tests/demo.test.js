const test = require('node:test');
const assert = require('node:assert');
const { Demo, shuffle } = require('../src/demo');

const QS = ['A one?', 'B two?', 'C three?', 'D four?', 'E five?', 'F six?', 'G seven?'].map((q) => ({ q, source: 'doc.md' }));
const make = (over = {}) => {
  const said = [];
  const d = new Demo({ loadQuestions: async () => QS, gapMs: 0, speak: async (t) => { said.push(t); await new Promise((r) => setTimeout(r, 3)); }, ...over });
  return { d, said };
};
const once = (d, ev) => new Promise((r) => d.once(ev, r));

test('shuffle keeps every item exactly once', () => {
  const s = shuffle([1, 2, 3, 4, 5, 6], Math.random);
  assert.deepEqual([...s].sort(), [1, 2, 3, 4, 5, 6]);
});

test('scheduled -> invited after the delay, and the countdown reports time left', async () => {
  const { d } = make();
  d.schedule({ minutes: 0.01, count: 2, answerSec: 0.02 }); // 0.6 s
  assert.equal(d.snapshot().state, 'scheduled');
  assert.ok(d.snapshot().secsLeft >= 1);
  await once(d, 'ready');
  assert.equal(d.snapshot().state, 'invited');
});

test('does not ask anything until the student admits the interviewer', async () => {
  const { d, said } = make();
  d.schedule({ minutes: 0.001, count: 2, answerSec: 0.01 });
  await once(d, 'ready');
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(said.length, 0);
  assert.equal(await d.admit(), true);
});

test('asks the requested number of DIFFERENT random questions from the list, with greeting and closing', async () => {
  const { d, said } = make();
  const asked = []; d.on('asking', (a) => asked.push(a.q));
  d.schedule({ minutes: 0.001, count: 4, answerSec: 0.01 });
  await once(d, 'ready');
  await d.admit();
  assert.equal(asked.length, 4);
  assert.equal(new Set(asked).size, 4, 'no repeats');
  assert.ok(asked.every((q) => QS.some((x) => x.q === q)), 'only questions from the documents');
  assert.match(said[0], /AI interviewer/);
  assert.match(said[said.length - 1], /last question/);
  assert.deepEqual(said.slice(1, -1), asked, 'each question is spoken exactly as asked, in order');
  assert.equal(d.snapshot().state, 'done');
});

test('asks fewer questions when the document has fewer than requested', async () => {
  const { d } = make({ loadQuestions: async () => QS.slice(0, 2) });
  const asked = []; d.on('asking', (a) => asked.push(a.q));
  d.schedule({ minutes: 0.001, count: 5, answerSec: 0.01 });
  await once(d, 'ready'); await d.admit();
  assert.equal(asked.length, 2);
});

test('different random order on different runs (seeded rng changes the order)', async () => {
  const run = async (seed) => {
    let s = seed; const rng = () => (s = (s * 16807) % 2147483647) / 2147483647;
    const { d } = make({ rng }); const asked = []; d.on('asking', (a) => asked.push(a.q));
    d.schedule({ minutes: 0.001, count: 7, answerSec: 0.005 }); await once(d, 'ready'); await d.admit(); return asked.join('|');
  };
  assert.notEqual(await run(1), await run(2));
});

test('next() skips the wait for the current answer', async () => {
  const { d } = make();
  d.schedule({ minutes: 0.001, count: 2, answerSec: 30 }); // would take 60 s without skipping
  await once(d, 'ready');
  const started = Date.now();
  const run = d.admit();
  d.on('spoken', () => setTimeout(() => d.next(), 5));
  await run;
  assert.ok(Date.now() - started < 3000, 'finished quickly because the student pressed Next');
});

test('end() leaves early and stops asking', async () => {
  const { d } = make();
  const asked = []; d.on('asking', (a) => { asked.push(a.q); });
  d.schedule({ minutes: 0.001, count: 6, answerSec: 30 });
  await once(d, 'ready');
  const run = d.admit();
  await once(d, 'spoken'); d.end();
  await run;
  assert.equal(asked.length, 1);
  assert.equal(d.snapshot().state, 'done');
});

test('cancel() before the start time prevents the invite', async () => {
  const { d } = make(); let ready = false; d.on('ready', () => (ready = true));
  d.schedule({ minutes: 0.005, count: 2, answerSec: 0.01 });
  d.cancel();
  await new Promise((r) => setTimeout(r, 450));
  assert.equal(ready, false); assert.equal(d.snapshot().state, 'idle');
});

test('startNow() invites immediately', async () => {
  const { d } = make(); d.schedule({ minutes: 5 });
  const p = once(d, 'ready'); d.startNow(); await p;
  assert.equal(d.snapshot().state, 'invited');
});

test('no questions in the documents -> clear error, back to idle', async () => {
  const { d } = make({ loadQuestions: async () => [] });
  let err = null; d.on('error', (e) => (err = e));
  d.schedule({ minutes: 0.001 }); await once(d, 'ready');
  assert.equal(await d.admit(), false);
  assert.match(err.message, /No questions/);
  assert.equal(d.snapshot().state, 'idle');
});

test('a failing voice does not stop the interview', async () => {
  const { d } = make({ speak: async () => { throw new Error('tts down'); } });
  const asked = []; d.on('asking', (a) => asked.push(a.q));
  d.schedule({ minutes: 0.001, count: 2, answerSec: 0.01 }); await once(d, 'ready'); await d.admit();
  assert.equal(asked.length, 2);
});

test('prepare hook runs before the interviewer speaks; if it fails the interview does not start', async () => {
  const order = [];
  const ok = make({ prepare: async () => { order.push('prepare'); await new Promise((r) => setTimeout(r, 20)); } });
  ok.d.on('say', () => order.push('say'));
  ok.d.schedule({ minutes: 0.001, count: 1, answerSec: 0.01 }); await once(ok.d, 'ready'); await ok.d.admit();
  assert.equal(order[0], 'prepare'); assert.equal(order[1], 'say');

  const bad = make({ prepare: async () => false });
  bad.d.schedule({ minutes: 0.001, count: 1 }); await once(bad.d, 'ready');
  assert.equal(await bad.d.admit(), false);
  assert.equal(bad.said.length, 0); assert.equal(bad.d.snapshot().state, 'idle');
});

test('admit() is ignored unless the interviewer is waiting', async () => {
  const { d } = make();
  assert.equal(await d.admit(), false);
});
