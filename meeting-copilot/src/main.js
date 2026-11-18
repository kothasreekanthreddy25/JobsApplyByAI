require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { app, BrowserWindow, globalShortcut, ipcMain, screen, session, desktopCapturer, Tray, Menu, nativeImage, dialog, shell, Notification } = require('electron');
const path = require('path');
const { MeetingDetector } = require('./meetingDetector');
const { Calendar } = require('./calendar');
const { DocIndex } = require('./docs');
const { StreamingSTT } = require('./stt');
const { Answerer, isQuestion } = require('./qa');
const { PrepBank } = require('./prepBank');
const { buildReview, toMarkdown } = require('./review');
const config = require('./config');
const { createLicense, fmt } = require('./license');
const BUY_URL = process.env.BUY_URL || require('../package.json').buyUrl || '';
const { generatePack } = require('./prep');
const { Demo } = require('./demo');
const { loadQuestions } = require('./questions');
const Anthropic = require('@anthropic-ai/sdk');

// One copy only: a second launch just opens Settings (avoids stale copies holding the hotkeys).
if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }
app.setAppUserModelId('com.meetingcopilot.app');

let overlay;
let stt = null;
// Overlay preferences persist across runs (position, size, background opacity, font size).
const fs = require('fs');
let cfg = { opacity: 0.28, font: 20, interactive: false };
const cfgPath = () => path.join(app.getPath('userData'), 'overlay.json');
try { cfg = { ...cfg, ...JSON.parse(fs.readFileSync(cfgPath(), 'utf8')) }; } catch {}
cfg.interactive = false; // always start locked (click-through)
let saveTimer;
function saveCfg() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { cfg.bounds = fullBounds || overlay.getBounds(); fs.writeFileSync(cfgPath(), JSON.stringify(cfg)); } catch {}
  }, 400);
}
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
let docs, prep, answerer, paths, license, meter = null;
const calendar = new Calendar(process.env.CALENDAR_ICS_URL);
const detector = new MeetingDetector(calendar);

// (Re)build everything that depends on keys and folders. Called at start and after keys change.
function build() {
  config.applyKeysToEnv();
  paths = config.paths();
  license = createLicense({ storage: config.licenseStore });
  license.touch(); // records first-use time
  process.env.MODEL_CACHE = paths.models;
  if (app.isPackaged) process.env.MODEL_OFFLINE = '1'; // installer ships the matching model
  docs = new DocIndex(paths.docs);
  prep = new PrepBank(paths.prep, paths.docs);
  answerer = new Answerer({
    apiKey: process.env.ANTHROPIC_API_KEY || 'missing',
    model: process.env.ANSWER_MODEL || 'claude-haiku-5-5',
    docs, prep,
    openaiKey: process.env.OPENAI_API_KEY,
    openaiModel: process.env.OPENAI_MODEL,
  });
  prep.load().then((n) => { if (n) send('status', `Prep pack ready: ${n} question phrasings`); }).catch((e) => send('status', 'Prep pack unavailable: ' + e.message));
}

const send = (ch, payload) => overlay && !overlay.isDestroyed() && overlay.webContents.send(ch, payload);

function defaultBounds() {
  // Narrow column, top-center just under the webcam: reading it keeps your eyes near the camera.
  const { workArea } = screen.getPrimaryDisplay();
  const width = 440, height = 230;
  return { width, height, x: Math.round(workArea.x + (workArea.width - width) / 2), y: workArea.y + 6 };
}
const pushCfg = () => { send('cfg', { opacity: cfg.opacity, font: cfg.font, interactive: cfg.interactive }); saveCfg(); };

