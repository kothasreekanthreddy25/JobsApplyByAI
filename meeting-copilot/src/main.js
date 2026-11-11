require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { app, BrowserWindow, globalShortcut, ipcMain, screen, session, desktopCapturer } = require('electron');
const path = require('path');
const { MeetingDetector } = require('./meetingDetector');
const { Calendar } = require('./calendar');
const { DocIndex } = require('./docs');
const { StreamingSTT } = require('./stt');
const { Answerer, isQuestion } = require('./qa');

let overlay;
let stt = null;
let clickThrough = true;
const docs = new DocIndex(path.resolve(__dirname, '..', process.env.DOCS_DIR || './docs'));
const calendar = new Calendar(process.env.CALENDAR_ICS_URL);
const detector = new MeetingDetector(calendar);
const answerer = new Answerer({
  apiKey: process.env.ANTHROPIC_API_KEY,
  model: process.env.ANSWER_MODEL || 'claude-haiku-5-5',
  docs,
  openaiKey: process.env.OPENAI_API_KEY,
  openaiModel: process.env.OPENAI_MODEL,
});

const send = (ch, payload) => overlay && !overlay.isDestroyed() && overlay.webContents.send(ch, payload);

function createOverlay() {
  const { workArea } = screen.getPrimaryDisplay();
  const w = 460, h = 360;
  overlay = new BrowserWindow({
    width: w, height: h, x: workArea.x + workArea.width - w - 24, y: workArea.y + 24,
    frame: false, transparent: true, alwaysOnTop: true, skipTaskbar: true,
    resizable: true, hasShadow: false, focusable: false, show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true },
  });
  // KEY PRIVACY FEATURE: excludes this window from screen capture / screen share / recordings.
  // Windows uses WDA_EXCLUDEFROMCAPTURE; macOS uses NSWindowSharingNone.
  overlay.setContentProtection(true);
  overlay.setAlwaysOnTop(true, 'screen-saver');
  overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlay.setIgnoreMouseEvents(clickThrough, { forward: true });
  overlay.loadFile(path.join(__dirname, '..', 'overlay', 'index.html'));
  overlay.once('ready-to-show', () => overlay.showInactive());
}

function startListening(meeting) {
  const n = docs.load(meeting.title);
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
    const grew = text.length > fired.length + 12 && !fired.startsWith(text);
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

  createOverlay();
  await calendar.start();
  detector.on('start', startListening);
  detector.on('end', stopListening);
  detector.start();

  ipcMain.on('pcm', (_e, buf) => stt?.send(Buffer.from(buf)));

  const reg = (k, fn) => globalShortcut.register(k, fn);
  reg('Control+Shift+H', () => (overlay.isVisible() ? overlay.hide() : overlay.showInactive()));
  reg('Control+Shift+M', () => { clickThrough = !clickThrough; overlay.setIgnoreMouseEvents(clickThrough, { forward: true }); send('status', clickThrough ? 'Click-through ON' : 'Interactive (drag/resize)'); });
  reg('Control+Shift+S', () => detector.toggleManual()); // force start/stop a session
  reg('Control+Shift+Q', () => app.quit());
});

app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => app.quit());
