#!/usr/bin/env node
/**
 * search-console.mjs — Google Search Console for the launched site, as the agency Google account (§28 launch
 * indexing, Launch Checklist 7a). The agency keys are GitHub organization secrets; nobody holds them.
 *
 *   npm run gsc -- status            find the client's property in the agency account and our access level
 *   npm run gsc -- verify            no usable property → create the agency's own: Google's HTML file in
 *                                    public/, then (after it is deployed) verify it and add the property
 *   npm run gsc -- submit            submit /sitemap.xml, then report whether Google downloaded it
 *   npm run gsc -- submit --check    report the sitemap status only
 *   npm run gsc -- inspect [url…]    is the page indexed? (homepage by default)
 *
 * Where it runs (owner decision 2026-10-21):
 *   - In a client repo, `npm run gsc` starts the workflow "Search engines" in agent-website-builder
 *     (scripts/lib/search-remote.mjs: gh workflow run → watch → print → download `result`) and writes the
 *     evidence and the verification file here. Needs only the `gh` login (team website-team).
 *   - In that workflow (SEARCH_SITE_URL set, scripts/search-engines-ci.mjs) this file does the API work, with
 *     the keys written to temp files (GOOGLE_OAUTH_CLIENT_FILE / GOOGLE_TOKEN_FILE). `verify-prepare` only
 *     returns the file name and content the site must publish.
 *   - With GOOGLE_OAUTH_CLIENT_FILE and GOOGLE_TOKEN_FILE set (the blog publish workflow, from the organization
 *     secrets) it runs directly here, as before.
 *
 * Owner decisions 2026-10-05: no service account; clients normally grant the agency email access at
 * onboarding. When `status` finds no property with Owner or Full access, the agent STOPS and asks the
 * human: get access from the client, or create the agency's own property (`verify`). Verification uses
 * the HTML file on the site — never DNS. The file stays in the repo for good: deleting it un-verifies.
 *
 * Each run writes its result to artifacts/launch/search-console.json as Launch Checklist evidence.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gapi, signedInAs } from './lib/google.mjs';

// The central workflow passes the site; with no Google keys here, the central workflow does the work.
const CENTRAL = Boolean(process.env.SEARCH_SITE_URL);
if (!CENTRAL && !(process.env.GOOGLE_OAUTH_CLIENT_FILE && process.env.GOOGLE_TOKEN_FILE)) {
  const { runRemote } = await import('./lib/search-remote.mjs');
  await runRemote('gsc', process.argv.slice(2));
}
const site = CENTRAL ? { siteUrl: process.env.SEARCH_SITE_URL, previewMode: false } : (await import('../src/data/site.ts')).site;
const EVIDENCE_DIR = process.env.SEARCH_EVIDENCE_DIR || 'artifacts/launch';

const [cmd = 'status', ...rest] = process.argv.slice(2);
const flags = new Set(rest.filter((a) => a.startsWith('--')));
const args = rest.filter((a) => !a.startsWith('--'));
const WM = 'https://www.googleapis.com/webmasters/v3';
const origin = String(site.siteUrl).replace(/\/$/, '');
const url = new URL(origin);
const apex = url.hostname.replace(/^www\./, '');
const enc = encodeURIComponent;
const fail = (msg, code = 1) => { console.error(`✗ gsc ${cmd} — ${msg}`); process.exit(code); };
const evidence = (data) => {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  const path = join(EVIDENCE_DIR, 'search-console.json');
  const prev = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {};
  writeFileSync(path, JSON.stringify({ ...prev, site: origin, account: signedInAs(), [cmd]: { ...data, at: new Date().toISOString() } }, null, 2));
};

if (!/^https?:\/\//.test(origin) || /example\.com$/.test(apex)) fail(`site.siteUrl is "${site.siteUrl}" — set the client's production URL first`);

/** Properties that could cover this site, best first: the domain property, then URL-prefix ones. */
const CANDIDATES = [`sc-domain:${apex}`, `${url.origin}/`, `https://www.${apex}/`, `https://${apex}/`, `http://www.${apex}/`, `http://${apex}/`];
const USABLE = new Set(['siteOwner', 'siteFullUser']);

async function findProperty() {
  const { siteEntry = [] } = await gapi(`${WM}/sites`);
  const mine = siteEntry.filter((s) => CANDIDATES.includes(s.siteUrl)).sort((a, b) => CANDIDATES.indexOf(a.siteUrl) - CANDIDATES.indexOf(b.siteUrl));
  return { usable: mine.find((s) => USABLE.has(s.permissionLevel)) ?? null, all: mine };
}

async function status() {
  const { usable, all } = await findProperty();
  console.log(`Agency account: ${signedInAs()} · site: ${origin}`);
  for (const s of all) console.log(`   ${USABLE.has(s.permissionLevel) ? '✓' : '·'} ${s.siteUrl} — ${s.permissionLevel}`);
  evidence({ property: usable?.siteUrl ?? null, access: usable?.permissionLevel ?? null, found: all });
  if (usable) { console.log(`✓ gsc status — using ${usable.siteUrl} (${usable.permissionLevel})`); return usable.siteUrl; }
  const why = all.length
    ? `the agency account only has ${all.map((s) => s.permissionLevel).join(', ')} access — submitting sitemaps needs Owner or Full`
    : `no Search Console property for ${apex} in the agency account`;
  fail(`${why}. ASK THE HUMAN: can the client grant ${signedInAs()} Full access, or should the agency create its own property (\`npm run gsc -- verify\`)?`, 2);
}

