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

async function refresh() {
  const s = await window.app.state();
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
