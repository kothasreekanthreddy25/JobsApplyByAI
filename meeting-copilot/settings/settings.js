const $ = (id) => document.getElementById(id);
let resumeFile = null;

function say(id, text, ok) { const e = $(id); e.textContent = text; e.className = 'msg ' + (ok === true ? 'ok' : ok === false ? 'err' : ''); }

async function refresh() {
  const s = await window.app.state();
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
