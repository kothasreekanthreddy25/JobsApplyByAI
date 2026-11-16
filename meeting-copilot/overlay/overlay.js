const $ = (id) => document.getElementById(id);
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
  const lines = raw.split('\n').map((l) => l.replace(/^\s*[-•*]\s*/, '').replace(/\[\d+\]/g, '').trim()).filter(Boolean);
  $('hint').style.display = lines.length ? 'none' : '';
  $('head').textContent = lines[0] || '';
  const ul = $('pts');
  ul.textContent = '';
  for (const l of lines.slice(1)) { const li = document.createElement('li'); li.textContent = l; ul.appendChild(li); }
  fit();
}
// Auto-shrink if the answer would overflow the box, so nothing is ever cut off.
function fit() {
  const root = $('root');
  document.documentElement.style.setProperty('--fs', fs + 'px');
  for (let f = fs; f > 12 && root.scrollHeight > root.clientHeight + 1; f -= 1) {
    document.documentElement.style.setProperty('--fs', f + 'px');
  }
}
window.addEventListener('resize', fit);

// ---- Spoken answers (Windows built-in voices, plays on the default output device) ----
let voiceOn = false, pending = '', speakingCount = 0;
const synth = window.speechSynthesis;
function speak(sentence) {
  const u = new SpeechSynthesisUtterance(sentence.replace(/\[\d+\]/g, '').replace(/^\s*[-•*#]\s*/gm, ''));
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
  synth.cancel(); pending = ''; speakingCount = 0; // newest question wins
  t0 = performance.now(); first = false; raw = '';
  $('q').textContent = q;
  $('lat').textContent = '';
  render();
});
window.copilot.on('answer-delta', (d) => {
  if (!first) { first = true; $('lat').textContent = `${Math.round(performance.now() - t0)}ms`; }
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
dragger($('grip'), 'resize');

// ---- Audio capture: system loopback = the other participants' voices ----
window.copilot.on('capture', async (cmd) => {
  if (cmd === 'stop') { stream?.getTracks().forEach((t) => t.stop()); proc?.disconnect(); ctx?.close(); stream = ctx = proc = null; return; }
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
      window.copilot.pcm(out.buffer);
    };
    src.connect(proc); proc.connect(ctx.destination);
  } catch (e) { flash('Audio capture failed: ' + e.message); }
});
