// Matches a spoken question to your prepared Q&A by MEANING (local embeddings, ~15 ms, no network).
const fs = require('fs');
const path = require('path');
const { embed, dot } = require('./embed');

// score >= HIGH  -> show the prepared answer instantly, no AI call
// score >= MID   -> still ask the AI, but hand it the closest prepared answer as notes
const HIGH = +(process.env.PREP_HIGH || 0.85);
const MID = +(process.env.PREP_MID || 0.5);

class PrepBank {
  constructor(dir) { this.dir = path.resolve(dir); this.entries = []; this.ready = false; }

  async load() {
    this.entries = [];
    this.resume = '';
    if (fs.existsSync(this.dir)) {
      for (const f of fs.readdirSync(this.dir).filter((f) => f.endsWith('.json'))) {
        let pack;
        try { pack = JSON.parse(fs.readFileSync(path.join(this.dir, f), 'utf8')); } catch { continue; }
        if (pack.resume) this.resume = pack.resume; // latest pack's resume is used as background context
        for (const item of pack.items || []) {
          for (const q of item.questions || []) this.entries.push({ q, item, pack: pack.name || f, vec: await embed(q) });
        }
      }
    }
    this.ready = true;
    return this.entries.length;
  }

  async match(question) {
    if (!this.ready || !this.entries.length) return null;
    const v = await embed(question);
    const perItem = new Map(); // best-scoring phrasing for each prepared item
    for (const e of this.entries) {
      const s = dot(v, e.vec);
      const cur = perItem.get(e.item);
      if (!cur || s > cur.score) perItem.set(e.item, { score: s, item: e.item, matchedQuestion: e.q, pack: e.pack });
    }
    const ranked = [...perItem.values()].sort((a, b) => b.score - a.score);
    const best = { ...ranked[0], alts: ranked.slice(0, 3) };
    best.level = best.score >= HIGH ? 'high' : best.score >= MID ? 'mid' : 'low';
    return best;
  }
}

// Same layout the overlay renders: headline line, then "- " bullets.
const formatAnswer = (item) => [item.headline, ...(item.points || []).map((p) => '- ' + p)].join('\n');

module.exports = { PrepBank, formatAnswer, HIGH, MID };
