// Finds interview questions inside the documents in the docs folder (PDF, Word, text, Markdown, CSV).
// A "question" is a line that ends with "?" or starts with an interview prompt ("Tell me...", "Describe...", ...).
// Answer lines (e.g. "A: ...") and long paragraphs are ignored, so Q&A documents work as-is.
const fs = require('fs');
const path = require('path');
const { extractText } = require('./docs');

const SUPPORTED = /\.(txt|md|csv|json|pdf|docx)$/i;
const PROMPT_START = /^(tell me|tell us|describe|explain|walk me|walk us|give me|give us|talk about|talk me|what|why|how|when|where|who|which|can you|could you|would you|have you|do you|did you|are you|is there)\b/i;

function cleanLine(raw) {
  return raw
    .replace(/^\s*(?:[-*•>]+|\d+[.)]|\(?\d+\)|Q\s*\d*\s*[:.)-])\s*/i, '') // bullets, "1.", "Q1:", "Q:"
    .replace(/[*_`#]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\d{1,3}\s+(?=[A-Z])/, ''); // numbering left behind by Word tables: "6 How do you..." -> "How do you..."
}

function extractQuestions(text) {
  const out = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    if (/^\s*(A|Ans|Answer)\s*\d*\s*[:.)-]/i.test(raw)) continue; // answer lines
    let s = cleanLine(raw);
    if (s.length < 12 || s.length > 220) continue;
    const q = s.endsWith('?') || PROMPT_START.test(s);
    if (!q) continue;
    // "Question? Answer text..." on one line: keep just the question part
    const cut = s.indexOf('?');
    if (cut > 8 && cut < s.length - 1) s = s.slice(0, cut + 1);
    if (!s.endsWith('?') && !/[.!]$/.test(s)) s += '?';
    out.push(s);
  }
  return out;
}

function listFiles(dir, depth = 0) {
  let files = [];
  if (!fs.existsSync(dir)) return files;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isFile() && SUPPORTED.test(e.name) && !e.name.startsWith('~$')) files.push(p);
    else if (e.isDirectory() && depth < 1) files = files.concat(listFiles(p, depth + 1));
  }
  return files;
}

/** Returns [{ q, source }] from docsDir; if the docs hold none, falls back to the prep-pack questions. */
async function loadQuestions(docsDir, prepDir) {
  const seen = new Set(), out = [];
  const add = (q, source) => { const k = q.toLowerCase().replace(/[^\w]+/g, ' ').trim(); if (k && !seen.has(k)) { seen.add(k); out.push({ q, source }); } };

  for (const f of listFiles(docsDir)) {
    try { for (const q of extractQuestions(await extractText(f))) add(q, path.basename(f)); } catch { /* unreadable file: skip */ }
  }
  if (!out.length && prepDir && fs.existsSync(prepDir)) {
    for (const f of fs.readdirSync(prepDir).filter((n) => n.endsWith('.json'))) {
      try { for (const item of JSON.parse(fs.readFileSync(path.join(prepDir, f), 'utf8')).items || []) if (item.questions?.[0]) add(item.questions[0], f); } catch { /* skip */ }
    }
  }
  return out;
}

module.exports = { extractQuestions, loadQuestions };
