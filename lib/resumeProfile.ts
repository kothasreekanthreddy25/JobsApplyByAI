import { extractSkills } from "./match";
import { Profile } from "./types";

const TITLES = [
  "full stack developer", "frontend developer", "front end developer", "backend developer",
  "software engineer", "software developer", "react developer", "node.js developer", "java developer",
  "python developer", ".net developer", "web developer", "mobile developer", "android developer",
  "ios developer", "devops engineer", "data engineer", "data analyst", "data scientist",
  "machine learning engineer", "qa engineer", "test engineer", "automation engineer", "cloud engineer",
  "business analyst", "product manager", "project manager", "ui/ux designer", "sap consultant",
  "salesforce developer", "technical lead", "engineering manager",
];

const CITIES = [
  "Bengaluru", "Bangalore", "Hyderabad", "Pune", "Chennai", "Mumbai", "Delhi", "Noida", "Gurgaon",
  "Gurugram", "Kolkata", "Ahmedabad", "Kochi", "Coimbatore", "Remote",
];

/** Best-effort profile fields from raw resume text. User can still tweak them in Settings. */
export function profileFromResume(text: string, current: Profile): Profile {
  const lower = text.toLowerCase();

  const name =
    text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => /^[A-Za-z][A-Za-z .'-]{2,40}$/.test(l) && l.split(/\s+/).length <= 4) ?? current.name;

  const years = [...text.matchAll(/(\d{1,2}(?:\.\d)?)\s*\+?\s*(?:years|yrs)/gi)].map((m) => parseFloat(m[1]));
  const yearsExperience = years.length ? Math.min(40, Math.max(...years)) : current.yearsExperience;

  const roles = TITLES.map((t) => ({ t, n: lower.split(t).length - 1, first: lower.indexOf(t) }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n || a.first - b.first)
    .slice(0, 3)
    .map((x) => x.t.replace(/\b\w/g, (c) => c.toUpperCase()));

  const locations = CITIES.filter((c) => lower.includes(c.toLowerCase()))
    .map((c) => (c === "Bangalore" ? "Bengaluru" : c))
    .filter((c, i, a) => a.indexOf(c) === i)
    .slice(0, 2);

  const email = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] ?? "";
  const phone = text.match(/(?:\+?\d{1,3}[\s-]?)?\d{5}[\s-]?\d{5}\b|\+?\d[\d\s-]{8,14}\d/)?.[0]?.trim() ?? "";
  const linkedin = text.match(/(?:https?:\/\/)?(?:www\.)?linkedin\.com\/in\/[A-Za-z0-9_%-]+/i)?.[0] ?? "";
  const [firstName = "", ...rest] = name.split(/\s+/);
  const a = current.applicant;

  return {
    ...current,
    name,
    // Details already entered by the user win over what's detected from the resume.
    applicant: {
      ...a,
      firstName: a.firstName || firstName,
      lastName: a.lastName || rest.join(" "),
      email: a.email || email,
      phone: a.phone || phone,
      city: a.city || locations[0] || "",
      linkedin: a.linkedin || linkedin,
    },
    resumeText: text,
    yearsExperience,
    skills: [...new Set([...extractSkills(text)])],
    roles: roles.length ? roles : current.roles,
    locations: locations.length ? locations : current.locations,
  };
}
