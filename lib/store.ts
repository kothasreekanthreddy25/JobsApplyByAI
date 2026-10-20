import fs from "node:fs";
import path from "node:path";
import { Application, DEFAULT_APPLICANT, DEFAULT_PROFILE, Db, Profile, RunLog } from "./types";

// JOBAGENT_DATA_DIR lets you run the app against a separate data folder (e.g. sample data for demos).
const DATA_DIR = process.env.JOBAGENT_DATA_DIR || path.join(process.cwd(), "data");
const DB_FILE = path.join(DATA_DIR, "db.json");
const PROFILE_FILE = path.join(DATA_DIR, "profile.json");

function ensureDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

function writeJson(file: string, value: unknown) {
  ensureDir();
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}

export function getProfile(): Profile {
  const saved = readJson<Partial<Profile>>(PROFILE_FILE, {});
  return { ...DEFAULT_PROFILE, ...saved, applicant: { ...DEFAULT_APPLICANT, ...saved.applicant } };
}

export function saveProfile(profile: Profile) {
  writeJson(PROFILE_FILE, profile);
}

export function getDb(): Db {
  return readJson<Db>(DB_FILE, { applications: [], runs: [] });
}

export function hasApplication(id: string): boolean {
  return getDb().applications.some((a) => a.id === id);
}

/** Insert or replace by id. */
export function saveApplication(app: Application) {
  const db = getDb();
  const i = db.applications.findIndex((a) => a.id === app.id);
  if (i >= 0) db.applications[i] = app;
  else db.applications.push(app);
  writeJson(DB_FILE, db);
}

export function addRun(run: RunLog) {
  const db = getDb();
  db.runs.push(run);
  db.runs = db.runs.slice(-100);
  writeJson(DB_FILE, db);
}

export function updateLastRun(patch: Partial<RunLog>) {
  const db = getDb();
  const last = db.runs[db.runs.length - 1];
  if (last) Object.assign(last, patch);
  writeJson(DB_FILE, db);
}

const CONN_FILE = path.join(DATA_DIR, "connections.json");

export function getConnections(): Record<string, string> {
  return readJson<Record<string, string>>(CONN_FILE, {});
}

export function setConnected(portal: string) {
  writeJson(CONN_FILE, { ...getConnections(), [portal]: new Date().toISOString() });
}

// ---- portal credentials (password encrypted with a local key, see lib/crypto.ts) ----
import { decrypt, encrypt } from "./crypto";

const CRED_FILE = path.join(DATA_DIR, "credentials.json");
type StoredCreds = Record<string, { username: string; password: string }>;

/** Safe for the UI: never includes passwords. */
export function getCredentialSummary(): Record<string, { username: string; hasPassword: boolean }> {
  const all = readJson<StoredCreds>(CRED_FILE, {});
  return Object.fromEntries(
    Object.entries(all).map(([p, c]) => [p, { username: c.username, hasPassword: !!c.password }])
  );
}

/** Empty password keeps the previously saved one. */
export function saveCredentials(portal: string, username: string, password: string) {
  const all = readJson<StoredCreds>(CRED_FILE, {});
  const prev = all[portal];
  all[portal] = { username, password: password ? encrypt(password) : prev?.password ?? "" };
  writeJson(CRED_FILE, all);
}

export function getCredentials(portal: string): { username: string; password: string } | null {
  const c = readJson<StoredCreds>(CRED_FILE, {})[portal];
  if (!c?.username || !c.password) return null;
  try {
    return { username: c.username, password: decrypt(c.password) };
  } catch {
    return null;
  }
}

// ---- daily schedule preference ----
const SCHED_FILE = path.join(DATA_DIR, "schedule.json");
export interface Schedule { enabled: boolean; time: string }
export function getSchedule(): Schedule {
  return readJson<Schedule>(SCHED_FILE, { enabled: false, time: "09:00" });
}
export function saveSchedule(s: Schedule) {
  writeJson(SCHED_FILE, s);
}