/** Google's verification file for this site: its name (token) and the content the site must serve. */
async function verificationFile() {
  const identifier = `${url.origin}/`;
  const { token } = await gapi('https://www.googleapis.com/siteVerification/v1/token', {
    method: 'POST', body: { site: { identifier, type: 'SITE' }, verificationMethod: 'FILE' },
  });
  return { identifier, token, content: `google-site-verification: ${token}` };
}

/** Central workflow only: what the client repo must publish (public by design — it is served on the site). */
async function verifyPrepare() {
  const { identifier, token, content } = await verificationFile();
  evidence({ identifier, file: token, content });
  console.log(`✓ gsc verify-prepare — the site must serve ${url.origin}/${token} containing "${content}"`);
}

async function verify() {
  const { identifier, token, content } = await verificationFile();
  const local = `public/${token}`;
  if (!CENTRAL && (!existsSync(local) || readFileSync(local, 'utf8').trim() !== content)) {
    writeFileSync(local, `${content}\n`);
    console.log(`Wrote ${local}.`);
  }
  // redirect: 'manual' — Google needs the file served directly; a clean-URL or slash redirect fails it.
  const res = await fetch(`${url.origin}/${token}`, { redirect: 'manual' }).catch(() => null);
  if (res && res.status >= 300 && res.status < 400) fail(`${url.origin}/${token} redirects (${res.status} → ${res.headers.get('location')}) — Google needs the file served directly; check vercel.json cleanUrls/trailingSlash`);
  const live = res?.ok ? await res.text() : '';
  if (!live.includes(content)) {
    evidence({ identifier, file: local, live: false });
    fail(`${url.origin}/${token} is not live yet. Commit ${local} and push (main auto-deploys), wait for the deploy, then run \`npm run gsc -- verify\` again. Keep the file in the repo permanently.`, 3);
  }
  await gapi(`https://www.googleapis.com/siteVerification/v1/webResource?verificationMethod=FILE`, { method: 'POST', body: { site: { identifier, type: 'SITE' } } });
  await gapi(`${WM}/sites/${enc(identifier)}`, { method: 'PUT' });
  evidence({ identifier, file: local, live: true, verified: true });
  console.log(`✓ gsc verify — ${identifier} verified by file and added to Search Console; owner: ${signedInAs()}`);
}

async function submit() {
  if (site.previewMode) fail('site.previewMode is true — a noindexed site is not submitted. Launch first (previewMode false, validate:launch, deploy).');
  const { usable } = await findProperty();
  if (!usable) fail('no property with Owner or Full access — run `npm run gsc -- status` and resolve access first', 2);
  const feed = `${url.origin}/sitemap.xml`;
  const path = `${WM}/sites/${enc(usable.siteUrl)}/sitemaps/${enc(feed)}`;
  if (!flags.has('--check')) { await gapi(path, { method: 'PUT' }); console.log(`Submitted ${feed} to ${usable.siteUrl}.`); }
  const sm = await gapi(path);
  const errors = Number(sm.errors ?? 0), warnings = Number(sm.warnings ?? 0);
  const counts = (sm.contents ?? []).map((c) => `${c.type}: ${c.submitted} submitted`).join(', ');
  console.log(`   last submitted ${sm.lastSubmitted ?? '—'} · last downloaded ${sm.lastDownloaded ?? 'not yet'} · errors ${errors} · warnings ${warnings}${counts ? ` · ${counts}` : ''}`);
  evidence({ property: usable.siteUrl, sitemap: feed, lastSubmitted: sm.lastSubmitted ?? null, lastDownloaded: sm.lastDownloaded ?? null, isPending: sm.isPending ?? null, errors, warnings, contents: sm.contents ?? [] });
  if (errors) fail(`Google reports ${errors} error(s) in the sitemap — open it in Search Console, fix, resubmit`);
  if (!sm.lastDownloaded) { console.log('⚠ gsc submit — Google has not downloaded the sitemap yet. Re-check later with `npm run gsc -- submit --check` (usually minutes to a day).'); return; }
  console.log(`✓ gsc submit — Google downloaded the sitemap with no errors${warnings ? ` (${warnings} warning(s) — review them)` : ''}`);
}

async function inspect() {
  const { usable } = await findProperty();
  if (!usable) fail('no property with Owner or Full access — run `npm run gsc -- status` first', 2);
  const urls = args.length ? args : [`${url.origin}/`];
  const results = [];
  for (const u of urls) {
    const r = await gapi('https://searchconsole.googleapis.com/v1/urlInspection/index:inspect', { method: 'POST', body: { inspectionUrl: u, siteUrl: usable.siteUrl } });
    const s = r.inspectionResult?.indexStatusResult ?? {};
    results.push({ url: u, verdict: s.verdict, coverageState: s.coverageState, lastCrawlTime: s.lastCrawlTime ?? null, googleCanonical: s.googleCanonical ?? null });
    console.log(`   ${s.verdict === 'PASS' ? '✓' : '·'} ${u} — ${s.coverageState ?? s.verdict ?? 'unknown'}${s.lastCrawlTime ? ` (crawled ${s.lastCrawlTime})` : ''}`);
  }
  evidence({ property: usable.siteUrl, results });
}

const COMMANDS = { status, verify, submit, inspect, ...(CENTRAL ? { 'verify-prepare': verifyPrepare } : {}) };
if (!COMMANDS[cmd]) fail(`unknown command — use one of: ${Object.keys(COMMANDS).join(', ')}`);
try { await COMMANDS[cmd](); } catch (e) { fail(e.message); }
