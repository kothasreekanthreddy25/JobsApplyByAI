// Demo mode: a scheduled mock interview. The app plays the "AI interviewer":
//   idle -> scheduled (countdown) -> invited (waiting to be admitted) -> live (asks questions) -> done
// Pure logic: speaking and loading questions are injected, so it is testable without audio or an app window.
const EventEmitter = require('events');

const shuffle = (arr, rnd) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};

class Demo extends EventEmitter {
  /** @param loadQuestions async () => [{q, source}]   @param speak async (text) => void (resolves when finished speaking) */
  constructor({ loadQuestions, speak, prepare, rng = Math.random, gapMs = 1800 }) {
    super();
    // prepare(): async hook run after the student admits the interviewer and BEFORE it speaks (e.g. start listening).
    // gapMs: silence after the greeting so speech recognition hears the first question as its own sentence.
    Object.assign(this, { loadQuestions, speak, prepare, rng, gapMs });
    this.state = 'idle';
    this.cfg = { minutes: 5, count: 5, answerSec: 40 };
    this.startAt = 0; this.index = 0; this.total = 0; this.question = ''; this.available = 0;
    this._tick = null; this._start = null; this._skip = null; this._wait = null;
  }

  snapshot() {
    const secsLeft = this.state === 'scheduled' ? Math.max(0, Math.ceil((this.startAt - Date.now()) / 1000)) : 0;
    return { state: this.state, secsLeft, index: this.index, total: this.total, question: this.question, available: this.available, cfg: this.cfg };
  }
  _update() { this.emit('update', this.snapshot()); }
  _clearTimers() { clearInterval(this._tick); clearTimeout(this._start); clearTimeout(this._wait); this._tick = this._start = this._wait = null; }

  schedule({ minutes = 5, count = 5, answerSec = 40 } = {}) {
    this.cancel();
    this.cfg = { minutes, count, answerSec };
    this.startAt = Date.now() + minutes * 60000;
    this.state = 'scheduled';
    this._tick = setInterval(() => this._update(), 1000);
    this._start = setTimeout(() => this._invite(), minutes * 60000);
    this._update();
  }

  startNow() { if (this.state === 'idle' || this.state === 'done') this.schedule({ ...this.cfg, minutes: 0 }); else if (this.state === 'scheduled') this._invite(); }

  _invite() {
    this._clearTimers();
    this.state = 'invited'; this.index = 0; this.total = 0; this.question = '';
    this.emit('ready'); this._update();
  }

  /** The student lets the AI interviewer into the room: it greets, asks questions one by one, then says goodbye. */
  async admit() {
    if (this.state !== 'invited') return false;
    this.state = 'live'; this.emit('joined'); this._update();
    try {
      if (this.prepare && (await this.prepare()) === false) { this.state = 'idle'; this._update(); return false; }
      if (this.state !== 'live') return false; // ended while preparing
      const all = await this.loadQuestions();
      this.available = all.length;
      if (!all.length) { this.state = 'idle'; this.emit('error', new Error('No questions found in your documents folder.')); this._update(); return false; }
      const picked = shuffle(all, this.rng).slice(0, Math.max(1, this.cfg.count));
      this.total = picked.length;
      await this._say(`Hello, and thanks for joining. I'm your AI interviewer. I'll ask you ${picked.length} question${picked.length > 1 ? 's' : ''}. Take your time with each one.`);
      if (this.gapMs) await new Promise((r) => setTimeout(r, this.gapMs));
      for (let i = 0; i < picked.length && this.state === 'live'; i++) {
        this.index = i + 1; this.question = picked[i].q;
        this.emit('asking', { index: this.index, total: this.total, q: this.question, source: picked[i].source }); this._update();
        await this._say(this.question);
        if (this.state !== 'live') break;
        this.emit('spoken', { index: this.index, q: this.question });
        await this._waitAnswer();
      }
      if (this.state === 'live') await this._say('That was the last question. Thank you, and good luck!');
    } catch (e) { this.emit('error', e); }
    const asked = this.index;
    this._clearTimers();
    this.state = 'done'; this.question = ''; this.emit('done', { asked }); this._update();
    return true;
  }

  async _say(text) { this.emit('say', text); try { await this.speak(text); } catch { /* voice failure must not stop the interview */ } }

  _waitAnswer() {
    return new Promise((resolve) => {
      this._skip = resolve;
      this._wait = setTimeout(resolve, this.cfg.answerSec * 1000);
    }).finally(() => { clearTimeout(this._wait); this._wait = null; this._skip = null; });
  }

  next() { if (this.state === 'live') this._skip?.(); }          // student is done with this question
  end() { if (this.state === 'live') { this.state = 'done'; this._skip?.(); } else this.cancel(); } // leave early
  cancel() { this._clearTimers(); this.state = 'idle'; this.index = this.total = 0; this.question = ''; this._skip?.(); this._update(); }
}

module.exports = { Demo, shuffle };
