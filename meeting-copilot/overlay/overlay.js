const $ = (id) => document.getElementById(id);
let lastPcm = 0, silenceTimer = null;
let stream, ctx, proc, t0 = 0, first = false, raw = '', editMode = false, quietTimer, fs = 20;

// ---- Settings pushed from main (opacity, font size, locked/unlocked) ----
window.copilot.on('cfg', (c) => {
  fs = c.font;
  document.documentElement.style.setProperty('--alpha', c.opacity);
  document.documentElement.style.setProperty('--fs', c.font + 'px');
  editMode = c.interactive;
  document.body.classList.toggle('edit', editMode);
  fit();
  flash(editMode ? 'Unlocked: drag / resize' : `Locked · bg ${Math.round(c.opacity * 100)}% · font ${c.font}`);
});

// ---- Status line: tiny, and fades out so it never competes with the answer ----
function flash(text, live) {
  const foot = $('foot');
  $('status').textContent = text;
  foot.classList.toggle('live', !!live);
  foot.classList.remove('quiet');
  clearTimeout(quietTimer);
  if (!editMode) quietTimer = setTimeout(() => foot.classList.add('quiet'), 3500);
}
window.copilot.on('status', (s) => flash(s, /^Listening/.test(s)));
window.copilot.on('meeting', (m) => { $('meeting').textContent = m ? `${m.app} · ${m.docChunks} chunks` : ''; });
window.copilot.on('heard', (t) => { $('heard').textContent = '… ' + t.slice(-140); });

// ---- Answer rendering: headline (1st line, big) + short bullets (rest) ----
function render() {
  const lines = raw.split('\n').map((l) => l.replace(/^\s*[-•*]\s*/, '').replace(/\[P?\d+\]/g, '').trim()).filter(Boolean);
  $('hint').style.display = lines.length ? 'none' : '';
  $('head').textContent = lines[0] || '';
  const ul = $('pts');
  ul.textContent = '';
  for (const l of lines.slice(1)) { const li = document.createElement('li'); li.textContent = l; ul.appendChild(li); }
  fit();
}
// Nothing is ever cut off: the window grows (or shrinks) to fit the answer at your chosen font size.
// Only when the answer is taller than the space left on the screen does the font shrink as a last resort.
let lastAuto = 0;
function fit() {
  const root = $('root'), body = document.body;
  document.documentElement.style.setProperty('--fs', fs + 'px');
  const auto = !editMode && !body.classList.contains('mini'); // never fight you while you drag/resize or when minimised
  if (auto) {
    const room = Math.max(130, (screen.availTop || 0) + screen.availHeight - window.screenY - 8); // space left below the overlay's top edge
    const needed = Math.min(room, Math.ceil($('content').offsetHeight + 26 + 24)); // top padding + room for the status line
    if (Math.abs(needed - window.innerHeight) > 3 && needed !== lastAuto) { lastAuto = needed; window.copilot.win('autosize', needed); return; } // main resizes us, then 'resize' calls fit() again
  }
  for (let f = fs; f > 12 && root.scrollHeight > root.clientHeight + 1; f -= 1) {
    document.documentElement.style.setProperty('--fs', f + 'px');
  }
}
window.addEventListener('resize', () => { lastAuto = 0; fit(); });

