// Runs automatically after `npm install`: creates .env and downloads the Playwright browser.
import fs from "node:fs";
import { spawnSync } from "node:child_process";

if (!fs.existsSync(".env") && fs.existsSync(".env.example")) {
  fs.copyFileSync(".env.example", ".env");
  console.log("Created .env (DRY_RUN=true).");
}
fs.mkdirSync("data", { recursive: true });

console.log("Installing Playwright Chromium (one time)...");
const r = spawnSync("npx", ["playwright", "install", "chromium"], { stdio: "inherit", shell: true });
if (r.status !== 0) console.warn("Playwright browser install failed; run: npx playwright install chromium");
