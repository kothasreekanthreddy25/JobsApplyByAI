import { PortalAdapter, pause } from "./types";

// Searches Easy Apply jobs only (f_AL=true); external applications can't be automated.
export const linkedin: PortalAdapter = {
  name: "linkedin",
  loginUrl: "https://www.linkedin.com/login",

  async login(page, username, password) {
    await page.goto(this.loginUrl, { waitUntil: "domcontentloaded" });
    await page.locator("#username").fill(username);
    await page.locator("#password").fill(password);
    await page.locator("button[type='submit']").first().click();
  },

  async listJobs(page, role, location, { pageNo }) {
    if (pageNo > 1) return [];
    const q = new URLSearchParams({ keywords: role, location, f_AL: "true", f_TPR: "r86400" });
    await page.goto(`https://www.linkedin.com/jobs/search/?${q}`, { waitUntil: "domcontentloaded" });
    await pause(3000, 5000);
    return page.$$eval('a[href*="/jobs/view/"]', (links) => {
      const seen = new Set<string>();
      const out: { id: string; url: string; title: string; company: string; location: string }[] = [];
      for (const a of links as HTMLAnchorElement[]) {
        const m = a.href.match(/\/jobs\/view\/(?:[^/?]*-)?(\d+)/);
        if (!m || seen.has(m[1])) continue;
        seen.add(m[1]);
        const card = a.closest("li, .job-card-container");
        out.push({
          id: m[1],
          url: `https://www.linkedin.com/jobs/view/${m[1]}/`,
          title: (a.getAttribute("aria-label") || a.textContent || "").trim().split("\n")[0],
          company:
            card?.querySelector(".artdeco-entity-lockup__subtitle, .job-card-container__primary-description")
              ?.textContent?.trim() ?? "",
          location:
            card?.querySelector(".artdeco-entity-lockup__caption, .job-card-container__metadata-item")
              ?.textContent?.trim() ?? "",
        });
      }
      return out;
    });
  },

  async readDescription(page, job) {
    await page.goto(job.url, { waitUntil: "domcontentloaded" });
    await pause();
    const jd = page.locator(".jobs-description__content, #job-details, .jobs-box__html-content").first();
    return (await jd.innerText({ timeout: 8000 }).catch(() => "")).trim();
  },

  async apply(page) {
    const easy = page.locator("button.jobs-apply-button:has-text('Easy Apply'), button:has-text('Easy Apply')").first();
    if (!(await easy.isVisible().catch(() => false))) {
      return { status: "needs_manual", note: "No Easy Apply button (external apply or already applied)" };
    }
    await easy.click();
    await pause(1500, 2500);

    const modal = page.locator(".jobs-easy-apply-modal, [role='dialog']").first();
    for (let step = 0; step < 8; step++) {
      const submit = modal.locator("button:has-text('Submit application')").first();
      if (await submit.isVisible().catch(() => false)) {
        // Untick "follow company" so we don't change account state unnecessarily.
        await modal.locator("label[for*='follow-company']").click({ timeout: 1000 }).catch(() => {});
        await submit.click();
        await pause(2000, 3500);
        await page.locator("button[aria-label='Dismiss'], button:has-text('Done')").first().click().catch(() => {});
        return { status: "applied" };
      }
      const next = modal.locator("button:has-text('Review'), button:has-text('Next'), button:has-text('Continue')").first();
      if (!(await next.isVisible().catch(() => false))) break;
      await next.click();
      await pause(1200, 2200);
      // Required questions that remain unanswered => a human has to fill them in.
      if (await modal.locator(".artdeco-inline-feedback--error").first().isVisible().catch(() => false)) {
        await closeModal(page);
        return { status: "needs_manual", note: "Application asks extra questions" };
      }
    }
    await closeModal(page);
    return { status: "needs_manual", note: "Multi-step form could not be completed automatically" };
  },
};

async function closeModal(page: import("playwright").Page) {
  await page.locator("button[aria-label='Dismiss']").first().click().catch(() => {});
  await page.locator("button:has-text('Discard')").first().click({ timeout: 2000 }).catch(() => {});
}
