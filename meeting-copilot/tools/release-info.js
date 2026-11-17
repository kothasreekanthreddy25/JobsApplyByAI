#!/usr/bin/env node
// Run after `npm run dist`: reads the built installer and writes site/release.json
// (version, size, SHA-256, download link) which the download page and install guide display.
//
//   node tools/release-info.js --url https://example.com/downloads/Meeting-Copilot-Setup-0.1.0.exe
//        [--price "$29 one-time"] [--buy https://your-checkout] [--support help@yourdomain.com]
// Upload the .exe to that URL (GitHub Release, your own host), then publish the whole site/ folder.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const pkg = require(path.join(ROOT, 'package.json'));
const arg = (k) => { const i = process.argv.indexOf('--' + k); return i > -1 ? process.argv[i + 1] : ''; };

const file = `${pkg.build?.productName || pkg.name} Setup ${pkg.version}.exe`;
const exe = path.join(ROOT, 'dist', file);
if (!fs.existsSync(exe)) { console.error(`Installer not found: ${exe}\nRun "npm run dist" first.`); process.exit(1); }

const sha256 = crypto.createHash('sha256').update(fs.readFileSync(exe)).digest('hex');
const info = {
  version: pkg.version,
  file,
  sizeMB: Math.round(fs.statSync(exe).size / 1048576),
  sha256,
  date: new Date().toISOString().slice(0, 10),
  downloadUrl: arg('url'),
  price: arg('price'),
  buyUrl: arg('buy') || pkg.buyUrl || '',
  support: arg('support'),
};
fs.writeFileSync(path.join(ROOT, 'site', 'release.json'), JSON.stringify(info, null, 2));
console.log(info);
if (!info.downloadUrl) console.log('\nNote: no --url given, so the page will show the download button as disabled.');
