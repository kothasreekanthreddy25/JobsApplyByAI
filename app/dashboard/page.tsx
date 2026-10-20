"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import type { Application, ApplyStatus, Portal, RunLog } from "@/lib/types";

const STATUS_LABEL: Record<ApplyStatus, string> = {
  applied: "Applied",
  dry_run: "Matched (dry run)",
  needs_manual: "Needs manual apply",
  skipped_low_match: "Skipped (low match)",
  failed: "Failed",
};
const PORTAL_LABEL: Record<Portal, string> = { naukri: "Naukri", linkedin: "LinkedIn", monster: "Monster" };

export default function Dashboard() {
  const [apps, setApps] = useState<Application[]>([]);
  const [lastRun, setLastRun] = useState<RunLog | null>(null);
  const [status, setStatus] = useState("");
  const [portal, setPortal] = useState("");
  const [date, setDate] = useState("");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    const r = await fetch("/api/applications", { cache: "no-store" });
    const d = await r.json();
    setApps(d.applications);
    setLastRun(d.lastRun);
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, [load]);

  const running = !!lastRun && !lastRun.finishedAt;

  async function runNow() {
    setMsg("");
    const r = await fetch("/api/run", { method: "POST" });
    const d = await r.json();
    setMsg(r.ok ? "Agent started - a browser window will open. Results appear here as it works." : d.error);
    setTimeout(load, 3000);
  }

  const filtered = useMemo(
    () =>
      apps.filter(
        (a) =>
          (!status || a.status === status) &&
          (!portal || a.portal === portal) &&
          (!date || a.appliedAt.slice(0, 10) === date) &&
          (!q || `${a.title} ${a.company} ${a.skills.join(" ")}`.toLowerCase().includes(q.toLowerCase()))
      ),
    [apps, status, portal, date, q]
  );

  const today = new Date().toISOString().slice(0, 10);
  const count = (s: ApplyStatus) => apps.filter((a) => a.status === s).length;

  return (
    <>
      <div className="stats">
        <div className="card stat"><b>{apps.filter((a) => a.appliedAt.startsWith(today) && (a.status === "applied" || a.status === "dry_run")).length}</b><span>Applied today</span></div>
        <div className="card stat"><b>{count("applied")}</b><span>Total applied</span></div>
        <div className="card stat"><b>{count("dry_run")}</b><span>Matched (dry run)</span></div>
        <div className="card stat"><b>{count("needs_manual")}</b><span>Need manual apply</span></div>
        <div className="card stat"><b>{count("failed")}</b><span>Failed</span></div>
      </div>

      <div className="card toolbar">
        <button className="primary" onClick={runNow} disabled={running}>{running ? "Agent running..." : "Run agent now"}</button>
        <span className="muted">
          {lastRun
            ? `Last run ${new Date(lastRun.startedAt).toLocaleString()}${lastRun.dryRun ? " (dry run)" : ""}: ${lastRun.summary}`
            : "No runs yet. Set up your profile in Settings first."}
        </span>
        {msg && <span>{msg}</span>}
      </div>

      <div className="toolbar">
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select value={portal} onChange={(e) => setPortal(e.target.value)}>
          <option value="">All portals</option>
          {Object.entries(PORTAL_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <input type="text" placeholder="Search title, company, skill" value={q} onChange={(e) => setQ(e.target.value)} style={{ minWidth: 240 }} />
        {(date || status || portal || q) && <button onClick={() => { setDate(""); setStatus(""); setPortal(""); setQ(""); }}>Clear</button>}
        <span className="muted">{filtered.length} of {apps.length}</span>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>Date</th><th>Job</th><th>Portal</th><th>Skills (green = you have)</th><th>Match</th><th>Status</th></tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={6} className="muted">No applications yet.</td></tr>
            )}
            {filtered.map((a) => (
              <Fragment key={a.id}>
                <tr className="row" onClick={() => setOpen(open === a.id ? null : a.id)}>
                  <td>{new Date(a.appliedAt).toLocaleDateString()}<br /><span className="muted">{new Date(a.appliedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span></td>
                  <td><strong>{a.title}</strong><br /><span className="muted">{a.company}{a.location ? ` · ${a.location}` : ""}</span></td>
                  <td>{PORTAL_LABEL[a.portal]}</td>
                  <td>
                    {a.skills.length === 0 && <span className="muted">-</span>}
                    {a.skills.map((s) => <span key={s} className={`chip${a.matchedSkills.includes(s) ? " hit" : ""}`}>{s}</span>)}
                  </td>
                  <td><strong>{a.matchPercent}%</strong><div className="meter"><i style={{ width: `${a.matchPercent}%` }} /></div></td>
                  <td><span className={`badge s-${a.status}`}>{STATUS_LABEL[a.status]}</span>{a.note && <div className="muted" style={{ fontSize: 12 }}>{a.note}</div>}</td>
                </tr>
                {open === a.id && (
                  <tr>
                    <td colSpan={6}>
                      <a href={a.url} target="_blank" rel="noreferrer">Open job on {PORTAL_LABEL[a.portal]}</a>
                      <div className="jd" style={{ marginTop: 8 }}>{a.description || "Job description could not be read."}</div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
