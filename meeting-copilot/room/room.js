const $ = (id) => document.getElementById(id);
const mmss = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
let speakingNow = false;

function show(ids) { for (const id of ['startNow', 'admit', 'next', 'end', 'cancel']) $(id).classList.toggle('hidden', !ids.includes(id)); }

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
  if (s.state !== 'done') $('startNow').textContent = s.state === 'scheduled' ? 'Start now' : 'Start now';
}

async function poll() { render(await window.room.state()); }
$('startNow').onclick = async () => { await window.room.startNow(); poll(); };
$('admit').onclick = async () => { await window.room.admit(); poll(); };
$('next').onclick = () => window.room.next();
$('end').onclick = async () => { await window.room.end(); poll(); };
$('cancel').onclick = async () => { await window.room.cancel(); poll(); };
setInterval(poll, 500); poll();

// ---- The interviewer's voice. Plays through the default output so the app's own listener hears it like a real call. ----
window.room.onSpeak(({ id, text, audio }) => {
  $('caption').className = 'caption'; $('caption').textContent = text;
  speakingNow = true;
  const finish = () => { speakingNow = false; window.room.spoken(id); };
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
