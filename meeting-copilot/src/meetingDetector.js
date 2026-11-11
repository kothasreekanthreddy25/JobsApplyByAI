// Detects a live meeting two ways:
//  1) a meeting app/browser window with a meeting-looking title is open
//  2) the calendar (ICS) says an event is happening now
const { execFile } = require('child_process');
const EventEmitter = require('events');

const PS = `Get-Process | Where-Object { $_.MainWindowTitle } | Select-Object ProcessName,MainWindowTitle | ConvertTo-Json -Compress`;

const RULES = [
  { app: 'Zoom', proc: /^zoom$/i, title: /zoom meeting|meeting/i },
  { app: 'Teams', proc: /^(ms-teams|teams)$/i, title: /\| microsoft teams|meeting/i },
  { app: 'Google Meet', proc: /^(chrome|msedge|firefox|brave)$/i, title: /^meet\s*[-–]|google meet/i },
  { app: 'Webex', proc: /^(webex|ptoneclk|atmgr)$/i, title: /webex|meeting/i },
  { app: 'Slack Huddle', proc: /^slack$/i, title: /huddle/i },
];

function scanWindows() {
  return new Promise((resolve) => {
    execFile('powershell', ['-NoProfile', '-Command', PS], { windowsHide: true, timeout: 8000 }, (err, out) => {
      if (err || !out) return resolve([]);
      try {
        const j = JSON.parse(out);
        resolve(Array.isArray(j) ? j : [j]);
      } catch { resolve([]); }
    });
  });
}

class MeetingDetector extends EventEmitter {
  constructor(calendar) {
    super();
    this.calendar = calendar;
    this.current = null;
    this.manual = false;
  }
  start() { this.timer = setInterval(() => this.tick(), 4000); this.tick(); }
  stop() { clearInterval(this.timer); }
  toggleManual() {
    this.manual = !this.manual;
    this.tick();
  }
  async tick() {
    let found = null;
    const wins = await scanWindows();
    for (const w of wins) {
      for (const r of RULES) {
        if (r.proc.test(w.ProcessName) && r.title.test(w.MainWindowTitle)) {
          found = { app: r.app, title: w.MainWindowTitle };
          break;
        }
      }
      if (found) break;
    }
    const ev = this.calendar ? this.calendar.currentEvent() : null;
    if (found || ev || this.manual) {
      const title = ev?.summary || found?.title || 'Manual session';
      const meeting = { title, app: found?.app || 'Calendar', description: ev?.description || '' };
      if (!this.current || this.current.title !== meeting.title) {
        this.current = meeting;
        this.emit('start', meeting);
      }
    } else if (this.current) {
      const ended = this.current;
      this.current = null;
      this.emit('end', ended);
    }
  }
}

module.exports = { MeetingDetector };
