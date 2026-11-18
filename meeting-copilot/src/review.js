// Mock-interview review: marks for each answer plus a pronunciation / delivery report.
//  - Marks: Claude grades each answer against the model answer from your documents (when there is one).
//  - Pronunciation: measured from the speech recogniser (how confidently each word was understood), pace, pauses and filler words.
//    This is an ESTIMATE: words the recogniser struggles with are words a listener may struggle with too, but it is not a phoneme-level test.
const Anthropic = require('@anthropic-ai/sdk');

const FILLERS = new Set(['um', 'umm', 'uh', 'uhh', 'er', 'erm', 'ah', 'hmm', 'mm', 'uhm']);
const LOW_CONF = 0.8;
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const r1 = (n) => Math.round(n * 10) / 10;
const norm = (w) => String(w.punctuated_word || w.word || '').toLowerCase().replace(/[^a-z0-9']/g, '');

/** words: [{word, punctuated_word?, start, end, confidence}] (seconds). */
function analyzeSpeech(words) {
  const ws = (words || []).filter((w) => norm(w));
  if (!ws.length) return { words: 0, speakSec: 0, wpm: 0, avgConfidence: 0, clarity: 0, fillerCount: 0, fillers: {}, lowWords: [], longPauses: 0 };
  const spoken = ws.filter((w) => !FILLERS.has(norm(w)));
  const first = ws[0].start, last = ws[ws.length - 1].end;
  const speakSec = Math.max(1, last - first);
  const avg = ws.reduce((a, w) => a + (w.confidence ?? 1), 0) / ws.length;
  const fillers = {};
  for (const w of ws) { const n = norm(w); if (FILLERS.has(n)) fillers[n] = (fillers[n] || 0) + 1; }
  let longPauses = 0;
  for (let i = 1; i < ws.length; i++) if (ws[i].start - ws[i - 1].end > 2) longPauses++;
  const byWord = new Map();
  for (const w of spoken) {
    if ((w.confidence ?? 1) >= LOW_CONF) continue;
    const k = norm(w); if (k.length < 3) continue;
    const e = byWord.get(k) || { word: k, n: 0, sum: 0 }; e.n++; e.sum += w.confidence; byWord.set(k, e);
  }
  const lowWords = [...byWord.values()].map((e) => ({ word: e.word, count: e.n, confidence: Math.round(e.sum / e.n * 100) / 100 }))
    .sort((a, b) => a.confidence - b.confidence).slice(0, 8);
  return {
    words: spoken.length, speakSec: r1(speakSec), wpm: Math.round(spoken.length / speakSec * 60),
    avgConfidence: Math.round(avg * 1000) / 1000,
    clarity: r1(clamp((avg - 0.8) / 0.18, 0, 1) * 10), // average confidence 0.98+ = 10/10, 0.80 or less = 0
    fillerCount: Object.values(fillers).reduce((a, b) => a + b, 0), fillers, lowWords, longPauses,
  };
}

/** Merge the speech stats of several answers into one overall figure. */
function overallSpeech(turns) {
  const s = analyzeSpeech(turns.flatMap((t) => t.words || []));
  // pace over actual talking time per answer, not across the gaps between questions
  const talk = turns.map((t) => analyzeSpeech(t.words)).filter((x) => x.words);
  if (talk.length) {
    const sec = talk.reduce((a, x) => a + x.speakSec, 0);
    s.wpm = Math.round(talk.reduce((a, x) => a + x.words, 0) / sec * 60);
    s.speakSec = r1(sec);
  }
  s.longPauses = talk.reduce((a, x) => a + x.longPauses, 0);
  return s;
}

function paceNote(wpm) {
  if (!wpm) return 'No speech was captured.';
  if (wpm < 110) return `${wpm} words/min is slow. Aim for 130 to 160 and keep your energy up.`;
  if (wpm > 175) return `${wpm} words/min is fast. Slow down and pause between ideas so each word is clear.`;
  return `${wpm} words/min is a comfortable pace.`;
}

function gradeBand(pct) { return pct >= 85 ? 'Excellent' : pct >= 70 ? 'Good' : pct >= 50 ? 'Fair' : 'Needs work'; }

const SYSTEM = 'You are a strict but fair interview coach marking a mock interview. For each question you get the candidate\'s spoken answer (a speech-to-text transcript) and, when available, a REFERENCE answer written by the candidate for themselves.\n' +
  'Mark each answer out of 10: accuracy and relevance 0-4, depth and a concrete example 0-3, structure and clarity 0-3. A blank or off-topic answer gets 0-1. Do not penalise missing punctuation or small transcription slips. Judge against the reference when given, otherwise against general technical knowledge.\n' +
  'Reply with ONLY JSON: {"answers":[{"n":1,"score":7,"verdict":"one short sentence","strengths":["..."],"improve":["..."],"missing":["key point not mentioned"]}],"summary":"2-3 sentences overall","topTips":["3 short actionable tips"]}. Keep every string short and specific.';

function extractJson(text) {
  const s = text.indexOf('{'), e = text.lastIndexOf('}');
  if (s < 0 || e < 0) throw new Error('no JSON in reply');
  return JSON.parse(text.slice(s, e + 1));
}

const textOf = (msg) => (msg.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');

async function gradeAnswers({ turns, apiKey, model, client }) {
  const c = client || new Anthropic({ apiKey });
  const blocks = turns.map((t, i) => `Q${i + 1}: ${t.q}\nREFERENCE: ${t.reference || '(none)'}\nCANDIDATE ANSWER: ${t.transcript || '(no answer heard)'}`).join('\n\n');
  const msg = await c.messages.create({ model, max_tokens: 2200, thinking: { type: 'disabled' }, system: SYSTEM, messages: [{ role: 'user', content: blocks }] });
  return extractJson(textOf(msg));
}

async function pronunciationAdvice({ speech, apiKey, model, client }) {
  if (!speech.words) return null;
  const c = client || new Anthropic({ apiKey });
  const unsure = speech.lowWords.map((w) => `${w.word} (${Math.round(w.confidence * 100)}%, x${w.count})`).join(', ') || 'none';
  const facts = `clarity ${speech.clarity}/10 (average recognition confidence ${Math.round(speech.avgConfidence * 100)}%); pace ${speech.wpm} words/min (${paceNote(speech.wpm)}); filler words ${speech.fillerCount} ${JSON.stringify(speech.fillers)}; long pauses over 2 s: ${speech.longPauses}; words the recogniser was unsure about: ${unsure}`;
  const msg = await c.messages.create({
    model, max_tokens: 400, thinking: { type: 'disabled' },
    system: 'You coach spoken English for interviews. From the measurements, write 3 to 4 short plain-text bullet lines (each starting with "- ") of specific pronunciation and delivery advice. For unsure words, say how to say them clearly (stress, syllables) if you can. Do not claim you heard the audio.',
    messages: [{ role: 'user', content: facts }],
  });
  return textOf(msg).trim();
}

/** turns: [{q, source, reference, words:[...], transcript}] -> report object */
async function buildReview({ turns, apiKey, model, client, now = new Date() }) {
  const per = turns.map((t) => ({ ...t, speech: analyzeSpeech(t.words) }));
  const speech = overallSpeech(turns);
  let graded = null, gradeError = null, advice = null;
  const answered = per.some((t) => t.transcript && t.transcript.trim());
  if (answered) {
    try { graded = await gradeAnswers({ turns: per, apiKey, model, client }); } catch (e) { gradeError = e.message; }
    try { advice = await pronunciationAdvice({ speech, apiKey, model, client }); } catch { /* advice is optional */ }
  }
  const answers = per.map((t, i) => {
    const g = graded?.answers?.find((a) => a.n === i + 1) || graded?.answers?.[i] || null;
    const heard = !!(t.transcript && t.transcript.trim());
    return {
      n: i + 1, q: t.q, source: t.source, heard, transcript: t.transcript || '', reference: t.reference || '',
      score: heard ? clamp(Math.round(+g?.score || 0), 0, 10) : 0, scored: heard && !!g,
      verdict: g?.verdict || (heard ? 'Could not be marked (no AI reply).' : 'No answer was heard.'),
      strengths: g?.strengths || [], improve: g?.improve || [], missing: g?.missing || [], speech: t.speech,
    };
  });
  const total = answers.reduce((a, x) => a + x.score, 0);
  const max = answers.length * 10;
  const pct = max ? Math.round(total / max * 100) : 0;
  return {
    date: now.toISOString(), total, max, pct, band: gradeBand(pct), answers,
    summary: graded?.summary || (answered ? '' : 'No spoken answers were captured. Check that your microphone is allowed and selected.'),
    topTips: graded?.topTips || [],
    pronunciation: { ...speech, paceNote: paceNote(speech.wpm), advice },
    gradeError, unmarked: answers.filter((a) => !a.scored).length,
  };
}

function toMarkdown(rv) {
  const L = ['# Mock interview review', '', `Date: ${rv.date.slice(0, 16).replace('T', ' ')}`, '', `## Marks: ${rv.total} / ${rv.max}  (${rv.pct}%, ${rv.band})`, ''];
  if (rv.summary) L.push(rv.summary, '');
  if (rv.topTips.length) L.push('Top tips:', ...rv.topTips.map((t) => `- ${t}`), '');
  L.push('## Answers', '');
  for (const a of rv.answers) {
    L.push(`### Q${a.n} (${a.score}/10): ${a.q}`, '', `Verdict: ${a.verdict}`, '');
    if (a.strengths.length) L.push('Good:', ...a.strengths.map((s) => `- ${s}`), '');
    if (a.improve.length) L.push('Improve:', ...a.improve.map((s) => `- ${s}`), '');
    if (a.missing.length) L.push('Missing points:', ...a.missing.map((s) => `- ${s}`), '');
    if (a.transcript) L.push(`What you said: "${a.transcript}"`, '');
  }
  const p = rv.pronunciation;
  L.push('## Pronunciation and delivery', '', `Pronunciation clarity (estimated): ${p.clarity} / 10`, `Pace: ${p.paceNote}`, `Filler words (um, uh...): ${p.fillerCount}`, `Long pauses (over 2 s): ${p.longPauses}`);
  if (p.lowWords.length) L.push('', 'Words to practise (the recogniser was unsure of them):', ...p.lowWords.map((w) => `- ${w.word}: understood ${Math.round(w.confidence * 100)}% of the time (said ${w.count}x)`));
  if (p.advice) L.push('', p.advice);
  L.push('', '_Pronunciation is estimated from speech-recognition confidence, pace, pauses and filler words. It is a guide, not a phoneme-level assessment._', '');
  return L.join('\n');
}

module.exports = { analyzeSpeech, overallSpeech, buildReview, toMarkdown, paceNote, gradeBand, extractJson, FILLERS };
