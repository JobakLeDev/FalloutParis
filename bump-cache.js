#!/usr/bin/env node
// ============================================================
// bump-cache.js — Cache-busting AUTOMATIQUE.
// Versionne chaque asset LOCAL (.js/.css/.svg) référencé dans les .html
// par un hash de son contenu (?v=<hash>). Idempotent : un fichier ne change
// de version que si son contenu a changé. Plus de bump manuel à oublier.
//
// Usage :
//   node bump-cache.js          → réécrit les ?v= (à lancer avant de commit/déployer)
//   node bump-cache.js --check  → ne modifie rien, sort en code 1 s'il reste des ?v= périmés
//
// Ignoré : URLs absolues (http(s):// ou //cdn…), node_modules, .git, discord-bot.
// ============================================================
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const SKIP_DIRS = new Set(['node_modules', '.git', 'discord-bot']);
const check = process.argv.includes('--check');

// src="…" / href="…" pointant un .js/.css/.svg local, avec ?v=… optionnel + #fragment optionnel
const RE = /\b(src|href)\s*=\s*"([^"?#]+\.(?:js|css|svg))(\?v=[^"#]*)?(#[^"]*)?"/gi;

function listHtml(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) listHtml(path.join(dir, e.name), acc); }
    else if (e.name.endsWith('.html')) acc.push(path.join(dir, e.name));
  }
  return acc;
}

const hashCache = new Map();
function hashOf(file) {
  if (hashCache.has(file)) return hashCache.get(file);
  let h = null;
  try { h = crypto.createHash('md5').update(fs.readFileSync(file)).digest('hex').slice(0, 8); } catch (e) { /* fichier introuvable */ }
  hashCache.set(file, h);
  return h;
}

let changedFiles = 0, changedRefs = 0, missing = new Set();

for (const html of listHtml(ROOT)) {
  const dir = path.dirname(html);
  const orig = fs.readFileSync(html, 'utf8');
  const next = orig.replace(RE, (m, attr, ref, ver, frag) => {
    if (/^(https?:)?\/\//i.test(ref)) return m;                 // URL absolue / CDN → on ne touche pas
    const target = ref.startsWith('/') ? path.join(ROOT, ref) : path.resolve(dir, ref);
    const h = hashOf(target);
    if (!h) { missing.add(ref); return m; }                     // cible absente → on laisse tel quel
    const newVer = '?v=' + h;
    if (ver === newVer) return m;
    changedRefs++;
    return `${attr}="${ref}${newVer}${frag || ''}"`;
  });
  if (next !== orig) {
    changedFiles++;
    if (!check) fs.writeFileSync(html, next);
    console.log((check ? '[périmé] ' : '[maj]    ') + path.relative(ROOT, html));
  }
}

missing.forEach(r => console.warn('  ⚠ cible introuvable (ignorée) : ' + r));
console.log(`\n${changedRefs} référence(s) dans ${changedFiles} fichier(s) ${check ? 'à mettre à jour.' : 'mis à jour.'}`);
if (check && changedFiles) process.exit(1);
