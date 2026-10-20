import path from "node:path";
import { chromium, BrowserContext } from "playwright";
import type { Portal } from "../lib/types";

/**
 * One persistent profile per portal: the session is reused on every run.
 * If a visible window can't be opened (e.g. no desktop session), falls back to headless,
 * which still works when saved credentials / a saved session are available.
 */
export async function openPortalContext(portal: Portal, headless: boolean): Promise<BrowserContext> {
  const open = (h: boolean) =>
    chromium.launchPersistentContext(path.join(process.cwd(), ".browser-profiles", portal), {
      headless: h,
      viewport: { width: 1366, height: 850 },
      args: ["--disable-blink-features=AutomationControlled"],
    });
  try {
    return await open(headless);
  } catch (e) {
    if (headless) throw e;
    console.warn(`[${portal}] could not open a visible browser (${String(e).split("\n")[0]}); using headless.`);
    return open(true);
  }
}