// Minimise = shrink to a small pill (top-right corner of the overlay) that still has Restore + Close.
let fullBounds = null;
function minimizeOverlay(on) {
  if (!overlay || overlay.isDestroyed()) return;
  if (on && !fullBounds) {
    fullBounds = overlay.getBounds();
    overlay.setBounds({ x: fullBounds.x + fullBounds.width - 110, y: fullBounds.y, width: 110, height: 30 });
    send('mini', true);
  } else if (!on && fullBounds) {
    overlay.setBounds(fullBounds); fullBounds = null;
    send('mini', false);
  }
  if (!fullBounds) saveCfg();
}

function createOverlay() {
  const b = cfg.bounds || defaultBounds();
  overlay = new BrowserWindow({
    ...b,
    frame: false, transparent: true, alwaysOnTop: true, skipTaskbar: true,
    resizable: false, // transparent windows can't be edge-resized on Windows; we resize via the grip + hotkeys
    hasShadow: false, focusable: false, show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true },
  });
  // KEY PRIVACY FEATURE: excludes this window from screen capture / screen share / recordings.
  // Windows uses WDA_EXCLUDEFROMCAPTURE; macOS uses NSWindowSharingNone.
  overlay.setContentProtection(true);
  overlay.setAlwaysOnTop(true, 'screen-saver');
  overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlay.setIgnoreMouseEvents(true, { forward: true });
  overlay.webContents.on('did-finish-load', () => { pushCfg(); send('mode', mode); });
  overlay.loadFile(path.join(__dirname, '..', 'overlay', 'index.html'));
  overlay.once('ready-to-show', () => overlay.showInactive());
}

// Big, readable message in the overlay itself (the small status line fades out).
function showLicenseWall(reason, realtime = false) {
  send('answer-start', 'License needed');
  send('answer-delta', realtime
    ? `${reason}\n- Open Settings from the tray icon and paste your license key\n- Or try Demo mode (free)`
    : `${reason}\n- Click the tray icon, open Settings\n- Paste your license key and Activate`);
  send('answer-done', null);
  send('status', 'License needed');
}

let listenReady = Promise.resolve(false), firedCount = 0;
async function startListening(meeting) {
  if (overlay && !overlay.isDestroyed() && !overlay.isVisible()) overlay.showInactive(); // closed earlier: show it again for the new session
  // Free allowances (counted separately): DEMO 24 h, REALTIME 1 h of meeting-call time. A license key removes both.
  const isDemo = meeting.app === 'Demo';
  const lmode = isDemo ? 'demo' : 'realtime';
  const lic = license.status(lmode);
  if (lic.status === 'expired') { showLicenseWall(lic.reason, !isDemo); openSettings(); return false; }
  send('status', 'Loading documents…');
  prep.refresh().catch((e) => console.error('prep refresh failed:', e.message));
  const n = await docs.load(meeting.title);
  answerer.setMeeting(meeting);
  send('meeting', { title: meeting.title, app: meeting.app, docChunks: n });
  if (!process.env.DEEPGRAM_API_KEY) { send('status', 'Add your Deepgram key in Settings'); return false; }
  stt = new StreamingSTT(process.env.DEEPGRAM_API_KEY);
  stt.on('ready', () => {
    const l = license.status(lmode);
    send('status', l.status === 'trial' ? `Listening · free ${isDemo ? 'demo' : 'Realtime'} time: ${fmt(l.trialLeftSec)} left` : 'Listening');
    send('capture', 'start');
  });
  stt.on('error', (e) => send('status', 'STT error: ' + e.message));
  // Speculative answering: fire as soon as the partial transcript looks like a complete
  // question and has been stable for ~200ms, without waiting for the speaker's silence.
  let fired = '', timer = null;
  const fire = (text) => {
    fired = text; firedCount++;
    answerer.answer(text, {
      onStart: (q) => send('answer-start', q),
      onMeta: (m) => send('answer-meta', m),
      onDelta: (d) => send('answer-delta', d),
      onDone: (err) => send('answer-done', err || null),
    });
  };
  stt.on('interim', (t) => {
    send('heard', t);
    clearTimeout(timer);
    if (!isQuestion(t) || t === fired) return;
    const complete = /\?$/.test(t) || t.split(/\s+/).length >= 4;
    if (complete) timer = setTimeout(() => fire(t), /\?$/.test(t) ? 0 : 200);
  });
  stt.on('utterance', (text) => {
    clearTimeout(timer);
    // Re-answer only if the final text added real content beyond what we already answered.
    const wc = (s) => s.replace(/[^\w\s]/g, '').split(/\s+/).filter(Boolean).length;
    const grew = wc(text) > wc(fired); // the early guess was cut off: answer the full question instead
    if (isQuestion(text) && (!fired || grew)) fire(text);
    fired = '';
    answerer.note(text);
  });
  answerer.warmup(); // open the HTTPS connection now so the first answer skips TLS setup
  listenReady = new Promise((res) => { stt.once('ready', () => res(true)); stt.once('error', () => res(false)); setTimeout(() => res(false), 8000); });
  stt.open();

  // Trial metering: count live-session time every 5 s; end the session when the trial runs out.
  clearInterval(meter);
  let warned = false;
  meter = setInterval(() => {
    const s = license.addUsage(5, lmode);
    if (s.status === 'expired') { stopListening(); showLicenseWall(s.reason, !isDemo); openSettings(); }
    else if (s.status === 'trial' && s.trialLeftSec <= 300 && !warned) { warned = true; send('status', `Trial: ${fmt(s.trialLeftSec)} left`); }
  }, 5000);
  return true;
}

