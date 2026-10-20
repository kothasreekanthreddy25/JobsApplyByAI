import "dotenv/config";
import cron from "node-cron";
import { runAgent } from "./runner";

const expr = process.env.CRON_SCHEDULE || "0 9 * * *";
let running = false;

cron.schedule(expr, async () => {
  if (running) return;
  running = true;
  try {
    await runAgent();
  } catch (e) {
    console.error("Run failed:", e);
  } finally {
    running = false;
  }
});

console.log(`Daily job agent scheduled (${expr}). Keep this process running.`);
