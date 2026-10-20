"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

type PortalId = "naukri" | "linkedin" | "monster";
const PORTALS: { id: PortalId; label: string; hint: string }[] = [
  { id: "naukri", label: "Naukri", hint: "Email / username" },
  { id: "linkedin", label: "LinkedIn", hint: "Email or phone" },
  { id: "monster", label: "Monster (foundit.in)", hint: "Email / username" },
];

interface PortalState { enabled: boolean; username: string; password: string; hasPassword: boolean; connected: boolean }
interface Status {
  profileReady: boolean;
  onboarded: boolean;
  profile: { name: string; roles: string[]; locations: string[]; skills: string[]; yearsExperience: number };
  portals: Record<PortalId, { enabled: boolean; username: string; hasPassword: boolean; connected: boolean }>;
  schedule: { enabled: boolean; time: string; active: boolean };
  dryRun: boolean;
  windows: boolean;
}

export default function Setup() {
  const router = useRouter();
  const [st, setSt] = useState<Status | null>(null);
  const [portals, setPortals] = useState<Record<PortalId, PortalState> | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [daily, setDaily] = useState(false);
  const [time, setTime] = useState("09:00");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [warn, setWarn] = useState("");

  async function load(init: boolean) {
    const d: Status = await (await fetch("/api/setup", { cache: "no-store" })).json();
    setSt(d);
    if (init) {
      setPortals(Object.fromEntries(PORTALS.map((p) => [p.id, { ...d.portals[p.id], password: "" }])) as Record<PortalId, PortalState>);
      setDaily(d.schedule.enabled);
      setTime(d.schedule.time);
    } else {
      setPortals((cur) => cur && (Object.fromEntries(PORTALS.map((p) => [p.id, { ...cur[p.id], connected: d.portals[p.id].connected }])) as Record<PortalId, PortalState>));
    }
  }
  useEffect(() => {
    load(true);
    const t = setInterval(() => load(false), 4000);
    return () => clearInterval(t);
  }, []);

  if (!st || !portals) return <p className="muted">Loading...</p>;

  const setP = (id: PortalId, patch: Partial<PortalState>) => setPortals({ ...portals, [id]: { ...portals[id], ...patch } });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(""); setWarn("");
    for (const p of PORTALS) {
      const v = portals![p.id];
      if (v.enabled && (!v.username.trim() || (!v.password && !v.hasPassword))) {
        return setErr(`Enter the username and password for ${p.label}, or untick it.`);
      }
    }
    setBusy(true);
    const fd = new FormData();
    if (file) fd.append("resume", file);
    fd.append("portals", JSON.stringify(Object.fromEntries(PORTALS.map((p) => [p.id, { enabled: portals![p.id].enabled, username: portals![p.id].username, password: portals![p.id].password }]))));
    fd.append("scheduleEnabled", String(daily));
    fd.append("scheduleTime", time);
    const r = await fetch("/api/setup", { method: "POST", body: fd });
    const d = await r.json();
    setBusy(false);
    if (!r.ok) return setErr(d.error);
    if (d.warning) setWarn(d.warning);
    else router.push("/dashboard");
  }

  async function post(body: object) {
    await fetch("/api/setup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    load(false);
  }

  return (
    <form onSubmit={submit}>
      <h2 style={{ marginTop: 0 }}>Set up your job agent</h2>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>1. Resume</h3>
        <input type="file" accept=".pdf,.docx,.txt,.md" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        <p className="muted">PDF, DOCX or TXT. Skills, experience, roles and locations are detected from it (editable later in Profile &amp; Settings).</p>
        {st.profileReady && !file && <p>Using saved resume for <strong>{st.profile.name || "you"}</strong> ({st.profile.skills.length} skills detected). Upload again to replace it.</p>}
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>2. Job portals</h3>
        <p className="muted">
          Credentials are stored only on this computer (password encrypted with a local key) and used only to sign in to that portal.
          If a portal asks for OTP/CAPTCHA, use <em>Sign in manually</em> instead - the session is then reused.
        </p>
        {PORTALS.map((p) => {
          const v = portals[p.id];
          return (
            <div key={p.id} style={{ marginBottom: 16 }}>
              <div className="checks">
                <label><input type="checkbox" checked={v.enabled} onChange={(e) => setP(p.id, { enabled: e.target.checked })} /><strong>{p.label}</strong></label>
                {v.connected && <span className="badge s-applied">signed in</span>}
                {v.enabled && <button type="button" onClick={() => post({ action: "connect", portal: p.id })}>Sign in manually</button>}
              </div>
              {v.enabled && (
                <div className="row2">
                  <div><label>Username</label><input type="text" autoComplete="off" placeholder={p.hint} value={v.username} onChange={(e) => setP(p.id, { username: e.target.value })} /></div>
                  <div><label>Password</label><input type="password" autoComplete="new-password" placeholder={v.hasPassword ? "saved - leave blank to keep" : "Password"} value={v.password} onChange={(e) => setP(p.id, { password: e.target.value })} /></div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>3. Daily run</h3>
        <div className="checks">
          <label><input type="checkbox" checked={daily} onChange={(e) => setDaily(e.target.checked)} />Apply to matching jobs every day at</label>
          <input type="time" value={time} disabled={!daily} onChange={(e) => setTime(e.target.value)} />
        </div>
        <p className="muted">
          {st.windows ? "Uses Windows Task Scheduler; your PC must be on and logged in at that time." : "Auto-scheduling from the app is Windows-only; run npm run agent:schedule instead."}
        </p>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Mode</h3>
        <span className={`badge ${st.dryRun ? "s-dry_run" : "s-applied"}`}>{st.dryRun ? "Dry run - jobs are matched but nothing is submitted" : "LIVE - applying for real"}</span>{" "}
        <button type="button" onClick={() => post({ action: "live", enabled: st.dryRun })}>{st.dryRun ? "Switch to live applying" : "Switch back to dry run"}</button>
        <p className="muted">Recommended: leave on dry run for the first day and check the matches on the dashboard.</p>
      </div>

      {err && <p className="s-failed">{err}</p>}
      {warn && <p className="s-needs_manual">Saved, but: {warn}</p>}
      <button className="primary" type="submit" disabled={busy}>{busy ? "Saving..." : "Save & continue"}</button>
    </form>
  );
}