// ---- Spoken answers (Windows built-in voices, plays on the default output device) ----
let voiceOn = false, pending = '', speakingCount = 0;
const synth = window.speechSynthesis;
function speak(sentence) {
  const u = new SpeechSynthesisUtterance(sentence.replace(/\[P?\d+\]/g, '').replace(/^\s*[-•*#]\s*/gm, ''));
  u.rate = 1.1;
  speakingCount++; window.copilot.speaking(true);
  const done = () => { if (--speakingCount <= 0) { speakingCount = 0; window.copilot.speaking(false); } };
  u.onend = done; u.onerror = done;
  synth.speak(u);
}
function feedSpeech(delta, final) {
  if (!voiceOn) return;
  pending += delta;
  const m = pending.match(/^([\s\S]*?[.!?\n])\s+([\s\S]*)$/);
  if (m) { speak(m[1]); pending = m[2]; }
  if (final && pending.trim()) { speak(pending); pending = ''; }
}
window.copilot.on('voice-toggle', () => {
  voiceOn = !voiceOn;
  if (!voiceOn) { synth.cancel(); pending = ''; speakingCount = 0; window.copilot.speaking(false); }
  flash(voiceOn ? 'Voice ON' : 'Voice OFF');
});

window.copilot.on('answer-start', (q) => {
  if (document.body.classList.contains('mini')) document.body.classList.add('ping'); // new answer while minimised: pill pulses
  synth.cancel(); pending = ''; speakingCount = 0; // newest question wins
  t0 = performance.now(); first = false; raw = ''; src = '';
  $('q').textContent = q;
  $('lat').textContent = '';
  render();
});
let src = '';
window.copilot.on('answer-meta', (m) => { src = m; $('lat').textContent = m; flash(m, true); });
window.copilot.on('answer-delta', (d) => {
  if (!first) { first = true; if (!src) $('lat').textContent = `${Math.round(performance.now() - t0)}ms`; }
  raw += d;
  render();
  feedSpeech(d, false);
});
window.copilot.on('answer-done', (err) => {
  if (err) { raw += '\n[error] ' + err; render(); }
  feedSpeech('', true);
});

// ---- Drag to move / drag corner to resize (unlocked mode only) ----
function dragger(el, kind) {
  let s = null;
  el.addEventListener('pointerdown', (e) => { el.setPointerCapture(e.pointerId); s = { x: e.screenX, y: e.screenY }; window.copilot.win('start'); });
  el.addEventListener('pointermove', (e) => { if (s) window.copilot.win(kind, { dx: e.screenX - s.x, dy: e.screenY - s.y }); });
  el.addEventListener('pointerup', () => { s = null; window.copilot.win('end'); });
}
dragger($('bar'), 'move');

// ---- Minimise / restore / close buttons ----
// While locked the window is click-through; pointing at the buttons makes just that moment clickable.
const btns = $('btns');
btns.addEventListener('mouseenter', () => window.copilot.win('hover', true));
btns.addEventListener('mouseleave', () => window.copilot.win('hover', false));
$('bMin').onclick = () => window.copilot.win('minimize');
$('bMode').onclick = () => window.copilot.win('mode');
$('bSet').onclick = () => window.copilot.win('settings');
window.copilot.on('mode', (m) => { const b = $('bMode'); b.textContent = m === 'demo' ? 'Demo' : 'Realtime'; b.className = m === 'demo' ? 'demo' : 'real'; b.title = 'Mode: ' + (m === 'demo' ? 'Demo (mock interview)' : 'Realtime (real meetings)') + '. Click to switch.'; });
$('bRestore').onclick = () => { document.body.classList.remove('ping'); window.copilot.win('restore'); };
$('bClose').onclick = () => window.copilot.win('close');
window.copilot.on('mini', (on) => { document.body.classList.toggle('mini', on); document.body.classList.remove('ping'); fit(); });
dragger($('grip'), 'resize');

// ---- Audio capture: system loopback = the other participants' voices ----
window.copilot.on('capture', async (cmd) => {
  if (cmd === 'stop') { clearInterval(silenceTimer); stream?.getTracks().forEach((t) => t.stop()); proc?.disconnect(); ctx?.close(); stream = ctx = proc = null; return; }
  if (stream) return;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    stream.getVideoTracks().forEach((t) => t.stop());
    ctx = new AudioContext({ sampleRate: 16000 });
    const src = ctx.createMediaStreamSource(new MediaStream(stream.getAudioTracks()));
    proc = ctx.createScriptProcessor(2048, 1, 1); // ~128ms chunks
    proc.onaudioprocess = (e) => {
      const f = e.inputBuffer.getChannelData(0);
      const out = new Int16Array(f.length);
      for (let i = 0; i < f.length; i++) out[i] = Math.max(-1, Math.min(1, f[i])) * 0x7fff;
      lastPcm = performance.now();
      window.copilot.pcm(out.buffer);
    };
    // Windows loopback capture delivers NOTHING while no sound is playing, so the speech recognizer would never see
    // the pauses between sentences and would glue them together. Fill quiet moments with real silence.
    lastPcm = performance.now();
    silenceTimer = setInterval(() => { if (performance.now() - lastPcm > 200) window.copilot.pcm(new Int16Array(2048).buffer); }, 128);
    src.connect(proc); proc.connect(ctx.destination);
  } catch (e) { flash('Audio capture failed: ' + e.message); }
});
