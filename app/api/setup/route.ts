import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { resumeFileToText, saveResumeFile } from "@/lib/resumeFile";
import { profileFromResume } from "@/lib/resumeProfile";
import { spawnScript } from "@/lib/spawnScript";
import { applySchedule, taskExists } from "@/lib/scheduler";
import {
  getConnections,
  getCredentialSummary,
  getProfile,
  getSchedule,
  saveCredentials,
  saveProfile,
  saveSchedule,
} from "@/lib/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PORTALS = ["naukri", "linkedin", "monster"] as const;

function dryRun(): boolean {
  try {
    return !/^DRY_RUN=false/m.test(fs.readFileSync(".env", "utf8"));
  } catch {
    return true;
  }
}

export function GET() {
  const p = getProfile();
  const creds = getCredentialSummary();
  const conns = getConnections();
  const profileReady = p.resumeText.length > 50 && p.skills.length > 0;
  return NextResponse.json({
    profileReady,
    onboarded: profileReady && PORTALS.some((k) => creds[k] || conns[k]),
    profile: { name: p.name, roles: p.roles, locations: p.locations, skills: p.skills, yearsExperience: p.yearsExperience },
    portals: Object.fromEntries(
      PORTALS.map((k) => [k, { enabled: p.portals[k], username: creds[k]?.username ?? "", hasPassword: !!creds[k]?.hasPassword, connected: !!conns[k] }])
    ),
    schedule: { ...getSchedule(), active: taskExists() },
    dryRun: dryRun(),
    windows: process.platform === "win32",
  });
}

export async function POST(req: Request) {
  // Onboarding form: multipart with resume + portal credentials + schedule.
  if (req.headers.get("content-type")?.includes("multipart/form-data")) {
    const form = await req.formData();
    let profile = getProfile();

    const file = form.get("resume");
    if (file instanceof File && file.size > 0) {
      try {
        profile = profileFromResume(await resumeFileToText(file), profile);
        profile.resumePath = await saveResumeFile(file);
      } catch (e) {
        return NextResponse.json({ error: (e as Error).message }, { status: 422 });
      }
    } else if (profile.resumeText.length < 50) {
      return NextResponse.json({ error: "Please upload your resume" }, { status: 400 });
    }

    const portals = JSON.parse(String(form.get("portals") ?? "{}")) as Record<string, { enabled: boolean; username: string; password: string }>;
    for (const k of PORTALS) {
      const v = portals[k];
      if (!v) continue;
      profile.portals[k] = !!v.enabled;
      if (v.enabled && v.username.trim()) saveCredentials(k, v.username.trim(), v.password ?? "");
    }
    if (!PORTALS.some((k) => profile.portals[k])) {
      return NextResponse.json({ error: "Select at least one job portal" }, { status: 400 });
    }
    saveProfile(profile);

    const enabled = form.get("scheduleEnabled") === "true";
    const time = String(form.get("scheduleTime") || "09:00");
    saveSchedule({ enabled, time });
    try {
      applySchedule(enabled, time);
    } catch (e) {
      return NextResponse.json({ ok: true, warning: (e as Error).message });
    }
    return NextResponse.json({ ok: true });
  }

  const body = await req.json();

  if (body.action === "connect") {
    const portal = String(body.portal ?? "");
    if (!(PORTALS as readonly string[]).includes(portal)) {
      return NextResponse.json({ error: "Unknown portal" }, { status: 400 });
    }
    spawnScript("agent:login", [portal], "login.log");
    return NextResponse.json({ started: true });
  }

  if (body.action === "live") {
    const file = path.join(process.cwd(), ".env");
    let env = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
    const line = `DRY_RUN=${body.enabled ? "false" : "true"}`;
    env = /^DRY_RUN=.*/m.test(env) ? env.replace(/^DRY_RUN=.*/m, line) : `${env}\n${line}\n`;
    fs.writeFileSync(file, env);
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
