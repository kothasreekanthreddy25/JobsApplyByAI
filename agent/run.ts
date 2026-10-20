import { runAgent } from "./runner";
import { updateLastRun } from "../lib/store";

runAgent().catch((e) => {
  updateLastRun({ finishedAt: new Date().toISOString(), summary: `failed: ${(e as Error).message}` });
  console.error(e);
  process.exit(1);
});
