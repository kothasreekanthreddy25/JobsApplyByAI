import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const TASK = "JobApplyAgentDaily";

export function taskExists(): boolean {
  if (process.platform !== "win32") return false;
  try {
    execFileSync("schtasks", ["/Query", "/TN", TASK], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** Creates/removes a daily Windows Task Scheduler entry that runs the agent at `time` (HH:MM). */
export function applySchedule(enabled: boolean, time: string) {
  if (process.platform !== "win32") throw new Error("Daily scheduling from the app is Windows-only; use `npm run agent:schedule`.");
  if (!enabled) {
    if (taskExists()) execFileSync("schtasks", ["/Delete", "/F", "/TN", TASK], { stdio: "ignore" });
    return;
  }
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error("Invalid time");
  const script = path.join(process.cwd(), "data", "run-agent.cmd");
  fs.mkdirSync(path.dirname(script), { recursive: true });
  fs.writeFileSync(script, `@echo off\r\ncd /d "${process.cwd()}"\r\ncall npm run agent:run\r\n`);
  execFileSync("schtasks", ["/Create", "/F", "/SC", "DAILY", "/ST", time, "/TN", TASK, "/TR", script], { stdio: "ignore" });
}
