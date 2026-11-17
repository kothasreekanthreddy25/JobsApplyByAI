// Local document index (BM25) so retrieval costs ~1ms, keeping the 2-3s budget for STT + LLM.
// Loads DOCS_DIR/*.txt|md (general) and DOCS_DIR/<sub-folder>/* when the sub-folder name appears in the meeting title.
const fs = require('fs');
const path = require('path');

const SUPPORTED = /\.(txt|md|csv|json|pdf|docx)$/i;

async function extractText(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.pdf') {
    const pdf = require('pdf-parse/lib/pdf-parse.js'); // direct path avoids pdf-parse's debug-mode self-test
    return (await pdf(fs.readFileSync(file))).text;
  }
  if (ext === '.docx') {
    return (await require('mammoth').extractRawText({ path: file })).value;
  }
  return fs.readFileSync(file, 'utf8');
}

const tok =(s) => s.toLowerCase().match(/[a-z0-9]{2,}/g) || [];
const STOP = new Set('the a an and or of to in is are was were for on with that this it as at by be from what how why when who which do does can you your we our i'.split(' '));

function chunk(text, source, size = 120) {
  const words = text.split(/\s+/);
  const out = [];
  for (let i = 0; i < words.length; i += size - 20) {
    const t = words.slice(i, i + size).join(' ');
    if (t.trim()) out.push({ text: t, source, terms: tok(t).filter((w) => !STOP.has(w)) });
  }
  return out;
}

function readDir(dir, depth = 0) {
  let files = [];
  if (!fs.existsSync(dir)) return files;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isFile() && SUPPORTED.test(e.name)) files.push(p);
    else if (e.isDirectory() && depth < 1) files = files.concat(readDir(p, depth + 1));
  }
  return files;
}

class DocIndex {
  constructor(root) { this.root = path.resolve(root); this.chunks = []; this.df = new Map(); this.avg = 1; }

  async load(meetingTitle = '') {
    const title = meetingTitle.toLowerCase();
    const files = [];
    for (const e of fs.existsSync(this.root) ? fs.readdirSync(this.root, { withFileTypes: true }) : []) {
      const p = path.join(this.root, e.name);
      if (e.isFile()) files.push(p);
      else if (e.isDirectory() && title.includes(e.name.toLowerCase())) files.push(...readDir(p));
    }
    this.chunks = [];
    for (const f of files.filter((f) => SUPPORTED.test(f) && !path.basename(f).startsWith('~$'))) {
      try {
        const text = await extractText(f);
        this.chunks.push(...chunk(text, path.basename(f)));
      } catch (e) { console.error(`skipping ${path.basename(f)}: ${e.message}`); }
    }
    this.df = new Map();
    for (const c of this.chunks) for (const t of new Set(c.terms)) this.df.set(t, (this.df.get(t) || 0) + 1);
    this.avg = this.chunks.reduce((a, c) => a + c.terms.length, 0) / (this.chunks.length || 1);
    return this.chunks.length;
  }

  search(query, k = 4) {
    const q = tok(query).filter((w) => !STOP.has(w));
    const N = this.chunks.length;
    const scored = this.chunks.map((c) => {
      let s = 0;
      for (const t of q) {
        const f = c.terms.filter((x) => x === t).length;
        if (!f) continue;
        const idf = Math.log(1 + (N - (this.df.get(t) || 0) + 0.5) / ((this.df.get(t) || 0) + 0.5));
        s += idf * ((f * 2.2) / (f + 1.2 * (0.25 + 0.75 * (c.terms.length / this.avg))));
      }
      return { c, s };
    });
    return scored.filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, k).map((x) => ({ ...x.c, score: x.s }));
  }
}

module.exports = { DocIndex, extractText };