const answerHandlers = () => ({
  onStart: (q) => send('answer-start', q),
  onMeta: (m) => send('answer-meta', m),
  onDelta: (d) => send('answer-delta', d),
  onDone: (err) => send('answer-done', err || null),
});

function stopListening() {
  clearInterval(meter);
  send('capture', 'stop');
  stt?.close();
  stt = null;
  send('status', 'Idle - waiting for a meeting');
  send('meeting', null);
}

// ================= Demo mode: scheduled mock interview with an AI interviewer =================
let mode = 'realtime', demo = null, roomWin = null, demoSession = false, injectTimer = null, askedAtCount = 0;
const speakWaiters = new Map(); let speakSeq = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Natural voice via Deepgram Aura (same key as speech recognition). Falls back to the Windows voice in the room window.
async function ttsAura(text) {
  const key = process.env.DEEPGRAM_API_KEY;
  if (!key) return null;
  try {
    const r = await fetch('https://api.deepgram.com/v1/speak?model=aura-asteria-en&encoding=mp3', {
      method: 'POST', headers: { Authorization: 'Token ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }), signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return null;
    return 'data:audio/mpeg;base64,' + Buffer.from(await r.arrayBuffer()).toString('base64');
  } catch { return null; }
}

function roomSpeak(text) {
  return new Promise(async (resolve) => {
    if (!roomWin || roomWin.isDestroyed()) return resolve();
    const id = ++speakSeq;
    const t = setTimeout(() => { speakWaiters.delete(id); resolve(); }, 45000); // never hang on a voice problem
    speakWaiters.set(id, () => { clearTimeout(t); speakWaiters.delete(id); resolve(); });
    const audio = await ttsAura(text);
    if (roomWin && !roomWin.isDestroyed()) roomWin.webContents.send('r:speak', { id, text, audio });
    else speakWaiters.get(id)?.();
  });
}

function openRoom() {
  if (roomWin && !roomWin.isDestroyed()) { roomWin.show(); roomWin.focus(); return; }
  roomWin = new BrowserWindow({
    width: 900, height: 640, minWidth: 640, minHeight: 520, title: 'Mock Interview Room', autoHideMenuBar: true,
    icon: path.join(__dirname, '..', 'build', 'icon.png'), backgroundColor: '#10141c',
    webPreferences: { preload: path.join(__dirname, 'roomPreload.js'), contextIsolation: true },
  });
  roomWin.loadFile(path.join(__dirname, '..', 'room', 'index.html'));
}

// ---- Mock interview review: record the student's spoken answers (mic) per question, then mark them ----
let micStt = null, micT0 = 0, turns = [], micGood = false;
const toRoom = (ch, p) => roomWin && !roomWin.isDestroyed() && roomWin.webContents.send(ch, p);

function startMicRecording() {
  turns = []; micGood = false; lastReview = null;
  try { micStt?.close(); } catch { /* none */ }
  micStt = new StreamingSTT(process.env.DEEPGRAM_API_KEY, { fillerWords: true });
  micT0 = Date.now();
  micStt.on('final', ({ words }) => {
    const t = turns[turns.length - 1];
    if (!t || !t.listening) return; // not an answer window (interviewer talking, or between questions)
    for (const w of words) t.words.push({ ...w, abs: micT0 + w.start * 1000 });
  });
  micStt.on('error', (e) => send('status', 'Microphone recording: ' + e.message));
  micStt.open();
  toRoom('r:mic', { on: true });
}
function stopMicRecording() { try { micStt?.close(); } catch { /* none */ } micStt = null; toRoom('r:mic', { on: false }); }

async function finishReview() {
  await sleep(1500); // the last words of the final answer are still being recognised
  stopMicRecording();
  const used = turns.filter((t) => t.q);
  if (!used.length) return;
  toRoom('r:review', { working: true });
  const done = [];
  for (const t of used) {
    t.listening = false;
    const words = t.words.sort((a, b) => a.start - b.start);
    // the interviewer's voice can leak into the mic: drop words before the question finished
    const clean = words.filter((w) => w.abs >= t.from - 200);
    let reference = '';
    try { const m = await answerer.prep?.match(t.q); if (m && m.score >= 0.5) reference = [m.item.headline, ...(m.item.points || []), m.item.detail || ''].filter(Boolean).join(' ').slice(0, 900); } catch { /* optional */ }
    done.push({ q: t.q, source: t.source, reference, words: clean, transcript: clean.map((w) => w.punctuated_word || w.word).join(' ') });
  }
  try {
    const rv = await buildReview({ turns: done, apiKey: process.env.ANTHROPIC_API_KEY, model: process.env.ANSWER_MODEL || 'claude-haiku-5-5' });
    try {
      fs.mkdirSync(paths.reviews, { recursive: true });
      const file = path.join(paths.reviews, 'mock-interview-' + new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-') + '.md');
      fs.writeFileSync(file, toMarkdown(rv)); rv.file = file;
    } catch { /* saving is a bonus */ }
    lastReview = rv;
    toRoom('r:review', rv);
    send('status', `Review ready: ${rv.total}/${rv.max}`);
  } catch (e) { toRoom('r:review', { error: e.message }); }
}
let lastReview = null;

function setupDemo() {
  demo = new Demo({
    loadQuestions: () => loadQuestions(paths.docs, paths.prep),
    speak: roomSpeak,
    // The student admitted the AI interviewer: start listening to the computer's audio, then let it speak.
    prepare: async () => {
      demoSession = true;
      const ok = await startListening({ title: 'Mock interview (demo)', app: 'Demo', description: '' });
      if (!ok) { demoSession = false; return false; }
      await listenReady;
      await sleep(1500); // let audio capture start before the first words
      startMicRecording();
      return true;
    },
  });
  demo.on('ready', () => {
    openRoom();
    send('status', 'Your mock interview is ready: admit the AI interviewer');
    try { new Notification({ title: 'Mock interview is ready', body: 'Open the room and admit the AI interviewer.' }).show(); } catch { /* notifications are optional */ }
  });
  demo.on('asking', ({ q, source }) => {
    askedAtCount = firedCount; clearTimeout(injectTimer);
    const prev = turns[turns.length - 1]; if (prev) prev.listening = false;
    turns.push({ q, source, words: [], from: Date.now(), listening: false });
  });
  // Safety net: if the speech-to-text never picked the question up from the audio (muted speakers, no audio device,
  // audio capture problem), answer from the known question text so the demo still shows an answer.
  demo.on('spoken', ({ q }) => {
    const t = turns[turns.length - 1]; if (t) { t.from = Date.now(); t.listening = true; } // the answer window opens when the question ends
    clearTimeout(injectTimer);
    injectTimer = setTimeout(() => {
      if (demo.state === 'live' && firedCount === askedAtCount) {
        send('status', 'Audio not picked up: answering from the question text');
        firedCount++; answerer.answer(q, answerHandlers());
      }
    }, 9000);
  });
  const finish = () => { clearTimeout(injectTimer); if (demoSession) { demoSession = false; stopListening(); } };
  demo.on('done', () => { finish(); finishReview(); });
  demo.on('error', (e) => { send('status', 'Demo: ' + e.message); finish(); });
  demo.on('update', (st) => {
    if (st.state === 'idle' && micStt) stopMicRecording(); // cancelled or switched to Realtime mid-interview: mic off, no review
    if (st.state === 'scheduled' && [60, 30, 10].includes(st.secsLeft)) send('status', 'Mock interview starts in ' + (st.secsLeft >= 60 ? '1 minute' : st.secsLeft + ' s'));
    global.__tray?.setToolTip(st.state === 'scheduled' ? `Meeting Copilot - mock interview in ${Math.floor(st.secsLeft / 60)}:${String(st.secsLeft % 60).padStart(2, '0')}` : 'Meeting Copilot');
  });
}

function setMode(m) {
  mode = m === 'demo' ? 'demo' : 'realtime';
  config.setMode(mode);
  send('mode', mode); send('status', mode === 'demo' ? 'Demo mode: schedule a mock interview' : 'Realtime mode: waiting for a real meeting');
  if (mode === 'demo') { detector.stop(); if (stt && !demoSession) stopListening(); }
  else { demo?.cancel(); if (demoSession) { demoSession = false; stopListening(); } detector.start(); }
  global.__tray && createTrayMenu();
}

let demoCountCache = { t: 0, n: 0 };
async function questionCount() {
  if (Date.now() - demoCountCache.t > 4000) demoCountCache = { t: Date.now(), n: (await loadQuestions(paths.docs, paths.prep)).length };
  return demoCountCache.n;
}

function registerDemoIpc() {
  ipcMain.on('r:spoken', (_e, id) => speakWaiters.get(id)?.());
  ipcMain.on('r:micpcm', (_e, buf) => { if (micStt) micStt.send(Buffer.from(buf)); });
  ipcMain.on('r:micstate', (_e, ok) => { micGood = !!ok; if (!ok) send('status', 'Microphone not available: your answers cannot be marked'); });
  ipcMain.handle('r:lastReview', () => lastReview);
  ipcMain.handle('r:openReviews', () => shell.openPath(paths.reviews));
  ipcMain.handle('r:state', () => demo.snapshot());
  ipcMain.handle('r:startNow', () => { demo.startNow(); return true; });
  ipcMain.handle('r:admit', () => { demo.admit(); return true; }); // runs the whole interview; don't block the call
  ipcMain.handle('r:next', () => { demo.next(); return true; });
  ipcMain.handle('r:end', () => { demo.end(); return true; });
  ipcMain.handle('r:cancel', () => { demo.cancel(); return true; });
  ipcMain.handle('s:setmode', (_e, m) => { setMode(m); return mode; });
  ipcMain.handle('s:close', () => { if (settingsWin && !settingsWin.isDestroyed()) settingsWin.close(); return true; });
  ipcMain.handle('s:demo', async (_e, a = {}) => {
    if (a.action === 'schedule') { if (mode !== 'demo') setMode('demo'); demo.schedule({ minutes: +a.minutes || 5, count: +a.count || 5, answerSec: +a.answerSec || 40 }); }
    else if (a.action === 'start') { if (mode !== 'demo') setMode('demo'); demo.startNow(); }
    else if (a.action === 'cancel') demo.cancel();
    else if (a.action === 'room') openRoom();
    return { ...demo.snapshot(), mode, available: await questionCount() };
  });
}

// First run: give the student a sample question document so Demo works immediately.
function seedSampleDocs() {
  try {
    const files = fs.existsSync(paths.docs) ? fs.readdirSync(paths.docs) : [];
    if (!files.length) {
      fs.mkdirSync(paths.docs, { recursive: true });
      fs.copyFileSync(path.join(__dirname, '..', 'docs', 'sample-interview-questions.md'), path.join(paths.docs, 'sample-interview-questions.md'));
    }
  } catch { /* optional */ }
}

app.whenReady().then(async () => {
  // Grant system-audio loopback (what other participants say) to the renderer without a picker.
  session.defaultSession.setDisplayMediaRequestHandler(async (_req, cb) => {
    const sources = await desktopCapturer.getSources({ types: ['screen'] });
    cb({ video: sources[0], audio: 'loopback' });
  });

  build();
  seedSampleDocs();
  mode = config.getMode();
  createOverlay();
  createTray();
  setupDemo();
  registerDemoIpc();
  registerSettingsIpc();
  if (!config.has().anthropic || !config.has().deepgram) openSettings(); // first run: ask for keys
  await calendar.start();
  detector.on('start', (m) => { if (mode === 'realtime') startListening(m); });
  detector.on('end', () => { if (mode === 'realtime') stopListening(); });
  if (mode === 'realtime') detector.start();

  // While the app is speaking, drop incoming audio so it never transcribes (and answers) its own voice.
  let muted = false, unmuteTimer = null;
  ipcMain.on('speaking', (_e, on) => {
    clearTimeout(unmuteTimer);
    if (on) muted = true;
    else unmuteTimer = setTimeout(() => (muted = false), 500); // tail so room echo doesn't leak in
  });
  ipcMain.on('pcm', (_e, buf) => { if (!muted) stt?.send(Buffer.from(buf)); });

  // Mouse drag / resize from the overlay's handles (only reachable in interactive mode).
  let start = null;
  ipcMain.on('win', (_e, kind, p) => {
    if (kind === 'start') start = overlay.getBounds();
    else if (kind === 'move' && start) overlay.setBounds({ ...start, x: start.x + p.dx, y: start.y + p.dy });
    else if (kind === 'resize' && start) overlay.setBounds({ ...start, width: Math.max(260, start.width + p.dx), height: Math.max(120, start.height + p.dy) });
    else if (kind === 'end') { start = null; saveCfg(); }
    else if (kind === 'hover') overlay.setIgnoreMouseEvents(!(p || cfg.interactive), { forward: true }); // buttons are clickable while locked
    else if (kind === 'minimize') minimizeOverlay(true);
    else if (kind === 'mode') { // quick switch from the overlay: Realtime <-> Demo
      setMode(mode === 'demo' ? 'realtime' : 'demo');
      if (mode === 'demo') openSettings(); // Demo: schedule or start the mock interview right away
    }
    else if (kind === 'settings') openSettings();
    else if (kind === 'restore') minimizeOverlay(false);
    else if (kind === 'close') { minimizeOverlay(false); overlay.hide(); } // Ctrl+Shift+H or the tray brings it back
  });

  const reg = (k, fn) => globalShortcut.register(k, fn);
  reg('Control+Shift+H', () => (overlay.isVisible() ? overlay.hide() : overlay.showInactive()));
  reg('Control+Shift+M', () => { // lock / unlock: unlocked shows drag + resize handles
    cfg.interactive = !cfg.interactive;
    overlay.setIgnoreMouseEvents(!cfg.interactive, { forward: true });
    pushCfg();
  });
  // Keyboard adjustments work even while the overlay is click-through.
  const nudge = (dx, dy) => { const b = overlay.getBounds(); overlay.setBounds({ ...b, x: b.x + dx, y: b.y + dy }); saveCfg(); };
  const grow = (dw, dh) => { const b = overlay.getBounds(); overlay.setBounds({ ...b, width: Math.max(260, b.width + dw), height: Math.max(120, b.height + dh) }); saveCfg(); };
  const S = 40;
  reg('Control+Alt+Left', () => nudge(-S, 0));
  reg('Control+Alt+Right', () => nudge(S, 0));
  reg('Control+Alt+Up', () => nudge(0, -S));
  reg('Control+Alt+Down', () => nudge(0, S));
  reg('Control+Alt+Shift+Left', () => grow(-S, 0));
  reg('Control+Alt+Shift+Right', () => grow(S, 0));
  reg('Control+Alt+Shift+Up', () => grow(0, -S));
  reg('Control+Alt+Shift+Down', () => grow(0, S));
  reg('Control+Alt+]', () => { cfg.opacity = clamp(+(cfg.opacity + 0.08).toFixed(2), 0, 0.85); pushCfg(); });
  reg('Control+Alt+[', () => { cfg.opacity = clamp(+(cfg.opacity - 0.08).toFixed(2), 0, 0.85); pushCfg(); });
  reg('Control+Alt+=', () => { cfg.font = clamp(cfg.font + 2, 12, 40); pushCfg(); });
  reg('Control+Alt+-', () => { cfg.font = clamp(cfg.font - 2, 12, 40); pushCfg(); });
  reg('Control+Alt+0', () => { overlay.setBounds(defaultBounds()); cfg.opacity = 0.28; cfg.font = 20; pushCfg(); });
  reg('Control+Shift+V', () => send('voice-toggle')); // spoken answers on/off
  reg('Control+Shift+S', () => detector.toggleManual()); // force start/stop a session
  reg('Control+Shift+Q', () => app.quit());
});

app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => {}); // keep running in the tray; quit via tray menu or Ctrl+Shift+Q
app.on('second-instance', () => openSettings());

// ---------------- Settings window, tray, IPC ----------------
let settingsWin = null;
function openSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) { settingsWin.show(); settingsWin.focus(); return; }
  settingsWin = new BrowserWindow({
    width: 740, height: 860, title: 'Meeting Copilot', autoHideMenuBar: true,
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'settingsPreload.js'), contextIsolation: true },
  });
  settingsWin.setContentProtection(true); // keep your keys / resume out of screen shares too
  settingsWin.loadFile(path.join(__dirname, '..', 'settings', 'index.html'));
}

