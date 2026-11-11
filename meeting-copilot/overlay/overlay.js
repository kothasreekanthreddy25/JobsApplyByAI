const $ = (id) => document.getElementById(id);
let stream, ctx, proc, t0 = 0, first = false;

window.copilot.on('status', (s) => {
  $('status').textContent = s;
  $('card').classList.toggle('live', /^Listening/.test(s));
});
window.copilot.on('meeting', (m) => { $('meeting').textContent = m ? `${m.app} · ${m.docChunks} doc chunks` : ''; });
window.copilot.on('heard', (t) => { $('heard').textContent = '… ' + t.slice(-160); });
window.copilot.on('answer-start', (q) => {
  t0 = performance.now(); first = false;
  $('q').textContent = 'Q: ' + q;
  $('a').textContent = '';
  $('lat').textContent = '';
});
window.copilot.on('answer-delta', (d) => {
  if (!first) { first = true; $('lat').textContent = `first token ${Math.round(performance.now() - t0)}ms after question end`; }
  $('a').textContent += d;
});
window.copilot.on('answer-done', (err) => { if (err) $('a').textContent += '\n[error] ' + err; });

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
  } catch (e) { $('status').textContent = 'Audio capture failed: ' + e.message; }
});
