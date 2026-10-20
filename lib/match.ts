import { Profile } from "./types";

/** Vocabulary used to detect skills in resumes and job descriptions. Extend freely. */
export const KNOWN_SKILLS = [
  "javascript", "typescript", "react", "next.js", "node.js", "express", "angular", "vue",
  "html", "css", "tailwind", "redux", "graphql", "rest", "python", "django", "flask", "fastapi",
  "java", "spring boot", "spring", "kotlin", "c#", ".net", "c++", "go", "rust", "php", "laravel",
  "ruby", "rails", "sql", "mysql", "postgresql", "mongodb", "redis", "elasticsearch", "kafka",
  "aws", "azure", "gcp", "docker", "kubernetes", "terraform", "jenkins", "ci/cd", "git", "linux",
  "microservices", "agile", "scrum", "jira", "selenium", "cypress", "jest", "junit", "testing",
  "machine learning", "deep learning", "nlp", "pandas", "numpy", "tensorflow", "pytorch",
  "data analysis", "power bi", "tableau", "excel", "spark", "hadoop", "airflow", "etl",
  "android", "ios", "swift", "flutter", "react native", "devops", "salesforce", "sap",
];

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Whole-word-ish check so "go" doesn't match "google" and "java" doesn't match "javascript". */
function mentions(text: string, skill: string): boolean {
  const re = new RegExp(`(^|[^a-z0-9+#.])${escapeRegex(skill)}($|[^a-z0-9+#])`, "i");
  return re.test(text);
}

export function extractSkills(text: string): string[] {
  return KNOWN_SKILLS.filter((s) => mentions(text, s));
}

export interface MatchResult {
  percent: number;
  jdSkills: string[];
  matchedSkills: string[];
}

/**
 * Match score (0-100):
 *  - 70% skill coverage: share of the JD's skills that you have
 *  - 20% title relevance: overlap between your target roles and the job title
 *  - 10% experience fit: penalises JDs asking for much more experience than you have
 * Falls back gracefully when the JD lists no recognisable skills.
 */
export function scoreJob(
  profile: Profile,
  job: { title: string; description: string }
): MatchResult {
  const mySkills = new Set(
    [...profile.skills, ...extractSkills(profile.resumeText)].map((s) => s.toLowerCase().trim())
  );
  const jdText = `${job.title}\n${job.description}`;
  const jdSkills = extractSkills(jdText);
  const matchedSkills = jdSkills.filter((s) => mySkills.has(s));

  const skillScore = jdSkills.length ? matchedSkills.length / jdSkills.length : 0.5;

  const titleWords = new Set(job.title.toLowerCase().split(/[^a-z0-9+#.]+/).filter((w) => w.length > 2));
  let titleScore = 0;
  for (const role of profile.roles) {
    const words = role.toLowerCase().split(/[^a-z0-9+#.]+/).filter((w) => w.length > 2);
    if (!words.length) continue;
    const hit = words.filter((w) => titleWords.has(w)).length / words.length;
    titleScore = Math.max(titleScore, hit);
  }

  let expScore = 1;
  // First "N years" that isn't about education ("15 years full time education").
  const m = [...job.description.matchAll(/(\d{1,2})\s*(?:\+|-\s*\d{1,2})?\s*(?:years|yrs)([^.\n]{0,40})/gi)].find(
    (x) => !/educat/i.test(x[2])
  );
  if (m) {
    const required = parseInt(m[1], 10);
    const gap = required - profile.yearsExperience;
    if (gap > 0) expScore = Math.max(0, 1 - gap / 5);
  }

  const percent = Math.round((skillScore * 0.7 + titleScore * 0.2 + expScore * 0.1) * 100);
  return { percent, jdSkills, matchedSkills };
}