function createTrayMenu() {
  global.__tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Settings…', click: openSettings },
    { label: 'Mode', submenu: [
      { label: 'Realtime (real meetings)', type: 'radio', checked: mode === 'realtime', click: () => setMode('realtime') },
      { label: 'Demo (mock interview)', type: 'radio', checked: mode === 'demo', click: () => setMode('demo') },
    ] },
    { label: 'Open mock interview room', click: openRoom },
    { label: 'Start / stop session  (Ctrl+Shift+S)', click: () => detector.toggleManual() },
    { label: 'Show / hide overlay  (Ctrl+Shift+H)', click: () => (overlay.isVisible() ? overlay.hide() : overlay.showInactive()) },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]));
}

function createTray() {
  const img = nativeImage.createFromPath(path.join(__dirname, '..', 'build', 'icon.png')).resize({ width: 16, height: 16 });
  const tray = new Tray(img);
  tray.setToolTip('Meeting Copilot');
  global.__tray = tray; // keep a reference so it isn't garbage-collected
  createTrayMenu();
  tray.on('click', openSettings);
}

async function testKeys() {
  const out = [];
  if (!process.env.ANTHROPIC_API_KEY) out.push({ name: 'Anthropic', ok: false, note: 'no key saved' });
  else {
    try {
      await new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }).messages.create({ model: process.env.ANSWER_MODEL || 'claude-haiku-5-5', max_tokens: 1, thinking: { type: 'disabled' }, messages: [{ role: 'user', content: 'hi' }] });
      out.push({ name: 'Anthropic', ok: true, note: 'works' });
    } catch (e) { out.push({ name: 'Anthropic', ok: false, note: e.status === 401 ? 'key rejected' : /credit/i.test(e.message || '') ? 'no credit on the account' : (e.message || 'failed').slice(0, 90) }); }
  }
  if (!process.env.DEEPGRAM_API_KEY) out.push({ name: 'Deepgram', ok: false, note: 'no key saved' });
  else {
    out.push(await new Promise((resolve) => {
      const t = new StreamingSTT(process.env.DEEPGRAM_API_KEY);
      let timer;
      const done = (ok, note) => { clearTimeout(timer); t.close(); resolve({ name: 'Deepgram', ok, note }); };
      timer = setTimeout(() => done(false, 'no response (check internet)'), 8000);
      t.on('ready', () => done(true, 'works'));
      t.on('error', (e) => done(false, /401|403/.test(e.message) ? 'key rejected' : e.message.slice(0, 90)));
      t.open();
    }));
  }
  if (process.env.OPENAI_API_KEY) {
    try {
      const r = await fetch('https://api.openai.com/v1/models', { headers: { Authorization: 'Bearer ' + process.env.OPENAI_API_KEY } });
      out.push({ name: 'OpenAI', ok: r.ok, optional: true, note: r.ok ? 'works' : r.status === 401 ? 'key rejected (optional, Claude is used instead)' : 'error ' + r.status });
    } catch { out.push({ name: 'OpenAI', ok: false, optional: true, note: 'unreachable' }); }
  }
  return out;
}

