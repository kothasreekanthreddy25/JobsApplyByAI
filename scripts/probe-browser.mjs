// Quick check that a visible Chromium window can open. Run: npm.cmd run probe
import { chromium } from "playwright";

try {
  const ctx = await chromium.launchPersistentContext(".browser-profiles/_probe", { headless: false });
  console.log("OK: visible browser opened");
  await new Promise((r) => setTimeout(r, 2000));
  await ctx.close();
} catch (e) {
  console.log("FAIL:", String(e).split("\n")[0]);
}
