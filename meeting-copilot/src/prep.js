#!/usr/bin/env node
// Prep pack generator: resume + job description -> a bank of likely interview questions with tailored answers.
// Run ONCE, before practice (needs internet + ANTHROPIC_API_KEY). The live app then answers from this bank
// locally and instantly, with no AI call, whenever the incoming question matches one of the prepared ones.
//
//   npm run prep -- --resume path/to/resume.pdf --jd path/to/job.txt --name acme-backend
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');
const { extractText } = require('./docs');

const arg = (k) => { const i = process.argv.indexOf('--' + k); return i > -1 ? process.argv[i + 1] : null; };

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

async function main() {
  const resumeFile = arg('resume'), jdFile = arg('jd');
  if (!resumeFile || !jdFile) {
    console.error('Usage: npm run prep -- --resume <file> --jd <file> [--name <pack-name>] [--count 35]');
    process.exit(1);
  }
  if (!process.env.ANTHROPIC_API_KEY) { console.error('Set ANTHROPIC_API_KEY in .env'); process.exit(1); }
  const name = (arg('name') || path.basename(resumeFile, path.extname(resumeFile))).replace(/[^\w-]+/g, '-');
  const count = +(arg('count') || 35);
  const [resume, jd] = await Promise.all([extractText(resumeFile), extractText(jdFile)]);
  if (resume.trim().length < 200) console.warn('Warning: resume text looks very short (scanned PDF?).');

  console.log(`Generating ~${count} Q&A items with Claude (takes 30-90 s)...`);
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const stream = client.messages.stream({
    model: process.env.PREP_MODEL || 'claude-sonnet-5-5',
    max_tokens: 16000,
    messages: [{ role: 'user', content: PROMPT(resume.slice(0, 20000), jd.slice(0, 12000), count) }],
  });
  const msg = await stream.finalMessage();
  const text = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  const json = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));

  const items = (json.items || []).filter((i) => i.questions?.length && i.headline);
  const outFile = arg('out') || path.join(__dirname, '..', process.env.PREP_DIR || 'prep', name + '.json');
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify({ name, role: json.role, generated: new Date().toISOString(), resume: resume.slice(0, 6000), items }, null, 2));

  // A readable study sheet next to the JSON.
  const md = [`# Prep pack: ${json.role || name}`, ''];
  for (const i of items) {
    md.push(`## [${i.category}] ${i.questions[0]}`, `_Also asked as:_ ${i.questions.slice(1).join(' / ')}`, '', `**${i.headline}**`, ...(i.points || []).map((p) => `- ${p}`), '', i.detail || '', '');
  }
  fs.writeFileSync(outFile.replace(/\.json$/, '.md'), md.join('\n'));
  console.log(`Saved ${items.length} items -> ${outFile}\nStudy sheet     -> ${outFile.replace(/\.json$/, '.md')}`);
}

main().catch((e) => { console.error('Prep failed:', e.message); process.exit(1); });
