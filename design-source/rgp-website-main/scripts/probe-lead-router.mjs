#!/usr/bin/env node
/**
 * probe-lead-router.mjs — prove this site's forms are PROVISIONED in the agency lead router (§27)
 * without creating a lead. A minimal POST (client_id only) is rejected by the Worker's field
 * validation BEFORE honeypot, Turnstile, or persistence — so the response code tells us:
 *   403 "not currently accepting"     → no active `clients` row for this client_id in the router
 *   403 "not allowed from this website" → row exists, but this origin is not in allowed_origins
 *   400 "site_id is required."          → client + origin are provisioned (validation reached)
 * Also checks the site's own config: submitUrl/clientId/siteId/turnstileSiteKey set; siteUrl origin.
 *
 * Usage: npm run leadrouter:probe [-- --origin https://<preview>.vercel.app] [--origin ...]
 * Probes site.siteUrl (with and without www) plus any --origin given. Exit 1 on any failure.
 * It CANNOT verify Turnstile — that needs a real browser submission (see §27 launch step).
 */
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
// Read the CLIENT repo's site.ts (cwd), never the starter's — this script may be run by path.
const { site } = await import(pathToFileURL(resolve(process.cwd(), 'src/data/site.ts')).href);
const args = process.argv.slice(2);
// Older client forks predate site.siteUrl; fall back to astro.config's `site`.
if (!site.siteUrl && existsSync('astro.config.mjs')) {
  const m = readFileSync('astro.config.mjs', 'utf8').match(/\bsite:\s*['"]([^'"]+)['"]/);
  if (m) site.siteUrl = m[1];
}
const extra = args.flatMap((a, i) => (a === '--origin' && args[i + 1] ? [args[i + 1]] : []));
const r = site.leadRouter ?? {};
const fails = []; const fail = (m) => { fails.push(m); console.error(`  ✗ ${m}`); }; const ok = (m) => console.log(`  ✓ ${m}`);

for (const k of ['submitUrl', 'clientId', 'siteId', 'turnstileSiteKey'])
  r[k] ? ok(`site.leadRouter.${k} set`) : fail(`site.leadRouter.${k} is empty — forms are disabled until it is set (RequestServicePanel gates on it)`);
if (!site.siteUrl || /example\.com/.test(site.siteUrl)) fail(`site.siteUrl is "${site.siteUrl}" — set the real production origin first`);
if (fails.length) done();

const base = new URL(site.siteUrl).origin;
const alt = base.includes('://www.') ? base.replace('://www.', '://') : base.replace('://', '://www.');
const origins = [...new Set([base, alt, ...extra])];
for (const origin of origins) {
  let res, body;
  try {
    res = await fetch(r.submitUrl, { method: 'POST', headers: { Accept: 'application/json', Origin: origin, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: r.clientId }) });
    body = await res.json().catch(() => ({}));
  } catch (e) { fail(`${origin}: could not reach ${r.submitUrl} — ${e.message}`); continue; }
  const msg = String(body.error || '');
  if (res.status === 400 && /site_id is required/.test(msg)) ok(`${origin}: client "${r.clientId}" active + origin allowed (validation reached, nothing stored)`);
  else if (res.status === 403 && /not currently accepting/.test(msg)) fail(`${origin}: no ACTIVE clients row for "${r.clientId}" in the router — run npm run leadrouter:setup (§27)`);
  else if (res.status === 403 && /not allowed from this website/.test(msg)) fail(`${origin}: not in allowed_origins for "${r.clientId}" — re-run npm run leadrouter:setup -- --origin ${origin}`);
  else fail(`${origin}: unexpected ${res.status} ${msg || '(no message)'}`);
}
console.log('  · Turnstile cannot be probed here: do ONE real submission in a browser on the deployed site, then npm run leadrouter:setup -- --check and find it in GHL New Leads (§27).');
done();
function done() { console.log(fails.length ? `\n✗ leadrouter:probe failed — ${fails.length} problem(s)` : `\n✓ leadrouter:probe passed for ${origins?.length ?? 0} origin(s)`); process.exit(fails.length ? 1 : 0); }
