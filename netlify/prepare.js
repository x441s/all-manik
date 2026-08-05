// ============================================================
//  netlify/prepare.js — disalin oleh `npm run build` (Netlify)
//  Menyalin views/ & public/ ke dalam folder fungsi, karena saat
//  fungsi dibundle, __dirname tidak lagi menunjuk ke root proyek.
// ============================================================
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const assetsDir = path.join(root, 'netlify', 'functions', '_assets');

function copyDir(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

fs.rmSync(assetsDir, { recursive: true, force: true });
copyDir(path.join(root, 'views'), path.join(assetsDir, 'views'));
copyDir(path.join(root, 'public'), path.join(assetsDir, 'public'));
console.log('✔ Asset disalin ke netlify/functions/_assets (views + public).');
