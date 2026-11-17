const $ = (id) => document.getElementById(id);
let resumeFile = null;

function say(id, text, ok) { const e = $(id); e.textContent = text; e.className = 'msg ' + (ok === true ? 'ok' : ok === false ? 'err' : ''); }

function showLicense(l, buyUrl) {
  const b = $('licBadge'), t = $('licText');
  const mins = (sec) => (sec >= 60 ? Math.floor(sec / 60) + ' min' : sec + ' s');
  if (l.status === 'licensed') {
    b.textContent = 'active'; b.className = 'badge ok';
    t.textContent = `Licensed to ${l.email} (${l.plan}). ${l.exp ? 'Valid until ' + l.exp.slice(0, 10) + '.' : 'Lifetime license.'} Thank you!`;
  } else if (l.status === 'trial') {
    b.textContent = 'free trial'; b.className = 'badge';
    t.textContent = `Free trial: ${mins(l.trialLeftSec)} of live session time and ${l.daysLeft} day${l.daysLeft === 1 ? '' : 's'} left. Prep packs and settings always work.`;
  } else {
    b.textContent = 'license needed'; b.className = 'badge bad';
    t.textContent = `${l.reason} Enter a license key to keep using live sessions.`;
  }
  $('buy').style.display = buyUrl && l.status !== 'licensed' ? '' : 'none';
}

$('activate').onclick = async () => {
  const key = $('licKey').value.trim();
  if (!key) return say('licMsg', 'Paste your license key first.', false);
  const r = await window.app.activate(key);
  if (r.ok) { $('licKey').value = ''; say('licMsg', 'License activated. Thank you!', true); } else say('licMsg', r.reason, false);
  refresh();
};
$('buy').onclick = () => window.app.buy();

// ---- Mode toggle (Realtime / Demo) ----
let currentMode = 'realtime';
const MODE_TEXT = {
  realtime: 'Waits for a real meeting (Zoom, Teams, Meet or Webex) or <Ctrl+Shift+S>. When someone asks a question, the answer comes from your documents and prep pack first; if they do not cover it, the app asks OpenAI (when you added a key) and uses Claude as a backup.',
  demo: 'Schedules a mock interview. When the time comes, a room opens and you admit an AI interviewer. It asks random questions from the documents in your docs folder, the app hears them, and the answers appear in your hidden overlay.',
};
let lastState = null;   // latest settings state (keys saved? license?)
let keysMissing = false;
function showMode(m) {
  currentMode = m;
  $('modeReal').classList.toggle('on', m === 'realtime');
  $('modeDemo').classList.toggle('on', m === 'demo');
  $('modeText').textContent = MODE_TEXT[m].replace('<Ctrl+Shift+S>', 'Ctrl+Shift+S');
  $('demoPanel').style.display = m === 'demo' ? '' : 'none';
  applyView();
  if (m === 'demo') pollDemo();
}

// Demo mode = a clean screen: only the demo controls. Keys / license / prep / docs / hotkeys are hidden,
// except a section the demo cannot run without (missing API keys, or an expired license).
function applyView() {
  const demo = currentMode === 'demo', s = lastState;
  const show = (id, on) => { $(id).style.display = on ? '' : 'none'; };
  keysMissing = !!s && !(s.keys.anthropic && s.keys.deepgram);
  const licenseNeeded = !!s && s.license.status === 'expired';
  show('secKeys', !demo || keysMissing);
  show('secLicense', !demo || licenseNeeded);
  for (const id of ['secPrep', 'secDocs', 'secUse']) show(id, !demo);
  const note = $('dNote');
  if (demo && keysMissing) { note.style.display = ''; note.textContent = 'The demo needs your API keys once. Save them below, then you can schedule the interview.'; }
  else if (demo && licenseNeeded) { note.style.display = ''; note.textContent = 'Your trial has ended. Enter a license key below to continue.'; }
  else if (demo) { note.style.display = ''; note.textContent = 'API keys and license are already set, so they are hidden. Switch to Realtime to change them.'; }
  else note.style.display = 'none';
  $('dSchedule').disabled = demo && (keysMissing || licenseNeeded);
  $('dNow').disabled = demo && (keysMissing || licenseNeeded);
}
$('modeReal').onclick = async () => { await window.app.setMode('realtime'); showMode('realtime'); };
$('modeDemo').onclick = async () => { await window.app.setMode('demo'); showMode('demo'); };

