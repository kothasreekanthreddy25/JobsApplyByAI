import type { Page } from "playwright";
import type { ApplyStatus, Portal } from "../../lib/types";

export interface JobStub {
  id: string;
  url: string;
  title: string;
  company: string;
  location: string;
  /** Experience range shown on the search card, e.g. "12-17 Yrs" */
  experience?: string;
}

export interface ApplyOutcome {
  status: Extract<ApplyStatus, "applied" | "needs_manual" | "failed">;
  note?: string;
}

export interface PortalAdapter {
  name: Portal;
  loginUrl: string;
  /** Fills the portal's login form. May be blocked by CAPTCHA/OTP; the caller verifies the result. */
  login(page: Page, username: string, password: string): Promise<void>;
  /** Search results for one role + location. */
  listJobs(page: Page, role: string, location: string, opts: { pageNo: number; years: number }): Promise<JobStub[]>;
  /** True when the open job only applies on the employer's own site. */
  isExternalApply?(page: Page): Promise<boolean>;
  /** Clicks through to the employer's site and returns the page showing it (a new tab or the same one). */
  openCompanySite?(page: Page): Promise<Page | null>;
  /** Navigates to the job and returns its description text. */
  readDescription(page: Page, job: JobStub): Promise<string>;
  /** Assumes the job page is already open (readDescription was just called). */
  apply(page: Page): Promise<ApplyOutcome>;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Human-ish pause between actions; also keeps request rate low. */
export const pause = (min = 1500, max = 4000) => sleep(min + Math.random() * (max - min));

export const slug = (s: string) =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export async function isLoginWall(page: Page): Promise<boolean> {
  if (/login|signin|authwall|uas\/login|checkpoint|captcha|challenge/i.test(page.url())) return true;
  return page.locator('input[type="password"]').first().isVisible().catch(() => false);
}
