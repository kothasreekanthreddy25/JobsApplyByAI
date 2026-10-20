export type Portal = "naukri" | "linkedin" | "monster";

export type ApplyStatus =
  | "applied" // application submitted
  | "dry_run" // matched, but DRY_RUN was on so nothing was submitted
  | "needs_manual" // portal asked for extra info / external site; apply yourself
  | "skipped_low_match" // below the match threshold
  | "failed"; // error while applying

/** Details used to fill application forms on company websites. */
export interface Applicant {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  city: string;
  currentCompany: string;
  currentCtc: string;
  expectedCtc: string;
  noticePeriod: string;
  linkedin: string;
  /** Tick "I agree to the privacy policy / terms" boxes on company forms. Off unless you opt in. */
  agreeToTerms: boolean;
}

export interface Profile {
  name: string;
  applicant: Applicant;
  /** Saved copy of the uploaded resume file (attached to company-site applications) */
  resumePath?: string;
  /** Job titles / search keywords, e.g. "Full Stack Developer" */
  roles: string[];
  locations: string[];
  skills: string[];
  yearsExperience: number;
  /** Free-text resume; used for skill extraction and title matching */
  resumeText: string;
  /** Only apply when match % >= this */
  minMatch: number;
  /** Max applications per portal per run */
  dailyLimitPerPortal: number;
  portals: Record<Portal, boolean>;
}

export interface Application {
  id: string; // `${portal}:${jobId}`
  portal: Portal;
  url: string;
  title: string;
  company: string;
  location: string;
  description: string;
  skills: string[]; // skills required by the JD (known skills found in it)
  matchedSkills: string[];
  matchPercent: number;
  status: ApplyStatus;
  note?: string;
  appliedAt: string; // ISO timestamp of the attempt
}

export interface RunLog {
  startedAt: string;
  finishedAt?: string;
  dryRun: boolean;
  summary: string;
}

export interface Db {
  applications: Application[];
  runs: RunLog[];
}

export const DEFAULT_APPLICANT: Applicant = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  city: "",
  currentCompany: "",
  currentCtc: "",
  expectedCtc: "",
  noticePeriod: "",
  linkedin: "",
  agreeToTerms: false,
};

export const DEFAULT_PROFILE: Profile = {
  name: "",
  applicant: DEFAULT_APPLICANT,
  roles: ["Software Engineer"],
  locations: ["Bengaluru"],
  skills: [],
  yearsExperience: 0,
  resumeText: "",
  minMatch: 60,
  dailyLimitPerPortal: 10,
  portals: { naukri: true, linkedin: true, monster: true },
};
