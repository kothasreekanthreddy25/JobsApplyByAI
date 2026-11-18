// Where things live, and where the user's API keys are stored.
//  - Development (npm start): project folder, keys from .env as before.
//  - Installed app: per-user data folder (%APPDATA%/Meeting Copilot), keys encrypted with Windows DPAPI via Electron safeStorage,
//    so they never sit in plain text and are never inside the installer.
const { app, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');

const userDir = () => app.getPath('userData');
const settingsFile = () => path.join(userDir(), 'settings.json');

function read() { try { return JSON.parse(fs.readFileSync(settingsFile(), 'utf8')); } catch { return {}; } }
function write(o) { fs.mkdirSync(userDir(), { recursive: true }); fs.writeFileSync(settingsFile(), JSON.stringify(o, null, 2)); }

const enc = (s) => (safeStorage.isEncryptionAvailable() ? { e: safeStorage.encryptString(s).toString('base64') } : { p: s });
const dec = (o) => { try { return o?.e ? safeStorage.decryptString(Buffer.from(o.e, 'base64')) : o?.p || ''; } catch { return ''; } };

const KEYS = { anthropic: 'ANTHROPIC_API_KEY', deepgram: 'DEEPGRAM_API_KEY', openai: 'OPENAI_API_KEY' };

/** Copy saved keys into process.env (saved values win over .env when non-empty). */
function applyKeysToEnv() {
  const k = read().keys || {};
  for (const [name, envName] of Object.entries(KEYS)) { const v = dec(k[name]); if (v) process.env[envName] = v; }
}

/** Save only the keys the user typed (blank = keep existing). */
function saveKeys(input) {
  const s = read(); s.keys = s.keys || {};
  for (const name of Object.keys(KEYS)) if (input[name]?.trim()) s.keys[name] = enc(input[name].trim());
  write(s);
  applyKeysToEnv();
}

function clearKey(name) { const s = read(); if (s.keys) delete s.keys[name]; write(s); if (KEYS[name]) delete process.env[KEYS[name]]; }

const has = () => ({ anthropic: !!process.env.ANTHROPIC_API_KEY, deepgram: !!process.env.DEEPGRAM_API_KEY, openai: !!process.env.OPENAI_API_KEY });

function paths() {
  if (!app.isPackaged) {
    const root = path.resolve(__dirname, '..');
    return {
      docs: path.resolve(root, process.env.DOCS_DIR || './docs'),
      prep: path.resolve(root, process.env.PREP_DIR || './prep'),
      models: process.env.MODEL_CACHE || path.join(root, '.models'),
      reviews: path.join(root, 'reviews'),
    };
  }
  const p = { docs: path.join(userDir(), 'docs'), prep: path.join(userDir(), 'prep'), reviews: path.join(userDir(), 'reviews'), models: path.join(process.resourcesPath, 'models') };
  fs.mkdirSync(p.docs, { recursive: true }); fs.mkdirSync(p.prep, { recursive: true }); fs.mkdirSync(p.reviews, { recursive: true });
  return p;
}

// License + trial state: encrypted with DPAPI and written to TWO places (settings.json and a mirror file in
// %LOCALAPPDATA%). On load the two are merged taking the most-used / earliest values, so deleting just one copy
// does not reset the trial. (A determined user can still wipe both: see the note in license.js.)
const mirrorFile = () => path.join(process.env.LOCALAPPDATA || userDir(), 'MeetingCopilot', '.lic');
const parse = (o) => { try { return JSON.parse(dec(o)); } catch { return null; } };
const licenseStore = {
  load() {
    let b = null;
    try { b = parse(JSON.parse(fs.readFileSync(mirrorFile(), 'utf8'))); } catch { /* no mirror yet */ }
    const a = parse(read().license);
    if (!a && !b) return null;
    const out = { ...(b || {}), ...(a || {}) };
    const ta = a?.trial, tb = b?.trial;
    if (ta || tb) out.trial = { first: Math.min(ta?.first ?? Infinity, tb?.first ?? Infinity), usedSec: Math.max(ta?.usedSec ?? 0, tb?.usedSec ?? 0), usedRealSec: Math.max(ta?.usedRealSec ?? 0, tb?.usedRealSec ?? 0) };
    out.licenseKey = a?.licenseKey || b?.licenseKey;
    return out;
  },
  save(obj) {
    const e = enc(JSON.stringify(obj));
    const s = read(); s.license = e; write(s);
    try { fs.mkdirSync(path.dirname(mirrorFile()), { recursive: true }); fs.writeFileSync(mirrorFile(), JSON.stringify(e)); } catch { /* best effort */ }
  },
};

const getMode = () => (read().mode === 'demo' ? 'demo' : 'realtime');
const setMode = (m) => { const s = read(); s.mode = m; write(s); };

module.exports = { applyKeysToEnv, saveKeys, clearKey, has, paths, userDir, licenseStore, getMode, setMode };
