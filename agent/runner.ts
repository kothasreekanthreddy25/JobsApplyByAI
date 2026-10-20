import "dotenv/config";
import { openPortalContext } from "./browser";
import { ADAPTERS } from "./portals";
import type { Page } from "playwright";
import { ensureLoggedIn } from "./auth";
import { applyOnCompanySite } from "./companySite";
import { isLoginWall, pause } from "./portals/types";
import { scoreJob } from "../lib/match";
import { addRun, getProfile, hasApplication, saveApplication, updateLastRun } from "../lib/store";
import { Portal } from "../lib/types";

const MAX_OPENED_PER_PORTAL = 60; // job pages opened (includes ones we then skip)
const PAGES_PER_SEARCH = 3; // result pages per role + location

/** "12 - 17 Yrs" -> { min: 12, max: 17 }; "5+ years" -> { min: 5, max: 99 } */
function parseExperience(text: string | undefined): { min: number; max: number } | null {
  if (!text) return null;
  const range = text.match(/(\d{1,2})\s*-\s*(\d{1,2})\s*(?:yrs|years)/i);
  if (range) return { min: +range[1], max: +range[2] };
  const plus = text.match(/(\d{1,2})\s*\+?\s*(?:yrs|years)/i);
  return plus ? { min: +plus[1], max: 99 } : null;
}

export async function runAgent(): Promise<string> {
  const profile = getProfile();
  const dryRun = (process.env.DRY_RUN ?? "true") !== "false";
  const headless = (process.env.HEADED ?? "true") === "false";

  if (!profile.roles.length) throw new Error("Add at least one target role in Settings first.");
  addRun({ startedAt: new Date().toISOString(), dryRun, summary: "running" });

  const lines: string[] = [];
  for (const portal of Object.keys(ADAPTERS) as Portal[]) {
    if (!profile.portals[portal]) continue;
    const adapter = ADAPTERS[portal];
    let applied = 0;
    let opened = 0;
    let skipped = 0;
    let external = 0;
    const ctx = await openPortalContext(portal, headless);
    try {
      const page = ctx.pages()[0] ?? (await ctx.newPage());
      page.setDefaultTimeout(20000);
      page.setDefaultNavigationTimeout(30000);
      const auth = await ensureLoggedIn(page, adapter);
      if (!auth.ok) {
        lines.push(`${portal}: ${auth.note}`);
        continue;
      }

      outer: for (const role of profile.roles) {
        for (const location of profile.locations.length ? profile.locations : [""]) {
          for (let pageNo = 1; pageNo <= PAGES_PER_SEARCH; pageNo++) {
            let stubs;
            try {
              stubs = await adapter.listJobs(page, role, location, { pageNo, years: profile.yearsExperience });
            } catch (e) {
              console.error(`[${portal}] search failed:`, (e as Error).message);
              break;
            }
            if (await isLoginWall(page)) {
              lines.push(`${portal}: not logged in - run "npm run agent:login"`);
              break outer;
            }
            console.log(`[${portal}] "${role}" in "${location}" page ${pageNo}: ${stubs.length} results`);
            if (!stubs.length) break;

            for (const stub of stubs) {
              if (applied >= profile.dailyLimitPerPortal || opened >= MAX_OPENED_PER_PORTAL) break outer;
              const id = `${portal}:${stub.id}`;
              if (hasApplication(id)) continue;

              // Cheap filter before opening the job: experience range shown on the search card.
              const exp = parseExperience(stub.experience);
              if (exp && (exp.min > profile.yearsExperience + 1 || exp.max < profile.yearsExperience - 4)) {
                console.log(`[${portal}] skip (needs ${stub.experience}, you have ${profile.yearsExperience}): ${stub.title}`);
                continue;
              }
              opened++;

              try {
                const description = await adapter.readDescription(page, stub);
                const m = scoreJob(profile, { title: stub.title, description });
                const base = {
                  id,
                  portal,
                  url: stub.url,
                  title: stub.title,
                  company: stub.company,
                  location: stub.location,
                  description,
                  skills: m.jdSkills,
                  matchedSkills: m.matchedSkills,
                  matchPercent: m.percent,
                  appliedAt: new Date().toISOString(),
                };

                if (m.percent < profile.minMatch) {
                  saveApplication({ ...base, status: "skipped_low_match" });
                  skipped++;
                  continue;
                }
                // Can't be applied to in-portal: keep it for manual apply, but don't spend the quota on it.
                if (adapter.isExternalApply && (await adapter.isExternalApply(page))) {
                  external++;
                  if (dryRun || !adapter.openCompanySite) {
                    const why = dryRun ? "dry run, not attempted" : "no automation for this portal";
                    saveApplication({ ...base, status: "needs_manual", note: `Applies on the company site (${why})` });
                    continue;
                  }
                  // Follow the link to the employer's site and fill in their form.
                  let site: Page | null = null;
                  try {
                    site = await adapter.openCompanySite(page);
                    const outcome = site
                      ? await applyOnCompanySite(site, profile)
                      : { status: "needs_manual" as const, note: "Could not open the company site" };
                    saveApplication({
                      ...base,
                      status: outcome.status,
                      note: outcome.status === "applied" ? "Applied on company site" : outcome.note,
                    });
                    if (outcome.status === "applied") applied++;
                    console.log(`[${portal}] company site: ${stub.title} @ ${stub.company} -> ${outcome.status} ${outcome.note ?? ""}`);
                  } finally {
                    if (site && site !== page) await site.close().catch(() => {});
                  }
                  await pause(3000, 6000);
                  continue;
                }
                if (dryRun) {
                  saveApplication({ ...base, status: "dry_run", note: "DRY_RUN on - not submitted" });
                  applied++;
                  continue;
                }
                const outcome = await adapter.apply(page);
                saveApplication({ ...base, status: outcome.status, note: outcome.note });
                if (outcome.status === "applied") applied++;
                console.log(`[${portal}] ${stub.title} @ ${stub.company} (${m.percent}%) -> ${outcome.status}`);
              } catch (e) {
                console.error(`[${portal}] error on ${stub.url}:`, (e as Error).message);
              }
              await pause(3000, 7000);
            }
          }
        }
      }
      lines.push(
        `${portal}: ${dryRun ? "matched" : "applied"} ${applied}, company-site tried ${external}, below threshold ${skipped}, opened ${opened}`
      );
    } catch (e) {
      lines.push(`${portal}: error - ${(e as Error).message}`);
    } finally {
      await ctx.close().catch(() => {});
    }
  }

  const summary = lines.join(" | ") || "nothing to do";
  updateLastRun({ finishedAt: new Date().toISOString(), summary });
  console.log(summary);
  return summary;
}
