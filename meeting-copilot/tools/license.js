#!/usr/bin/env node
// SELLER-SIDE tool: creates your signing key pair once and issues license keys to customers.
// The PRIVATE key stays in .license/private.pem on YOUR machine (git-ignored, never shipped).
// The app only contains the PUBLIC key, so it can verify keys offline but can never create them.
//
//   node tools/license.js init                       create the key pair (once!)
//   node tools/license.js make --email a@b.com [--plan pro] [--days 365]   issue a key (no --days = lifetime)
//   node tools/license.js verify <key>               check a key
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIR = path.join(ROOT, '.license');
const PRIV = path.join(DIR, 'private.pem');
const PUB_MODULE = path.join(ROOT, 'src', 'licensePublic.js');
const arg = (k) => { const i = process.argv.indexOf('--' + k); return i > -1 ? process.argv[i + 1] : null; };
const cmd = process.argv[2];

if (cmd === 'init') {
  if (fs.existsSync(PRIV) && !process.argv.includes('--force')) {
    console.error('A key pair already exists. Re-creating it would INVALIDATE every license key you have issued.\nUse --force only if you really mean it.');
    process.exit(1);
  }
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(PRIV, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  const pub = publicKey.export({ type: 'spki', format: 'pem' });
  fs.writeFileSync(PUB_MODULE, `// Public half of the license signing key. Safe to commit and ship; it can only VERIFY keys.\nmodule.exports = { PUBLIC_KEY_PEM: ${JSON.stringify(pub)} };\n`);
  console.log(`Created ${PRIV}\nBACK THIS FILE UP somewhere safe (password manager / encrypted drive). If you lose it you can never issue valid keys again.\nPublic key written to src/licensePublic.js - rebuild the installer so the app contains it.`);
} else if (cmd === 'make') {
  const email = arg('email');
  if (!email) { console.error('Usage: node tools/license.js make --email customer@example.com [--plan pro] [--days 365]'); process.exit(1); }
  if (!fs.existsSync(PRIV)) { console.error('Run "node tools/license.js init" first.'); process.exit(1); }
  const days = arg('days');
  const payload = { v: 1, id: crypto.randomBytes(6).toString('hex'), email, plan: arg('plan') || 'pro', iat: new Date().toISOString() };
  if (days) payload.exp = new Date(Date.now() + +days * 86400000).toISOString();
  const body = Buffer.from(JSON.stringify(payload));
  const sig = crypto.sign(null, body, crypto.createPrivateKey(fs.readFileSync(PRIV)));
  const key = `MC1.${body.toString('base64url')}.${sig.toString('base64url')}`;
  console.log(key);
  console.error(`\nIssued to ${email} | plan ${payload.plan} | ${payload.exp ? 'expires ' + payload.exp.slice(0, 10) : 'lifetime'} | id ${payload.id}`);
} else if (cmd === 'verify') {
  const { verifyKey } = require('../src/license');
  const r = verifyKey(process.argv[3]);
  console.log(r.ok ? 'VALID ' + JSON.stringify(r.payload) : 'INVALID: ' + r.reason);
} else {
  console.log('Commands: init | make --email <e> [--plan p] [--days n] | verify <key>');
}
