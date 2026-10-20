import "dotenv/config";
import { openPortalContext } from "./browser";
import { ADAPTERS } from "./portals";
import { isLoginWall, sleep } from "./portals/types";
import { getCredentials, setConnected } from "../lib/store";
import { Portal } from "../lib/types";

/**
 * Opens each portal in a visible browser, pre-fills your saved credentials, and waits for you to
 * finish (OTP / CAPTCHA). It detects the sign-in automatically and keeps the session in .browser-profiles/.
 * Usage: npm run agent:login [naukri linkedin monster]   (also started from the Setup page)
 */
async function main() {
  const requested = process.argv.slice(2) as Portal[];
  const portals = (requested.length ? requested : (Object.keys(ADAPTERS) as Portal[])).filter((p) => ADAPTERS[p]);

  for (const portal of portals) {
    const ctx = await openPortalContext(portal, false);
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    await page.goto(ADAPTERS[portal].loginUrl);

    // Pre-fill the saved credentials so you only have to handle OTP / CAPTCHA, if asked.
    const creds = getCredentials(portal);
    if (creds && (await isLoginWall(page).catch(() => true))) {
      try {
        await ADAPTERS[portal].login(page, creds.username, creds.password);
        console.log(`[${portal}] filled saved credentials.`);
      } catch (e) {
        console.log(`[${portal}] could not auto-fill the form (${String(e).split("\n")[0]}); please sign in yourself.`);
      }
    }
    console.log(`[${portal}] waiting for you to sign in (up to 5 minutes)...`);

    const deadline = Date.now() + 5 * 60 * 1000;
    let ok = false;
    while (Date.now() < deadline && !page.isClosed()) {
      await sleep(2500);
      if (!(await isLoginWall(page).catch(() => true))) {
        await sleep(3000); // let cookies settle
        if (!(await isLoginWall(page).catch(() => true))) {
          ok = true;
          break;
        }
      }
    }
    if (ok) {
      setConnected(portal);
      console.log(`[${portal}] connected.`);
    } else {
      console.log(`[${portal}] not signed in - skipped.`);
    }
    await ctx.close().catch(() => {});
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
