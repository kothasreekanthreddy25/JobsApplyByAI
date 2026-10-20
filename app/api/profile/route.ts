import { NextResponse } from "next/server";
import { getProfile, saveProfile } from "@/lib/store";
import { Profile } from "@/lib/types";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(getProfile());
}

export async function POST(req: Request) {
  const body = (await req.json()) as Partial<Profile>;
  const current = getProfile();
  const list = (v: unknown, fallback: string[]) =>
    Array.isArray(v) ? v.map((s) => String(s).trim()).filter(Boolean) : fallback;
  const num = (v: unknown, fallback: number, min: number, max: number) =>
    Number.isFinite(Number(v)) ? Math.min(max, Math.max(min, Number(v))) : fallback;

  const str = (v: unknown, fallback: string) => (typeof v === "string" ? v.trim() : fallback);
  const a = { ...current.applicant, ...(body.applicant ?? {}) };
  const next: Profile = {
    name: String(body.name ?? current.name),
    resumePath: current.resumePath,
    applicant: {
      firstName: str(a.firstName, ""),
      lastName: str(a.lastName, ""),
      email: str(a.email, ""),
      phone: str(a.phone, ""),
      city: str(a.city, ""),
      currentCompany: str(a.currentCompany, ""),
      currentCtc: str(a.currentCtc, ""),
      expectedCtc: str(a.expectedCtc, ""),
      noticePeriod: str(a.noticePeriod, ""),
      linkedin: str(a.linkedin, ""),
      agreeToTerms: a.agreeToTerms === true,
    },
    roles: list(body.roles, current.roles),
    locations: list(body.locations, current.locations),
    skills: list(body.skills, current.skills),
    yearsExperience: num(body.yearsExperience, current.yearsExperience, 0, 60),
    resumeText: String(body.resumeText ?? current.resumeText),
    minMatch: num(body.minMatch, current.minMatch, 0, 100),
    dailyLimitPerPortal: num(body.dailyLimitPerPortal, current.dailyLimitPerPortal, 1, 50),
    portals: { ...current.portals, ...(body.portals ?? {}) },
  };
  saveProfile(next);
  return NextResponse.json(next);
}
