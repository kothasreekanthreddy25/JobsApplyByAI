// Minimal ICS reader: fetches the URL hourly, exposes events + "what's happening now".
// Recurring events (RRULE) are not expanded in this MVP; use a non-recurring export or extend with node-ical.
class Calendar {
  constructor(url) { this.url = url; this.events = []; }
  async start() {
    if (!this.url) return;
    await this.refresh();
    this.timer = setInterval(() => this.refresh(), 60 * 60 * 1000);
  }
  async refresh() {
    try {
      const txt = await (await fetch(this.url)).text();
      this.events = parseIcs(txt);
    } catch (e) { console.error('calendar refresh failed', e.message); }
  }
  currentEvent(now = new Date(), earlyMs = 2 * 60 * 1000) {
    return this.events.find((e) => e.start - earlyMs <= now && now <= e.end) || null;
  }
  upcoming(n = 5) {
    const now = new Date();
    return this.events.filter((e) => e.end > now).sort((a, b) => a.start - b.start).slice(0, n);
  }
}

function parseDate(v) {
  const m = v.match(/(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?/);
  if (!m) return null;
  const [, y, mo, d, h = '0', mi = '0', s = '0', z] = m;
  return z ? new Date(Date.UTC(+y, mo - 1, +d, +h, +mi, +s)) : new Date(+y, mo - 1, +d, +h, +mi, +s);
}

function parseIcs(txt) {
  const unfolded = txt.replace(/\r?\n[ \t]/g, '');
  const out = [];
  for (const block of unfolded.split('BEGIN:VEVENT').slice(1)) {
    const get = (k) => {
      const m = block.match(new RegExp(`^${k}[^:\\n]*:(.*)$`, 'm'));
      return m ? m[1].replace(/\\n/g, '\n').replace(/\\,/g, ',').trim() : '';
    };
    const start = parseDate(get('DTSTART')), end = parseDate(get('DTEND'));
    if (start && end) out.push({ summary: get('SUMMARY'), description: get('DESCRIPTION'), start, end });
  }
  return out;
}

module.exports = { Calendar };
