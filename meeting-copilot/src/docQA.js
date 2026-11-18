// Turns "question + answer" documents (Word, PDF, text, Markdown) into prepared answers.
// A question starts a pair when the line is numbered ("1.1  Explain closures...", "Q3:"), or ends with "?" and is short.
// Everything after it, up to the next question, is that question's answer. So a Q&A guide works as it is.
const path = require('path');
const { extractText } = require('./docs');

const NUMBERED = /^\s*(?:Q\s*)?\d{1,3}(?:\.\d{1,3})+[.)]?\s+\S/;   // 1.1  text
const QPREFIX = /^\s*Q\s*\d*\s*[:.)-]\s*\S/i;                       // Q: text, Q3. text
const ANSWER_PREFIX = /^\s*(A|Ans|Answer)\s*\d*\s*[:.)-]\s*/i;

const clean = (s) => s.replace(/^\s*(?:Q\s*\d*\s*[:.)-]|\d{1,3}(?:\.\d{1,3})+[.)]?)\s*/i, '').replace(/[*_`#]+/g, '').replace(/\s+/g, ' ').trim();
// Code lines inside answers (not read aloud): they end in ; { } or start with a keyword, and are not ordinary sentences.
const proseLike = (l) => /\b[a-z]{3,} [a-z]{3,} [a-z]{3,} [a-z]{3,}/i.test(l.replace(/\([^)]*\)/g, ''));
const isCode = (l) => /([;{}]|=>)\s*(\/\/.*)?$|^\s*(const|let|var|function|import|export|return|await|class|\/\/|<\/?\w+)\b/.test(l.trim()) && !proseLike(l);
const sentences = (t) => (t.match(/[^.!?]+[.!?]+(?=\s|$)|[^.!?]+$/g) || []).map((s) => s.trim()).filter(Boolean);
const words = (s, n) => { const w = s.split(/\s+/); return w.length > n ? w.slice(0, n).join(' ') + '…' : s; };

function isQuestionLine(raw) {
  const s = raw.trim();
  if (s.length < 10 || s.length > 260) return false;
  if (NUMBERED.test(s) || QPREFIX.test(s)) return true;
  return s.endsWith('?') && s.split(/\s+/).length >= 3 && s.length <= 200;
}

/** [{ questions:[...], headline, points:[...], detail }] */
function parsePairs(text) {
  const lines = String(text || '').split(/\r?\n/);
  const pairs = []; let cur = null;
  for (const raw of lines) {
    if (!raw.trim()) continue;
    if (isQuestionLine(raw)) { cur = { q: clean(raw), body: [] }; pairs.push(cur); continue; }
    if (cur) cur.body.push(raw);
  }
  const out = [];
  for (const p of pairs) {
    const prose = p.body.filter((l) => !isCode(l)).map((l) => l.replace(ANSWER_PREFIX, '').trim()).filter(Boolean);
    const joined = prose.join(' ').replace(/\s+/g, ' ').trim();
    if (joined.length < 25 || p.q.length < 8) continue; // a heading with nothing under it is not a Q&A pair
    const sents = sentences(joined);
    const firstQ = (p.q.match(/^[^?.]+[?.]/) || [p.q])[0].trim();
    out.push({
      questions: [...new Set([p.q, firstQ].filter((x) => x.length >= 8))],
      headline: words(sents[0] || joined, 22),
      points: sents.slice(1, 4).map((s) => words(s, 16)),
      detail: joined.slice(0, 900),
    });
  }
  return out;
}

async function loadDocPairs(files) {
  const items = [];
  for (const f of files) {
    try { for (const it of parsePairs(await extractText(f))) items.push({ ...it, source: path.basename(f) }); }
    catch (e) { console.error(`Q&A skip ${path.basename(f)}: ${e.message}`); }
  }
  return items;
}

module.exports = { parsePairs, loadDocPairs, isQuestionLine };
