import { PortalAdapter, pause } from "./types";

// Monster India now operates as foundit.in. Override with MONSTER_BASE_URL if you use another region.
const BASE = process.env.MONSTER_BASE_URL || "https://www.foundit.in";

export const monster: PortalAdapter = {
  name: "monster",
  loginUrl: `${BASE}/rio/login`,

  async login(page, username, password) {
    await page.goto(this.loginUrl, { waitUntil: "domcontentloaded" });
    await page.locator("input[type='email'], input[name*='user' i], input[type='text']").first().fill(username);
    await page.locator("input[type='password']").first().fill(password);
    await page.locator("button[type='submit'], button:has-text('Login')").first().click();
  },

  async listJobs(page, role, location, { pageNo }) {
    if (pageNo > 1) return [];
    const q = new URLSearchParams({ query: role, locations: location });
    await page.goto(`${BASE}/srp/results?${q}`, { waitUntil: "domcontentloaded" });
    await pause(3000, 5000);
    return page.$$eval('a[href*="/job/"]', (links) => {
      const seen = new Set<string>();
      const out: { id: string; url: string; title: string; company: string; location: string }[] = [];
      for (const a of links as HTMLAnchorElement[]) {
        const url = a.href.split("?")[0];
        const title = (a.textContent || "").trim();
        if (!title || seen.has(url)) continue;
        seen.add(url);
        const card = a.closest(".card-apply-content, .srpResultCard, [class*='card']");
        out.push({
          id: url.split("-").pop() || url,
          url,
          title,
          company: card?.querySelector("[class*='company'], .company-name")?.textContent?.trim() ?? "",
          location: card?.querySelector("[class*='location'], .loc")?.textContent?.trim() ?? "",
        });
      }
      return out;
    });
  },

  async readDescription(page, job) {
    await page.goto(job.url, { waitUntil: "domcontentloaded" });
    await pause();
    const jd = page.locator("#jobDescription, .job-description, [class*='jobDescription'], [class*='job-desc']").first();
    return (await jd.innerText({ timeout: 8000 }).catch(() => "")).trim();
  },

  async apply(page) {
    const btn = page.locator("button:has-text('Apply Now'), button:has-text('Apply'), a:has-text('Apply Now')").first();
    if (!(await btn.isVisible().catch(() => false))) {
      return { status: "failed", note: "Apply button not found (already applied or not logged in?)" };
    }
    await btn.click();
    await pause(2500, 4500);
    const ok = await page
      .getByText(/applied successfully|successfully applied|application (has been )?submitted/i)
      .first()
      .isVisible()
      .catch(() => false);
    return ok ? { status: "applied" } : { status: "needs_manual", note: "Could not confirm submission" };
  },
};