function registerSettingsIpc() {
  const packNames = () => { try { return fs.readdirSync(paths.prep).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, '')); } catch { return []; } };
  ipcMain.handle('s:state', () => ({ keys: config.has(), packs: packNames(), license: license.status(mode === 'demo' ? 'demo' : 'realtime'), buyUrl: BUY_URL, mode }));
  ipcMain.handle('s:activate', (_e, key) => {
    const r = license.activate(key);
    if (r.ok) { detector.current = null; detector.tick(); } // let a waiting meeting start right away
    return r;
  });
  ipcMain.handle('s:buy', () => { if (/^https:\/\//.test(BUY_URL)) shell.openExternal(BUY_URL); });
  ipcMain.handle('s:save', async (_e, k) => {
    config.saveKeys(k || {});
    build(); // rebuild answerer with the new keys
    return { results: await testKeys() };
  });
  ipcMain.handle('s:pick', async () => {
    const r = await dialog.showOpenDialog(settingsWin, { properties: ['openFile'], filters: [{ name: 'Resume', extensions: ['pdf', 'docx', 'txt', 'md'] }] });
    return r.canceled ? null : r.filePaths[0];
  });
  ipcMain.handle('s:prep', async (_e, { resumeFile, jdText, name }) => {
    try {
      const safe = String(name || 'my-pack').replace(/[^\w-]+/g, '-').slice(0, 40) || 'my-pack';
      const r = await generatePack({ resumeFile, jdText, name: safe, outFile: path.join(paths.prep, safe + '.json'), apiKey: process.env.ANTHROPIC_API_KEY, model: process.env.PREP_MODEL });
      await prep.load();
      return { ok: true, items: r.items, role: r.role };
    } catch (e) { return { ok: false, error: e.message }; }
  });
  ipcMain.handle('s:open', (_e, which) => shell.openPath(which === 'prep' ? paths.prep : paths.docs));
  ipcMain.handle('s:session', () => detector.toggleManual());
}
