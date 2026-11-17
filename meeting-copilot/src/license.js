// License keys (signed, verified offline) + free trial.
//
// A key is "MC1.<payload>.<signature>": payload = {email, plan, id, iat, exp?}, signed with YOUR private key (tools/license.js).
// The app holds only the public key, so it can check keys but not forge them.
//
// Trial = TRIAL_MINUTES of live-session time within TRIAL_DAYS of first use.
// HONEST LIMITS: with no server, a determined user can reset a local trial (reinstall / delete app data) or share a key.
// This stops casual copying; for hard enforcement add an activation server that binds keys to a machine (future step).
const crypto = require('crypto');
const { PUBLIC_KEY_PEM } = require('./licensePublic');

const DEFAULT_TRIAL_MINUTES = 24 * 60; // 24 hours of live-session time
const TRIAL_SECONDS = Math.round((process.env.TRIAL_MINUTES !== undefined ? +process.env.TRIAL_MINUTES : DEFAULT_TRIAL_MINUTES) * 60);
const TRIAL_DAYS = 14;

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
function createLicense({ storage, publicPem = PUBLIC_KEY_PEM, now = () => Date.now() }) {
  const get = () => {
    const s = storage.load() || {};
    s.trial = s.trial || { first: now(), usedSec: 0 };
    return s;
  };

  function status() {
    const s = get();
    if (s.licenseKey) {
      const r = verifyKey(s.licenseKey, publicPem, now());
      if (r.ok) return { status: 'licensed', email: r.payload.email, plan: r.payload.plan, exp: r.payload.exp || null };
      if (r.expired) return { status: 'expired', reason: r.reason, licenseExpired: true };
      // invalid stored key: fall through to trial rules
    }
    const daysUsed = (now() - s.trial.first) / 86400000;
    const leftSec = Math.max(0, TRIAL_SECONDS - s.trial.usedSec);
    const daysLeft = Math.max(0, Math.ceil(TRIAL_DAYS - daysUsed));
    if (leftSec <= 0) return { status: 'expired', reason: 'Your free trial minutes are used up.', trialLeftSec: 0, daysLeft };
    if (daysLeft <= 0) return { status: 'expired', reason: `Your ${TRIAL_DAYS}-day trial has ended.`, trialLeftSec: leftSec, daysLeft: 0 };
    return { status: 'trial', trialLeftSec: leftSec, daysLeft };
  }

  function activate(key) {
    const r = verifyKey(key, publicPem, now());
    if (!r.ok) return { ok: false, reason: r.reason };
    const s = get(); s.licenseKey = String(key).replace(/\s+/g, ''); storage.save(s);
    return { ok: true, ...status() };
  }

  /** Count live-session seconds against the trial (no-op when licensed). Returns the new status. */
  function addUsage(sec) {
    const s = get();
    if (!(s.licenseKey && verifyKey(s.licenseKey, publicPem, now()).ok)) { s.trial.usedSec += sec; storage.save(s); }
    else if (!storage.load()) storage.save(s);
    return status();
  }

  function touch() { const s = get(); storage.save(s); } // records first-use time on first launch
  return { status, activate, addUsage, touch };
}

const fmt = (sec) => {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
  if (h >= 1) return m ? `${h} h ${m} min` : `${h} h`;
  return m >= 1 ? `${m} min` : `${sec}s`;
};

module.exports = { verifyKey, createLicense, fmt, TRIAL_SECONDS, TRIAL_DAYS };
