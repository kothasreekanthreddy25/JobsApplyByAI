const $ = (id) => document.getElementById(id);
const mmss = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
let speakingNow = false;

function show(ids) { for (const id of ['startNow', 'admit', 'next', 'end', 'cancel', 'openReviews']) $(id).classList.toggle('hidden', !ids.includes(id)); }

function render(s) {
  const pill = $('pill'), ai = $('aiTile'), cap = $('caption');
  $('prog').style.width = s.total ? Math.round(((s.state === 'done' ? s.total : s.index - 1 + (speakingNow ? 0.5 : 1)) / s.total) * 100) + '%' : '0';
  ai.classList.toggle('empty', s.state !== 'live' && s.state !== 'done');
  ai.classList.toggle('speaking', speakingNow);
  if (s.state === 'idle') {
    pill.textContent = 'not started'; pill.className = 'pill'; $('aiName').textContent = 'AI Interviewer (waiting)';
    cap.className = 'caption dim'; cap.textContent = 'No mock interview is scheduled.'; $('info').textContent = '';
    show(['startNow']);
  } else if (s.state === 'scheduled') {
    pill.textContent = 'scheduled'; pill.className = 'pill wait';
    cap.className = 'caption dim'; cap.textContent = `Your mock interview starts in ${mmss(s.secsLeft)}.`;
    $('info').textContent = 'The AI interviewer will ask you to admit it when the time comes.';
    show(['startNow', 'cancel']);
  } else if (s.state === 'invited') {
    pill.textContent = 'AI interviewer is waiting'; pill.className = 'pill wait';
    cap.className = 'caption'; cap.textContent = 'The AI interviewer would like to join. Admit it to begin.';
    $('info').textContent = 'It will ask you random questions from your documents folder.';
    show(['admit', 'cancel']);
  } else if (s.state === 'live') {
    pill.textContent = 'live'; pill.className = 'pill live'; $('aiName').textContent = 'AI Interviewer';
    $('info').textContent = s.total ? `Question ${s.index} of ${s.total}` : 'Starting…';
    show(['next', 'end']);
  } else if (s.state === 'done') {
    pill.textContent = 'finished'; pill.className = 'pill'; $('aiName').textContent = 'AI Interviewer (left)';
    cap.className = 'caption dim'; cap.textContent = 'The interview is over. Well done!'; $('info').textContent = '';
    show(['startNow']); $('startNow').textContent = 'Practise again';
  }
  if (s.state === 'live' || s.state === 'invited' || s.state === 'scheduled') hideReview();
  else if (!$('review').classList.contains('hidden')) $('caption').classList.add('hidden'); // keep the caption out of the way of the scorecard
  if (s.state !== 'done') $('startNow').textContent = s.state === 'scheduled' ? 'Start now' : 'Start now';
}

async function poll() { render(await window.room.state()); }
$('startNow').onclick = async () => { await window.room.startNow(); poll(); };
$('admit').onclick = async () => { await window.room.admit(); poll(); };
$('next').onclick = () => window.room.next();
$('end').onclick = async () => { await window.room.end(); poll(); };
$('cancel').onclick = async () => { await window.room.cancel(); poll(); };
$('openReviews').onclick = () => window.room.openReviews();
setInterval(poll, 500); poll();

// ---- Your microphone: your spoken answers are transcribed so they can be marked after the interview ----
let micStream = null, micCtx = null, micProc = null, gateUntil = 0;
async function micOn() {
  const st = $('micState');
  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } });
    micCtx = new AudioContext({ sampleRate: 16000 });
    const src = micCtx.createMediaStreamSource(micStream);
    micProc = micCtx.createScriptProcessor(2048, 1, 1);
    micProc.onaudioprocess = (e) => {
      const f = e.inputBuffer.getChannelData(0), out = new Int16Array(f.length);
      // While the AI interviewer speaks (plus a short tail) send silence, so its voice is never marked as your answer.
      const gated = speakingNow || performance.now() < gateUntil;
      let peak = 0;
      for (let i = 0; i < f.length; i++) { const v = Math.max(-1, Math.min(1, f[i])); if (Math.abs(v) > peak) peak = Math.abs(v); out[i] = gated ? 0 : v < 0 ? v * 0x8000 : v * 0x7fff; }
      $('youTile').classList.toggle('talking', !gated && peak > 0.05);
      window.room.micPcm(out.buffer);
    };
    src.connect(micProc); micProc.connect(micCtx.destination);
    st.textContent = 'microphone on'; st.className = 'mic on'; window.room.micState(true);
  } catch (e) {
    st.textContent = 'microphone blocked'; st.className = 'mic bad'; window.room.micState(false);
  }
}
function micOff() {
  try { micProc?.disconnect(); micStream?.getTracks().forEach((t) => t.stop()); micCtx?.close(); } catch { /* already closed */ }
  micProc = micStream = micCtx = null; $('youTile').classList.remove('talking');
  if (!$('micState').classList.contains('bad')) { $('micState').textContent = 'microphone off'; $('micState').className = 'mic'; }
}
window.room.onMic(({ on }) => (on ? micOn() : micOff()));

