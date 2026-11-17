// Run: npm test
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const { verifyKey, createLicense } = require('../src/license');

const pair = () => crypto.generateKeyPairSync('ed25519');
const pubPem = (k) => k.publicKey.export({ type: 'spki', format: 'pem' });
function issue(privateKey, payload) {
  const body = Buffer.from(JSON.stringify(payload));
  return `MC1.${body.toString('base64url')}.${crypto.sign(null, body, privateKey).toString('base64url')}`;
}
const mem = () => { let s = null; return { load: () => (s ? JSON.parse(JSON.stringify(s)) : null), save: (o) => { s = JSON.parse(JSON.stringify(o)); } }; };

test('valid key verifies and exposes payload', () => {
  const k = pair();
  const key = issue(k.privateKey, { v: 1, email: 'a@b.com', plan: 'pro' });
  const r = verifyKey(key, pubPem(k));
  assert.equal(r.ok, true); assert.equal(r.payload.email, 'a@b.com');
});

test('key signed by a different private key is rejected', () => {
  const real = pair(), attacker = pair();
  const forged = issue(attacker.privateKey, { v: 1, email: 'x@y.com', plan: 'pro' });
  assert.equal(verifyKey(forged, pubPem(real)).ok, false);
});

test('tampered payload is rejected (cannot extend expiry or change plan)', () => {
  const k = pair();
  const key = issue(k.privateKey, { v: 1, email: 'a@b.com', plan: 'basic', exp: '2020-01-01T00:00:00Z' });
  const [p, body, sig] = key.split('.');
  const edited = Buffer.from(JSON.stringify({ v: 1, email: 'a@b.com', plan: 'pro' })).toString('base64url');
  assert.equal(verifyKey(`${p}.${edited}.${sig}`, pubPem(k)).ok, false);
});

test('expired key is rejected with an expiry message', () => {
  const k = pair();
  const key = issue(k.privateKey, { v: 1, email: 'a@b.com', exp: '2020-01-01T00:00:00Z' });
  const r = verifyKey(key, pubPem(k));
  assert.equal(r.ok, false); assert.equal(r.expired, true); assert.match(r.reason, /2020-01-01/);
});

test('garbage input is rejected without throwing', () => {
  const k = pair();
  for (const bad of ['', null, undefined, 'hello', 'MC1.x.y', 'MC1..', 'MC1.' + 'a'.repeat(10) + '.' + 'b'.repeat(10)]) assert.equal(verifyKey(bad, pubPem(k)).ok, false);
});

test('whitespace / line breaks pasted into the key are tolerated', () => {
  const k = pair();
  const key = issue(k.privateKey, { v: 1, email: 'a@b.com' });
  assert.equal(verifyKey(key.replace(/(.{40})/g, '$1\n  '), pubPem(k)).ok, true);
});

test('default free trial is 24 hours of live-session time, and time is shown in hours', () => {
  delete process.env.TRIAL_MINUTES;
  delete require.cache[require.resolve('../src/license')];
  const { TRIAL_SECONDS, fmt, createLicense: mk } = require('../src/license');
  assert.equal(TRIAL_SECONDS, 24 * 3600);
  assert.equal(fmt(24 * 3600), '24 h'); assert.equal(fmt(23 * 3600 + 59 * 60), '23 h 59 min');
  assert.equal(fmt(90 * 60), '1 h 30 min'); assert.equal(fmt(5 * 60), '5 min'); assert.equal(fmt(42), '42s');
  const lic = mk({ storage: mem() });
  assert.equal(lic.status().trialLeftSec, 24 * 3600);
  assert.equal(lic.addUsage(23 * 3600).status, 'trial');      // 23 h used: still has 1 h
  assert.equal(lic.addUsage(3600).status, 'expired');          // 24 h used: trial over
  delete require.cache[require.resolve('../src/license')];
});

test('trial: counts down, then expires when minutes are used up', () => {
  process.env.TRIAL_MINUTES = '1'; // fresh module copy with a 60 s trial
  delete require.cache[require.resolve('../src/license')];
  const { createLicense: mk } = require('../src/license');
  const lic = mk({ storage: mem() });
  assert.equal(lic.status().status, 'trial');
  assert.equal(lic.addUsage(40).trialLeftSec, 20);
  assert.equal(lic.addUsage(25).status, 'expired');
  delete process.env.TRIAL_MINUTES; delete require.cache[require.resolve('../src/license')];
});

test('trial: also expires after 14 days even with minutes left', () => {
  let t = Date.parse('2026-01-01T00:00:00Z');
  const lic = createLicense({ storage: mem(), now: () => t });
  lic.touch();
  assert.equal(lic.status().status, 'trial');
  t += 15 * 86400000;
  assert.equal(lic.status().status, 'expired');
});

test('activating a valid key ends the trial limits and stops metering', () => {
  const k = pair(), storage = mem();
  const lic = createLicense({ storage, publicPem: pubPem(k) });
  lic.touch(); lic.addUsage(30 * 60 * 60); // 30 h: well over the 24 h trial
  assert.equal(lic.status().status, 'expired');
  const r = lic.activate(issue(k.privateKey, { v: 1, email: 'a@b.com', plan: 'pro' }));
  assert.equal(r.ok, true); assert.equal(r.status, 'licensed');
  const before = JSON.stringify(storage.load().trial);
  lic.addUsage(100);
  assert.equal(JSON.stringify(storage.load().trial), before, 'licensed users are not metered');
});

test('activating an invalid key changes nothing', () => {
  const k = pair(), storage = mem();
  const lic = createLicense({ storage, publicPem: pubPem(k) });
  assert.equal(lic.activate('MC1.abc.def').ok, false);
  assert.equal(lic.status().status, 'trial');
});

test('a stored license that later expires puts the app back to "expired"', () => {
  const k = pair(); let t = Date.parse('2026-06-01T00:00:00Z');
  const lic = createLicense({ storage: mem(), publicPem: pubPem(k), now: () => t });
  lic.activate(issue(k.privateKey, { v: 1, email: 'a@b.com', exp: '2026-07-01T00:00:00Z' }));
  assert.equal(lic.status().status, 'licensed');
  t = Date.parse('2026-07-02T00:00:00Z');
  const s = lic.status(); assert.equal(s.status, 'expired'); assert.equal(s.licenseExpired, true);
});
