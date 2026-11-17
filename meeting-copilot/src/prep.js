#!/usr/bin/env node
// Prep pack generator: resume + job description -> a bank of likely interview questions with tailored answers.
// Used by the settings screen of the app, and from the command line:
//   npm run prep -- --resume path/to/resume.pdf --jd path/to/job.txt --name acme-backend
const fs = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');
const { extractText } = require('./docs');

const PROMPT = (resume, jd, n) => `You are an interview coach. Build a practice bank for ONE candidate from their resume and a job description.

Return ONLY valid JSON (no markdown fences) with this shape:
{"role":"<job title>","items":[{"category":"intro|behavioral|technical|role-fit|gaps|closing","questions":["<phrasing 1>","<phrasing 2>","<phrasing 3>","<phrasing 4>"],"headline":"<direct answer, ONE sentence, max 14 words>","points":["<max 9 words>","<max 9 words>","<max 9 words>"],"detail":"<fuller spoken answer, 60-110 words, first person, STAR format for behavioral>"}]}

Rules:
- Produce about ${n} items covering: tell me about yourself, why this company/role, strengths and weaknesses, 8+ behavioral questions tied to REAL projects on the resume, technical questions for the skills the job description asks for, how the candidate's background fits the role, any gaps or career changes, salary/notice/closing questions.
- "questions" must be 4 DIFFERENT natural ways an interviewer might ask the same thing (vary wording, not just word order; include short casual versions).
- Use ONLY facts present in the resume. Never invent employers, numbers, degrees or tools. If a metric is not in the resume, don't make one up; where it would help add "[add your metric]" in detail.
- "headline" and "points" are what the candidate glances at while speaking: short, concrete, specific.

RESUME:
${resume}

JOB DESCRIPTION:
${jd}`;

/** Generates the pack and writes <outFile> (.json used by the app) plus a readable .md study sheet. */
async function generatePack({ resumeFile, jdFile, jdText, name, outFile, apiKey, model, count = 35 }) {
  if (!apiKey) throw new Error('Add your Anthropic API key in Settings first.');
  const [resume, jd] = await Promise.all([extractText(resumeFile), jdText ? Promise.resolve(jdText) : extractText(jdFile)]);
  if (resume.trim().length < 200) throw new Error('The resume has almost no readable text (is it a scanned image?). Use a text PDF or Word file.');

  const client = new Anthropic({ apiKey });
  const msg = await client.messages.stream({
    model: model || 'claude-sonnet-5-5',
    max_tokens: 16000,
    messages: [{ role: 'user', content: PROMPT(resume.slice(0, 20000), jd.slice(0, 12000), count) }],
  }).finalMessage();
  const text = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  const a = text.indexOf('{'), b = text.lastIndexOf('}');
  if (a < 0 || b < 0) throw new Error('The AI did not return a usable pack. Please try again.');
  const json = JSON.parse(text.slice(a, b + 1));

  const items = (json.items || []).filter((i) => i.questions?.length && i.headline);
  if (!items.length) throw new Error('The AI returned no questions. Please try again.');
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify({ name, role: json.role, generated: new Date().toISOString(), resume: resume.slice(0, 6000), items }, null, 2));

  const md = [`# Prep pack: ${json.role || name}`, ''];
  for (const i of items) {
    md.push(`## [${i.category}] ${i.questions[0]}`, `_Also asked as:_ ${i.questions.slice(1).join(' / ')}`, '', `**${i.headline}**`, ...(i.points || []).map((p) => `- ${p}`), '', i.detail || '', '');
  }
  fs.writeFileSync(outFile.replace(/\.json$/, '.md'), md.join('\n'));
  return { outFile, items: items.length, role: json.role };
}

module.exports = { generatePack };

// ---- command line ----
if (require.main === module) {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
  const arg = (k) => { const i = process.argv.indexOf('--' + k); return i > -1 ? process.argv[i + 1] : null; };
  const resumeFile = arg('resume'), jdFile = arg('jd');
  if (!resumeFile || !jdFile) { console.error('Usage: npm run prep -- --resume <file> --jd <file> [--name <pack-name>] [--out <file.json>] [--count 35]'); process.exit(1); }
  const name = (arg('name') || path.basename(resumeFile, path.extname(resumeFile))).replace(/[^\w-]+/g, '-');
  const outFile = arg('out') || path.join(__dirname, '..', process.env.PREP_DIR || 'prep', name + '.json');
  console.log('Generating with Claude (30-90 s)...');
  generatePack({ resumeFile, jdFile, name, outFile, apiKey: process.env.ANTHROPIC_API_KEY, model: process.env.PREP_MODEL, count: +(arg('count') || 35) })
    .then((r) => console.log(`Saved ${r.items} items -> ${r.outFile}`))
    .catch((e) => { console.error('Prep failed:', e.message); process.exit(1); });
}
