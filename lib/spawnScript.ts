import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/**
 * Starts `npm run <script>` in the background. Output goes to data/<log> (not "ignore"):
 * on Windows a child with invalid stdio handles can't start Chromium ("spawn UNKNOWN").
 */
export function spawnScript(script: string, args: string[], log: string) {
  const dir = path.join(process.cwd(), "data");
  fs.mkdirSync(dir, { recursive: true });
  const fd = fs.openSync(path.join(dir, log), "a");
  const child = spawn("npm", ["run", script, ...(args.length ? ["--", ...args] : [])], {
    shell: true,
    stdio: ["ignore", fd, fd],
    windowsHide: true,
    cwd: process.cwd(),
  });
  child.unref();
}
