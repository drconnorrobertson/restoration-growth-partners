#!/usr/bin/env node
/**
 * generate-redirects.mjs — write vercel.json `redirects` FROM artifacts/redirect-map.yaml (§21/§25).
 * Redirects are never hand-typed into vercel.json; the map (validated by validate:artifacts) is the source.
 * 301 rows → permanent redirects (both with and without trailing slash). 410 rows have no Vercel redirect
 * equivalent and are left to 404 (listed in the output so the decision stays visible).
 * Usage: npm run redirects:generate [-- <path/to/redirect-map.yaml>]
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { parse } from 'yaml';
const mapPath = process.argv[2] || 'artifacts/redirect-map.yaml';
if (!existsSync(mapPath)) { console.log(`redirects:generate — no ${mapPath} (new site, nothing to redirect)`); process.exit(0); }
const map = parse(readFileSync(mapPath, 'utf8'));
const vj = existsSync('vercel.json') ? JSON.parse(readFileSync('vercel.json', 'utf8')) : {};
const redirects = []; const gone = [];
for (const r of map.redirects ?? []) {
  if (r.status === 301 && r.to) {
    const from = String(r.from).replace(/\/$/, '');
    for (const src of new Set([from || '/', `${from}/`])) redirects.push({ source: src, destination: r.to, permanent: true });
  } else if (r.status === 410) gone.push(r.from);
}
vj.redirects = redirects;
writeFileSync('vercel.json', JSON.stringify(vj, null, 2) + '\n');
console.log(`redirects:generate — ${redirects.length} redirect rule(s) from ${(map.redirects ?? []).length} map rows written to vercel.json${gone.length ? `; ${gone.length} 410(s) left to 404: ${gone.join(', ')}` : ''}`);