// ---- The review: marks and pronunciation ----
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const list = (a) => (a && a.length ? '<ul>' + a.map((x) => '<li>' + esc(x) + '</li>').join('') + '</ul>' : '');
function hideReview() { $('review').classList.add('hidden'); document.querySelector('.stage').classList.remove('hidden'); $('caption').classList.remove('hidden'); document.querySelector('.progress').classList.remove('hidden'); }
function showReview(html) {
  $('review').innerHTML = html; $('review').classList.remove('hidden');
  document.querySelector('.stage').classList.add('hidden'); $('caption').classList.add('hidden'); document.querySelector('.progress').classList.add('hidden');
}
function renderReview(rv) {
  if (rv.working) return showReview('<h2>Marking your interview…</h2><p>Reading your answers and checking your pronunciation. This takes a few seconds.</p>');
  if (rv.error) return showReview('<h2>Review failed</h2><p>' + esc(rv.error) + '</p>');
  const p = rv.pronunciation;
  const band = rv.band.split(' ')[0];
  let h = '<div class="score"><div class="big">' + rv.total + '<small> / ' + rv.max + '</small></div><div><span class="band ' + band + '">' + esc(rv.band) + ' · ' + rv.pct + '%</span></div></div>';
  if (rv.summary) h += '<p>' + esc(rv.summary) + '</p>';
  if (rv.topTips.length) h += '<h3>Top tips</h3>' + list(rv.topTips);
  if (rv.gradeError) h += '<p class="note">Marking was not possible for some answers: ' + esc(rv.gradeError) + '</p>';
  h += '<h3>Your answers</h3>';
  for (const a of rv.answers) {
    h += '<div class="card"><div class="qh"><span>Q' + a.n + '. ' + esc(a.q) + '</span><span class="sc">' + a.score + ' / 10</span></div><div>' + esc(a.verdict) + '</div>';
    if (a.strengths.length) h += '<div class="tag">Good</div>' + list(a.strengths);
    if (a.improve.length) h += '<div class="tag">Improve</div>' + list(a.improve);
    if (a.missing.length) h += '<div class="tag">Missing points</div>' + list(a.missing);
    if (a.transcript) h += '<div class="said">You said: “' + esc(a.transcript) + '”</div>';
    h += '</div>';
  }
  h += '<h3>Pronunciation and delivery</h3><div class="metrics">' +
    '<div class="metric"><b>' + p.clarity + ' / 10</b><span>pronunciation clarity (estimated)</span></div>' +
    '<div class="metric"><b>' + (p.wpm || '–') + '</b><span>words per minute</span></div>' +
    '<div class="metric"><b>' + p.fillerCount + '</b><span>filler words (um, uh)</span></div>' +
    '<div class="metric"><b>' + p.longPauses + '</b><span>long pauses (over 2 s)</span></div></div>';
  h += '<p>' + esc(p.paceNote) + '</p>';
  if (p.lowWords.length) h += '<div class="tag">Words to practise (the recogniser was unsure of them)</div>' + list(p.lowWords.map((w) => w.word + ': understood ' + Math.round(w.confidence * 100) + '% of the time (said ' + w.count + 'x)'));
  if (p.advice) h += '<div class="tag">Coach advice</div><p style="white-space:pre-line">' + esc(p.advice) + '</p>';
  h += '<p class="note">Pronunciation is estimated from speech-recognition confidence, pace, pauses and filler words. It is a guide, not a phoneme-level assessment.' + (rv.file ? ' A copy was saved: ' + esc(rv.file) : '') + '</p>';
  showReview(h);
  $('openReviews').classList.toggle('hidden', !rv.file);
}
window.room.onReview(renderReview);
window.room.lastReview().then((rv) => { if (rv && !rv.working) renderReview(rv); });

// ---- The interviewer's voice. Plays through the default output so the app's own listener hears it like a real call. ----
window.room.onSpeak(({ id, text, audio }) => {
  $('caption').className = 'caption'; $('caption').textContent = text;
  speakingNow = true;
  const finish = () => { speakingNow = false; gateUntil = performance.now() + 700; window.room.spoken(id); };
  if (audio) {
    const a = new Audio(audio);
    a.onended = finish; a.onerror = () => speakFallback(text, finish);
    a.play().catch(() => speakFallback(text, finish));
  } else speakFallback(text, finish);
});

function speakFallback(text, done) {
  try {
    const u = new SpeechSynthesisUtterance(text);
    const v = speechSynthesis.getVoices().find((x) => /en[-_](US|GB|IN)/i.test(x.lang)); if (v) u.voice = v;
    u.rate = 0.98; u.onend = done; u.onerror = done;
    speechSynthesis.cancel(); speechSynthesis.speak(u);
  } catch { done(); }
}
