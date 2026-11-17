require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { app, BrowserWindow, globalShortcut, ipcMain, screen, session, desktopCapturer, Tray, Menu, nativeImage, dialog, shell } = require('electron');
const path = require('path');
const { MeetingDetector } = require('./meetingDetector');
const { Calendar } = require('./calendar');
const { DocIndex } = require('./docs');
const { StreamingSTT } = require('./stt');
const { Answerer, isQuestion } = require('./qa');
const { PrepBank } = require('./prepBank');
const config = require('./config');
const { generatePack } = require('./prep');
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
    try { cfg.bounds = overlay.getBounds(); fs.writeFileSync(cfgPath(), JSON.stringify(cfg)); } catch {}
  }, 400);
}
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
let docs, prep, answerer, paths;
const calendar = new Calendar(process.env.CALENDAR_ICS_URL);
const detector = new MeetingDetector(calendar);

// (Re)build everything that depends on keys and folders. Called at start and after keys change.
function build() {
  config.applyKeysToEnv();
  paths = config.paths();
  process.env.MODEL_CACHE = paths.models;
  if (app.isPackaged) process.env.MODEL_OFFLINE = '1'; // installer ships the matching model
  docs = new DocIndex(paths.docs);
  prep = new PrepBank(paths.prep);
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
  overlay.webContents.on('did-finish-load', pushCfg);
  overlay.loadFile(path.join(__dirname, '..', 'overlay', 'index.html'));
  overlay.once('ready-to-show', () => overlay.showInactive());
}

async function startListening(meeting) {
  send('status', 'Loading documents…');
  const n = await docs.load(meeting.title);
  answerer.setMeeting(meeting);
  send('meeting', { title: meeting.title, app: meeting.app, docChunks: n });
  if (!process.env.DEEPGRAM_API_KEY) return send('status', 'Set DEEPGRAM_API_KEY in .env');
  stt = new StreamingSTT(process.env.DEEPGRAM_API_KEY);
  stt.on('ready', () => { send('status', 'Listening'); send('capture', 'start'); });
  stt.on('error', (e) => send('status', 'STT error: ' + e.message));
  // Speculative answering: fire as soon as the partial transcript looks like a complete
  // question and has been stable for ~200ms, without waiting for the speaker's silence.
  let fired = '', timer = null;
  const fire = (text) => {
    fired = text;
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
  stt.open();
}

function stopListening() {
  send('capture', 'stop');
  stt?.close();
  stt = null;
  send('status', 'Idle - waiting for a meeting');
  send('meeting', null);
}

app.whenReady().then(async () => {
  // Grant system-audio loopback (what other participants say) to the renderer without a picker.
  session.defaultSession.setDisplayMediaRequestHandler(async (_req, cb) => {
    const sources = await desktopCapturer.getSources({ types: ['screen'] });
    cb({ video: sources[0], audio: 'loopback' });
  });

  build();
  createOverlay();
  createTray();
  registerSettingsIpc();
  if (!config.has().anthropic || !config.has().deepgram) openSettings(); // first run: ask for keys
  await calendar.start();
  detector.on('start', startListening);
  detector.on('end', stopListening);
  detector.start();

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

function createTray() {
  const img = nativeImage.createFromPath(path.join(__dirname, '..', 'build', 'icon.png')).resize({ width: 16, height: 16 });
  const tray = new Tray(img);
  tray.setToolTip('Meeting Copilot');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Settings…', click: openSettings },
    { label: 'Start / stop session  (Ctrl+Shift+S)', click: () => detector.toggleManual() },
    { label: 'Show / hide overlay  (Ctrl+Shift+H)', click: () => (overlay.isVisible() ? overlay.hide() : overlay.showInactive()) },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]));
  tray.on('click', openSettings);
  global.__tray = tray; // keep a reference so it isn't garbage-collected
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
  ipcMain.handle('s:state', () => ({ keys: config.has(), packs: packNames() }));
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
