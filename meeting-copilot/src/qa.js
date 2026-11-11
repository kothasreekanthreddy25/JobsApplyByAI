// Question detection (instant heuristic, no LLM round trip) + streaming answers.
// The first tokens stream to the overlay immediately, so the user starts reading in ~1s.
const Anthropic = require('@anthropic-ai/sdk');

const WH = /^(so,? |and |okay,? |ok,? )?(what|why|how|when|where|who|which|whose|can|could|would|will|should|do|does|did|is|are|was|were|have|has|tell me|walk me|explain|describe|give me)\b/i;
const ASK = /\b(can you|could you|would you|do you|did you|have you|are you|what's|what is|how (do|did|would|many|much)|tell us|walk us|any (thoughts|idea))\b/i;

const MIN_DOC_SCORE = 0.3; // below this the doc match is treated as "not found"

function isQuestion(t) {
  const s = t.trim();
  if (s.split(/\s+/).length < 3) return false;
  return s.endsWith('?') || WH.test(s) || ASK.test(s);
}

class Answerer {
  constructor({ apiKey, model, docs, openaiKey, openaiModel }) {
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
    this.client.messages.create({ model: this.model, max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] }).catch(() => {});
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

  async answer(question, { onStart, onDelta, onDone }) {
    this.ctrl?.abort(); // newest question wins
    const ctrl = (this.ctrl = new AbortController());
    const hits = this.docs.search(question + ' ' + this.history.slice(-2).join(' '), 4).filter((h) => h.score >= MIN_DOC_SCORE);
    const context = hits.map((h, i) => `[${i + 1}] (${h.source}) ${h.text}`).join('\n\n') || '(no matching documents)';
    const useOpenAI = !hits.length && !!this.openaiKey; // docs had no good answer -> OpenAI
    const system =
      `You are a private real-time assistant for the user in a meeting "${this.meeting?.title || ''}". ` +
      `Someone else just asked the user a question (it may be a general/technical concept like "what is a closure?"). Answer immediately and directly, no preamble. Give the answer the user can speak aloud: lead with the direct answer in 1 sentence, ` +
      `then at most 2 short supporting bullets. Max ~60 words. Prefer facts from the DOCUMENTS and cite as [n]. ` +
      `If the documents don't cover it, answer from general knowledge and say "(not in docs)". Never invent figures.\n\n` +
      `MEETING NOTES: ${this.meeting?.description || 'n/a'}\n\nDOCUMENTS:\n${context}`;
    const user = `Recent conversation:\n${this.history.slice(-6).join('\n')}\n\nQUESTION: ${question}`;
    onStart?.(question);
    try {
      if (useOpenAI) {
        await this.openaiStream(system, user, ctrl.signal, onDelta);
        return onDone?.();
      }
      const stream = this.client.messages.stream(
        { model: this.model, max_tokens: 220, system, messages: [{ role: 'user', content: user }] },
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
