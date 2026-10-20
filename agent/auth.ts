import type { Page } from "playwright";
import { getCredentials, setConnected } from "../lib/store";
import type { PortalAdapter } from "./portals/types";
import { isLoginWall, sleep } from "./portals/types";

/**
 * Reuses the saved browser session when it is still valid; otherwise signs in with the
 * credentials from the onboarding form. CAPTCHA / OTP can't be automated, so those fall back to manual "Connect".
 */
export async function ensureLoggedIn(page: Page, adapter: PortalAdapter): Promise<{ ok: boolean; note: string }> {
  await page.goto(adapter.loginUrl, { waitUntil: "domcontentloaded" }).catch(() => {});
  await sleep(3500); // a valid session redirects away from the login page
  if (!(await isLoginWall(page))) {
    setConnected(adapter.name);
    return { ok: true, note: "session reused" };
  }

  const creds = getCredentials(adapter.name);
  if (!creds) return { ok: false, note: "not signed in and no saved credentials - add them on the Setup page" };

  try {
    await adapter.login(page, creds.username, creds.password);
  } catch (e) {
    return { ok: false, note: `login form not found (${(e as Error).message.split("\n")[0]})` };
  }
  await sleep(7000);
  if (await isLoginWall(page)) {
    return { ok: false, note: 'sign-in blocked (wrong password, CAPTCHA or OTP) - use "Connect" on the Setup page' };
  }
  setConnected(adapter.name);
  return { ok: true, note: "signed in" };
}
