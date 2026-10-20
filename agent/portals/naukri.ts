import { JobStub, PortalAdapter, pause, slug } from "./types";

// NOTE: portal markup changes often. If the agent finds 0 jobs, update these selectors.
export const naukri: PortalAdapter = {
  name: "naukri",
  loginUrl: "https://www.naukri.com/nlogin/login",

  async login(page, username, password) {
    await page.goto(this.loginUrl, { waitUntil: "domcontentloaded" });
    const user = page
      .locator("#usernameField, input[placeholder*='Email' i], input[placeholder*='Username' i]")
      .first();
    await user.waitFor({ state: "visible", timeout: 20000 });
    await user.click();
    await user.pressSequentially(username, { delay: 40 });
    const pass = page.locator("#passwordField, input[type='password']").first();
    await pass.click();
    await pass.pressSequentially(password, { delay: 40 });
    await page.locator("button[type='submit'], button:has-text('Login')").first().click();
  },

  async listJobs(page, role, location, { pageNo, years }) {
    const base = `https://www.naukri.com/${slug(role)}-jobs-in-${slug(location)}${pageNo > 1 ? `-${pageNo}` : ""}`;
    await page.goto(`${base}?experience=${Math.max(0, Math.round(years))}`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".srp-jobtuple-wrapper, .jobTuple", { timeout: 15000 }).catch(() => {});
    return page.$$eval(".srp-jobtuple-wrapper, .jobTuple", (cards) =>
      cards.flatMap((c) => {
        const a = c.querySelector<HTMLAnchorElement>("a.title");
        if (!a) return [];
        const url = a.href;
        return [
          {
            id: url.split("-").pop()!.split("?")[0],
            url,
            title: a.textContent?.trim() ?? "",
            company: c.querySelector("a.comp-name, .comp-name")?.textContent?.trim() ?? "",
            location: c.querySelector(".locWraper, .loc, .location")?.textContent?.trim() ?? "",
            experience: c.querySelector(".expwdth, .exp-wrap, [class*='exp']")?.textContent?.trim() ?? "",
          },
        ];
      })
    );
  },

  async readDescription(page, job: JobStub) {
    await page.goto(job.url, { waitUntil: "domcontentloaded" });
    await pause();
    const jd = page.locator('[class*="JDC__dang-inner-html"], [class*="job-desc"], .dang-inner-html').first();
    return (await jd.innerText({ timeout: 8000 }).catch(() => "")).trim();
  },

  async isExternalApply(page) {
    return page
      .locator("#company-site-button, button:has-text('Apply on company site')")
      .first()
      .isVisible()
      .catch(() => false);
  },

  async openCompanySite(page) {
    const btn = page.locator("#company-site-button, button:has-text('Apply on company site')").first();
    if (!(await btn.isVisible().catch(() => false))) return null;
    const popup = page.context().waitForEvent("page", { timeout: 12000 }).catch(() => null);
    const oldUrl = page.url();
    await btn.click();
    const opened = await popup;
    if (opened) return opened;
    await pause(2500, 4000);
    return page.url() !== oldUrl ? page : null; // opened in the same tab
  },

  async apply(page) {
    if (await this.isExternalApply!(page)) return { status: "needs_manual", note: "Applies on the company site" };
    const btn = page.locator("#apply-button, button:has-text('Apply')").first();
    if (!(await btn.isVisible().catch(() => false))) {
      return { status: "failed", note: "Apply button not found (already applied or not logged in?)" };
    }
    await btn.click();
    await pause(2500, 4500);
    // Some jobs open a recruiter questionnaire/chatbot that needs human answers.
    if (await page.locator('[class*="chatbot"], [id*="chatbot"], .qsb').first().isVisible().catch(() => false)) {
      return { status: "needs_manual", note: "Recruiter questions require manual answers" };
    }
    const ok =
      (await page
        .getByText(/applied successfully|successfully applied|you have applied|application sent/i)
        .first()
        .isVisible()
        .catch(() => false)) ||
      (await page.locator("#applied-button, button:has-text('Applied')").first().isVisible().catch(() => false));
    return ok ? { status: "applied" } : { status: "needs_manual", note: "Could not confirm submission" };
  },
};
