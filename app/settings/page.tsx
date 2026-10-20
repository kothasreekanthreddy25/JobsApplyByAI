"use client";

import { useEffect, useState } from "react";
import { extractSkills } from "@/lib/match";
import type { Portal, Profile } from "@/lib/types";

const csv = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

export default function Settings() {
  const [p, setP] = useState<Profile | null>(null);
  const [roles, setRoles] = useState("");
  const [locations, setLocations] = useState("");
  const [skills, setSkills] = useState("");
  const [saved, setSaved] = useState("");

  useEffect(() => {
    fetch("/api/profile").then((r) => r.json()).then((d: Profile) => {
      setP(d);
      setRoles(d.roles.join(", "));
      setLocations(d.locations.join(", "));
      setSkills(d.skills.join(", "));
    });
  }, []);

  if (!p) return <p className="muted">Loading...</p>;

  const set = <K extends keyof Profile>(k: K, v: Profile[K]) => setP({ ...p, [k]: v });

  async function save() {
    const body = { ...p, roles: csv(roles), locations: csv(locations), skills: csv(skills) };
    const r = await fetch("/api/profile", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    setSaved(r.ok ? "Saved." : "Save failed.");
    setTimeout(() => setSaved(""), 3000);
  }

  function pullSkills() {
    const found = extractSkills(p!.resumeText);
    setSkills([...new Set([...csv(skills), ...found])].join(", "));
  }

  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>Your profile</h2>
      <div className="row2">
        <div><label>Name</label><input type="text" value={p.name} onChange={(e) => set("name", e.target.value)} /></div>
        <div><label>Years of experience</label><input type="number" min={0} value={p.yearsExperience} onChange={(e) => set("yearsExperience", Number(e.target.value))} /></div>
      </div>
      <div className="row2">
        <div><label>Target roles <small>(comma separated, used as search keywords)</small></label><input type="text" value={roles} onChange={(e) => setRoles(e.target.value)} /></div>
        <div><label>Locations <small>(comma separated)</small></label><input type="text" value={locations} onChange={(e) => setLocations(e.target.value)} /></div>
      </div>
      <label>Resume text <small>(paste it in; skills are detected from it)</small></label>
      <textarea value={p.resumeText} onChange={(e) => set("resumeText", e.target.value)} />
      <label>Skills <small>(comma separated) <button type="button" onClick={pullSkills}>Detect from resume</button></small></label>
      <input type="text" value={skills} onChange={(e) => setSkills(e.target.value)} />

      <h2>Application details <small className="muted">(used to fill forms on company websites)</small></h2>
      <p className="muted">
        Name, email, phone, city and LinkedIn are detected from your resume. Fill in the rest: if a company form asks something
        that isn&apos;t covered here, the agent stops and marks the job &quot;Needs manual apply&quot; instead of guessing.
        {!p.resumePath && " Re-upload your resume on the Setup page once so the file can be attached."}
      </p>
      <div className="row2">
        {(
          [
            ["firstName", "First name"], ["lastName", "Last name"], ["email", "Email"], ["phone", "Phone"],
            ["city", "Current city"], ["currentCompany", "Current company"], ["currentCtc", "Current CTC (e.g. 18 LPA)"],
            ["expectedCtc", "Expected CTC (e.g. 24 LPA)"], ["noticePeriod", "Notice period (e.g. 30 days)"], ["linkedin", "LinkedIn URL"],
          ] as const
        ).map(([k, label]) => (
          <div key={k}>
            <label>{label}</label>
            <input type="text" value={p.applicant[k]} onChange={(e) => set("applicant", { ...p.applicant, [k]: e.target.value })} />
          </div>
        ))}
      </div>
      <div className="checks" style={{ marginTop: 12 }}>
        <label>
          <input type="checkbox" checked={p.applicant.agreeToTerms} onChange={(e) => set("applicant", { ...p.applicant, agreeToTerms: e.target.checked })} />
          Tick &quot;I agree to the privacy policy / terms&quot; boxes on company forms
        </label>
      </div>

      <h2>Agent behaviour</h2>
      <div className="row2">
        <div><label>Minimum match % to apply</label><input type="number" min={0} max={100} value={p.minMatch} onChange={(e) => set("minMatch", Number(e.target.value))} /></div>
        <div><label>Max applications per portal per run</label><input type="number" min={1} max={50} value={p.dailyLimitPerPortal} onChange={(e) => set("dailyLimitPerPortal", Number(e.target.value))} /></div>
      </div>
      <label>Portals</label>
      <div className="checks">
        {(["naukri", "linkedin", "monster"] as Portal[]).map((k) => (
          <label key={k}><input type="checkbox" checked={p.portals[k]} onChange={(e) => set("portals", { ...p.portals, [k]: e.target.checked })} />{k[0].toUpperCase() + k.slice(1)}</label>
        ))}
      </div>
      <p className="muted">Dry run vs real applying is controlled by <code>DRY_RUN</code> in your <code>.env</code> file.</p>
      <button className="primary" onClick={save}>Save</button> <span>{saved}</span>
    </div>
  );
}
