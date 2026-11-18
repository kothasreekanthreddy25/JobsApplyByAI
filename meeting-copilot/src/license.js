// License keys (signed, verified offline) + free trial.
//
// A key is "MC1.<payload>.<signature>": payload = {email, plan, id, iat, exp?}, signed with YOUR private key (tools/license.js).
// The app holds only the public key, so it can check keys but not forge them.
//
// Free allowances, counted separately and only while the app is actually listening in a session:
//   DEMO (mock interview) = 24 hours,  REALTIME (real meetings) = 1 hour.   A license key removes both limits.
// No calendar expiry unless TRIAL_DAYS is set.
// HONEST LIMITS: with no server, a determined user can reset a local trial (reinstall / delete app data) or share a key.
// This stops casual copying; for hard enforcement add an activation server that binds keys to a machine (future step).
const crypto = require('crypto');
const { PUBLIC_KEY_PEM } = require('./licensePublic');

const envMinutes = (name, dflt) => Math.round((process.env[name] !== undefined ? +process.env[name] : dflt) * 60);
const TRIAL_SECONDS = envMinutes('TRIAL_MINUTES', 24 * 60);          // Demo: 24 hours
const REALTIME_SECONDS = envMinutes('TRIAL_REALTIME_MINUTES', 60);   // Realtime: 1 hour
// 0 = no calendar limit: the free allowances are ONLY the meeting-call time above.
// Set TRIAL_DAYS in the environment (or pass trialDays) to also expire the trial after N days.
const TRIAL_DAYS = process.env.TRIAL_DAYS !== undefined ? +process.env.TRIAL_DAYS : 0;

function verifyKey(key, publicPem = PUBLIC_KEY_PEM, now = Date.now()) {
  const m = String(key || '').replace(/\s+/g, '').match(/^MC1\.([\w-]+)\.([\w-]+)$/);
  if (!m) return { ok: false, reason: 'That does not look like a license key.' };
  const body = Buffer.from(m[1], 'base64url'), sig = Buffer.from(m[2], 'base64url');
  let valid = false;
  try { valid = crypto.verify(null, body, publicPem, sig); } catch { /* malformed */ }
  if (!valid) return { ok: false, reason: 'Invalid license key.' };
  let payload;
  try { payload = JSON.parse(body.toString()); } catch { return { ok: false, reason: 'Invalid license key.' }; }
  if (payload.exp && Date.parse(payload.exp) < now) return { ok: false, expired: true, payload, reason: `This license expired on ${payload.exp.slice(0, 10)}.` };
  return { ok: true, payload };
}

/** storage = { load(): object, save(obj) } so the same logic runs in the app and in tests. */
function createLicense({ storage, publicPem = PUBLIC_KEY_PEM, now = () => Date.now(), trialDays = TRIAL_DAYS }) {
  const get = () => {
    const s = storage.load() || {};
    s.trial = s.trial || { first: now(), usedSec: 0 };
    s.trial.usedRealSec = s.trial.usedRealSec || 0;
    return s;
  };

  /** mode: 'demo' (default) or 'realtime'. Also reports both allowances so the UI can show them side by side. */
  function status(mode = 'demo') {
    const s = get();
    if (s.licenseKey) {
      const r = verifyKey(s.licenseKey, publicPem, now());
      if (r.ok) return { status: 'licensed', email: r.payload.email, plan: r.payload.plan, exp: r.payload.exp || null };
      if (r.expired) return { status: 'expired', reason: r.reason, licenseExpired: true };
      // invalid stored key: fall through to trial rules
    }
    const daysUsed = (now() - s.trial.first) / 86400000;
    const demoLeftSec = Math.max(0, TRIAL_SECONDS - s.trial.usedSec);
    const realtimeLeftSec = Math.max(0, REALTIME_SECONDS - s.trial.usedRealSec);
    const leftSec = mode === 'realtime' ? realtimeLeftSec : demoLeftSec;
    const daysLeft = trialDays > 0 ? Math.max(0, Math.ceil(trialDays - daysUsed)) : null; // null = no day limit
    const base = { mode, trialLeftSec: leftSec, demoLeftSec, realtimeLeftSec, daysLeft };
    if (leftSec <= 0) {
      const reason = mode === 'realtime' ? `Your ${fmt(REALTIME_SECONDS)} of free Realtime time are used up.` : `Your ${fmt(TRIAL_SECONDS)} of free demo time are used up.`;
      return { ...base, status: 'expired', reason };
    }
    if (trialDays > 0 && daysLeft <= 0) return { ...base, status: 'expired', reason: `Your ${trialDays}-day trial has ended.`, daysLeft: 0 };
    return { ...base, status: 'trial' };
  }

  function activate(key) {
    const r = verifyKey(key, publicPem, now());
    if (!r.ok) return { ok: false, reason: r.reason };
    const s = get(); s.licenseKey = String(key).replace(/\s+/g, ''); storage.save(s);
    return { ok: true, ...status() };
  }

  /** Count live-session seconds against the trial (no-op when licensed). Returns the new status. */
  function addUsage(sec, mode = 'demo') {
    const s = get();
    if (!(s.licenseKey && verifyKey(s.licenseKey, publicPem, now()).ok)) {
      if (mode === 'realtime') s.trial.usedRealSec += sec; else s.trial.usedSec += sec;
      storage.save(s);
    } else if (!storage.load()) storage.save(s);
    return status(mode);
  }

  function touch() { const s = get(); storage.save(s); } // records first-use time on first launch
  return { status, activate, addUsage, touch };
}

function fmt(sec) {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
  if (h >= 1) return m ? `${h} h ${m} min` : `${h} h`;
  return m >= 1 ? `${m} min` : `${sec}s`;
}

module.exports = { verifyKey, createLicense, fmt, TRIAL_SECONDS, REALTIME_SECONDS, TRIAL_DAYS };