const mmss = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
async function pollDemo(action) {
  const d = await window.app.demo(action || {});
  const t = {
    idle: 'No mock interview scheduled.',
    scheduled: `Starts in ${mmss(d.secsLeft)}. A room window will open and you will get a notification.`,
    invited: 'Ready! Open the interview room and admit the AI interviewer.',
    live: `Interview in progress: question ${d.index} of ${d.total}.`,
    done: 'Finished. Schedule another any time.',
  }[d.state] || '';
  say('dStatus', t, d.state === 'invited' || d.state === 'live' ? true : undefined);
  $('dQ').textContent = d.available
    ? `${d.available} question${d.available === 1 ? '' : 's'} found in your documents folder. The AI interviewer picks from them at random.`
    : 'No questions found yet. Click "Open questions folder" and add a file that lists interview questions (one per line).';
  $('dSchedule').disabled = d.state === 'live' || keysMissing || (lastState?.license.status === 'expired');
  return d;
}
setInterval(() => { if (currentMode === 'demo' && document.visibilityState === 'visible') pollDemo(); }, 1000);
// "Submit": schedule the interview, then close this window. A notification, the tray tooltip and the room window
// take over from here; reopen Settings from the tray icon any time.
$('dSchedule').onclick = async () => {
  const d = await pollDemo({ action: 'schedule', minutes: $('dMin').value, count: $('dCount').value, answerSec: $('dSec').value });
  if (d.state === 'scheduled') window.app.closeWindow();
};
$('dNow').onclick = async () => {
  const d = await pollDemo({ action: 'start' });
  if (d.state === 'scheduled' || d.state === 'invited') window.app.closeWindow();
};
$('dDocs').onclick = () => window.app.openFolder('docs');
$('dCancel').onclick = () => pollDemo({ action: 'cancel' });
$('dRoom').onclick = () => pollDemo({ action: 'room' });

async function refresh() {
  const s = await window.app.state();
  lastState = s;
  showMode(s.mode || 'realtime');
  showLicense(s.license, s.buyUrl);
  const k = $('keysBadge');
  const ready = s.keys.anthropic && s.keys.deepgram;
  k.textContent = ready ? 'ready' : 'keys needed';
  k.className = 'badge ' + (ready ? 'ok' : 'bad');
  $('anthropic').placeholder = s.keys.anthropic ? 'saved ✓ (type to replace)' : 'sk-ant-…';
  $('deepgram').placeholder = s.keys.deepgram ? 'saved ✓ (type to replace)' : 'paste key';
  $('openai').placeholder = s.keys.openai ? 'saved ✓ (type to replace)' : 'only used as a backup';
  const p = $('packBadge');
  p.textContent = s.packs.length ? `${s.packs.length} pack${s.packs.length > 1 ? 's' : ''}` : 'none yet';
  p.className = 'badge ' + (s.packs.length ? 'ok' : '');
  $('packList').textContent = s.packs.length ? 'Your packs: ' + s.packs.join(', ') : '';
}

$('saveKeys').onclick = async () => {
  const b = $('saveKeys'); b.disabled = true; say('keysMsg', 'Saving and testing…');
  const r = await window.app.saveKeys({ anthropic: $('anthropic').value, deepgram: $('deepgram').value, openai: $('openai').value });
  ['anthropic', 'deepgram', 'openai'].forEach((i) => ($(i).value = ''));
  const lines = r.results.map((x) => `${x.ok ? '✓' : '✗'} ${x.name}: ${x.note}`);
  say('keysMsg', lines.join('\n'), r.results.every((x) => x.ok || x.optional));
  b.disabled = false; refresh();
};

$('pickResume').onclick = async () => {
  const f = await window.app.pick();
  if (f) { resumeFile = f; $('resumeName').textContent = f.split(/[\\/]/).pop(); }
};

$('makePack').onclick = async () => {
  if (!resumeFile) return say('packMsg', 'Choose your resume first.', false);
  if ($('jd').value.trim().length < 80) return say('packMsg', 'Paste the job description (at least a few lines).', false);
  const b = $('makePack'); b.disabled = true; say('packMsg', 'Creating your prep pack… this takes about a minute.');
  const r = await window.app.makePrep({ resumeFile, jdText: $('jd').value, name: $('packName').value || 'my-pack' });
  say('packMsg', r.ok ? `Done: ${r.items} questions for "${r.role || 'your role'}". The study sheet (.md) is in the prep folder.` : 'Failed: ' + r.error, r.ok);
  b.disabled = false; refresh();
};

$('openPrep').onclick = () => window.app.openFolder('prep');
$('openDocs').onclick = () => window.app.openFolder('docs');
$('startSession').onclick = () => window.app.toggleSession();
refresh();
