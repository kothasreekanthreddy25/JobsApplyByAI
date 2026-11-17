// Question detection (instant heuristic, no LLM round trip) + streaming answers.
// The first tokens stream to the overlay immediately, so the user starts reading in ~1s.
const Anthropic = require('@anthropic-ai/sdk');
const { formatAnswer } = require('./prepBank');

const WH = /^(so,? |and |okay,? |ok,? )?(what|why|how|when|where|who|which|whose|can|could|would|will|should|do|does|did|is|are|was|were|have|has|tell me|walk me|explain|describe|give me)\b/i;
const ASK = /\b(can you|could you|would you|do you|did you|have you|are you|what's|what is|how (do|did|would|many|much)|tell us|walk us|any (thoughts|idea))\b/i;

const MIN_DOC_SCORE = 0.3; // below this the doc match is treated as "not found"

function isQuestion(t) {
  const s = t.trim();
  if (s.split(/\s+/).length < 3) return false;
  return s.endsWith('?') || WH.test(s) || ASK.test(s);
}

class Answerer {
  constructor({ apiKey, model, docs, prep, openaiKey, openaiModel }) {
    this.prep = prep;
    this.openaiKey = openaiKey;
    this.openaiModel = openaiModel || 'gpt-4o-mini';
    this.client = new Anthropic({ apiKey });
    this.model = model;
    this.docs = docs;
    this.history = []; // recent transcript lines for context
    this.ctrl = null;
    this.meeting = null;
  }
  warmup() {
    this.client.messages.create({ model: this.model, max_tokens: 1, thinking: { type: 'disabled' }, messages: [{ role: 'user', content: 'hi' }] }).catch(() => {});
  }
  async openaiStream(system, user, signal, onDelta) {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST', signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.openaiKey}` },
      body: JSON.stringify({
        model: this.openaiModel, stream: true, max_tokens: 220, temperature: 0.3,
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      }),
    });
    if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 120)}`);
    const dec = new TextDecoder();
    let buf = '';
    for await (const chunk of res.body) {
      buf += dec.decode(chunk, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const l of lines) {
        if (!l.startsWith('data: ') || l.includes('[DONE]')) continue;
        const d = JSON.parse(l.slice(6)).choices?.[0]?.delta?.content;
        if (d) onDelta?.(d);
      }
    }
  }
  setMeeting(m) { this.meeting = m; this.history = []; }
  note(text) { this.history.push(text); if (this.history.length > 12) this.history.shift(); }

  async answer(question, { onStart, onMeta, onDelta, onDone }) {
    this.ctrl?.abort(); // newest question wins
    const ctrl = (this.ctrl = new AbortController());
    const t0 = Date.now();

    // 1) Prepared answers (resume + job description pack): matched by meaning, locally, no network.
    let pm = null;
    try { pm = await this.prep?.match(question); } catch (e) { console.error('prep match failed:', e.message); }
    if (ctrl.signal.aborted) return;
    if (pm?.level === 'high') {
      onStart?.(question);
      onMeta?.(`prepared · ${Math.round(pm.score * 100)}% match · ${Date.now() - t0}ms`);
      onDelta?.(formatAnswer(pm.item));
      return onDone?.();
    }

    const hits = this.docs.search(question + ' ' + this.history.slice(-2).join(' '), 4).filter((h) => h.score >= MIN_DOC_SCORE);
    const notes = hits.map((h, i) => `[${i + 1}] (${h.source}) ${h.text}`);
    // Medium match: not sure enough to show as-is, but the AI should still use it as the candidate's own notes.
    if (pm?.level === 'mid') {
      const prepNotes = pm.alts.filter((a) => a.score >= 0.4).map((a, i) =>
        `[P${i + 1}] (candidate's prepared answer to "${a.matchedQuestion}") ${a.item.headline} ${(a.item.points || []).join('; ')}. ${a.item.detail || ''}`);
      notes.unshift(...prepNotes);
    }
    const context = notes.join('\n\n') || '(no matching documents)';
    const useOpenAI = !notes.length && !!this.openaiKey; // nothing in docs/prep -> OpenAI
    const system =
      `You are a private real-time assistant for the user in a meeting "${this.meeting?.title || ''}". ` +
      `Someone else just asked the user a question (it may be a general/technical concept like "what is a closure?"). Answer immediately and directly, no preamble. Format for glanceable reading, plain text, no markdown: line 1 = the direct answer in ONE sentence of at most 14 words; ` +
      `then at most 3 lines, each a short bullet starting with "- " of at most 9 words. Max ~45 words total. Prefer facts from the DOCUMENTS and cite as [n]. ` +
      `Entries marked [P1],[P2].. are the user's own prepared answers to SIMILAR questions: reuse them (first person, their real facts) ONLY if they truly answer the question asked; if the question is about something different (e.g. a definition), ignore them and answer the question itself. ` +
      `If the documents don't cover it, answer from general knowledge and say "(not in docs)". Never invent figures.\n\n` +
      `MEETING NOTES: ${this.meeting?.description || 'n/a'}\n\n` +
      (this.prep?.resume ? `USER'S RESUME (their real background; for questions about the user's own experience answer in first person from this, never invent):\n${this.prep.resume}\n\n` : '') +
      `DOCUMENTS:\n${context}`;
    const user = `Recent conversation:\n${this.history.slice(-6).join('\n')}\n\nQUESTION: ${question}`;
    onStart?.(question);
    try {
      if (useOpenAI) {
        let started = false;
        try {
          await this.openaiStream(system, user, ctrl.signal, (d) => { started = true; onDelta?.(d); });
          if (started || ctrl.signal.aborted) return onDone?.();
          console.error('OpenAI returned no text, falling back to Claude');
        } catch (e) {
          if (ctrl.signal.aborted) return;
          if (started) return onDone?.(e.message); // already showing a partial answer, don't mix models
          console.error('OpenAI failed, falling back to Claude:', e.message.split('\n')[0]);
          // fall through: answer with Claude instead so the user never sees a dead end
        }
      }
      const stream = this.client.messages.stream(
        // thinking disabled: otherwise the model may spend its whole token budget "thinking" and return NO text, and it is slower.
        { model: this.model, max_tokens: 260, thinking: { type: 'disabled' }, system, messages: [{ role: 'user', content: user }] },
        { signal: ctrl.signal }
      );
      stream.on('text', (d) => onDelta?.(d));
      await stream.finalMessage();
      onDone?.();
    } catch (e) {
      if (!ctrl.signal.aborted) onDone?.(e.message);
    }
  }
}

module.exports = { Answerer, isQuestion };
