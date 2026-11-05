#!/usr/bin/env node
/**
 * bing-webmaster.mjs — Bing Webmaster Tools for the launched site, through the agency Bing account's API key
 * (§28 launch indexing, Launch Checklist 7b). One key covers every site in the agency account.
 *
 *   npm run bing -- status           is the site in the agency account, and verified?
 *   npm run bing -- verify           add the site, publish public/BingSiteAuth.xml, then (after deploy) verify
 *   npm run bing -- submit           submit /sitemap.xml and list the sitemaps Bing knows
 *
 * Key: the GitHub organization secret BING_WEBMASTER_API_KEY (owner: `npm run search:connect -- --bing-only`), with
 * repository access "All repositories": agent-website-builder uses it here and every client repo's post-deploy
 * workflow "Tell search engines" (search-notify.yml) runs `submit` with it after each production deploy.
 * Nobody holds it. In a client repo, `npm run bing` starts the workflow "Search engines" in agent-website-builder
 * (scripts/lib/search-remote.mjs) and writes the evidence and public/BingSiteAuth.xml here; in that workflow
 * (SEARCH_SITE_URL set) this file does the API work, and `verify-prepare` returns only the site's auth code.
 * IndexNow (`npm run indexnow:submit`) still announces the pages; this registers the site and sitemap.
 *
 * Each run writes its result to artifacts/launch/bing-webmaster.json as Launch Checklist evidence.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { mergeBingAuth } from './lib/search-remote.mjs';

// The central workflow passes the site; with no Bing key here, the central workflow does the work.
const CENTRAL = Boolean(process.env.SEARCH_SITE_URL);
if (!CENTRAL && !process.env.BING_WEBMASTER_API_KEY) {
  const { runRemote } = await import('./lib/search-remote.mjs');
  await runRemote('bing', process.argv.slice(2));
}
const site = CENTRAL ? { siteUrl: process.env.SEARCH_SITE_URL, previewMode: false } : (await import('../src/data/site.ts')).site;
const EVIDENCE_DIR = process.env.SEARCH_EVIDENCE_DIR || 'artifacts/launch';

const [cmd = 'status'] = process.argv.slice(2);
const API = 'https://ssl.bing.com/webmaster/api.svc/json';
const origin = String(site.siteUrl).replace(/\/$/, '');
const siteUrl = `${origin}/`;
const fail = (msg, code = 1) => { console.error(`✗ bing ${cmd} — ${msg}`); process.exit(code); };
const key = process.env.BING_WEBMASTER_API_KEY || '';
const evidence = (data) => {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  const path = join(EVIDENCE_DIR, 'bing-webmaster.json');
  const prev = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {};
  writeFileSync(path, JSON.stringify({ ...prev, site: siteUrl, [cmd]: { ...data, at: new Date().toISOString() } }, null, 2));
};

if (!key) fail('BING_WEBMASTER_API_KEY not set — it is a GitHub organization secret for agent-website-builder (owner: `npm run search:connect -- --bing-only`)');
if (!/^https?:\/\//.test(origin) || /example\.com$/.test(new URL(origin).hostname)) fail(`site.siteUrl is "${site.siteUrl}" — set the client's production URL first`);

async function bing(method, { query = {}, body } = {}) {
  const qs = new URLSearchParams({ ...query, apikey: key });
  const res = await fetch(`${API}/${method}?${qs}`, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'content-type': 'application/json; charset=utf-8' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { /* non-JSON error page */ }
  if (!res.ok) throw new Error(`${method} → ${res.status}: ${data.Message ?? data.message ?? text.slice(0, 200)}`);
  return data.d;
}
const sameSite = (u) => String(u ?? '').replace(/\/$/, '').toLowerCase() === origin.toLowerCase();
const findSite = async () => (await bing('GetUserSites') ?? []).find((s) => sameSite(s.Url)) ?? null;

async function status() {
  const s = await findSite();
  evidence({ inAccount: Boolean(s), verified: Boolean(s?.IsVerified) });
  if (!s) fail(`${siteUrl} is not in the agency Bing account — run \`npm run bing -- verify\``, 2);
  if (!s.IsVerified) fail(`${siteUrl} is in the account but not verified — run \`npm run bing -- verify\``, 2);
  console.log(`✓ bing status — ${siteUrl} is verified in the agency account`);
}

/** The site in the agency account (added if missing) and its auth code; null code when already verified. */
async function siteAndCode() {
  let s = await findSite();
  if (s?.IsVerified) return { verified: true, code: null };
  if (!s) { await bing('AddSite', { body: { siteUrl } }); s = await findSite(); console.log(`Added ${siteUrl} to the agency Bing account.`); }
  const code = s?.AuthenticationCode;
  if (!code) fail('Bing returned no authentication code for the site — check it in Bing Webmaster Tools');
  return { verified: false, code };
}

/** Central workflow only: the code public/BingSiteAuth.xml must list (public by design — it is served on the site). */
async function verifyPrepare() {
  const { verified, code } = await siteAndCode();
  evidence({ verified, code });
  console.log(verified ? `✓ bing verify-prepare — ${siteUrl} is already verified` : `✓ bing verify-prepare — ${origin}/BingSiteAuth.xml must list ${code}`);
}

async function verify() {
  const { verified, code } = await siteAndCode();
  if (verified) { evidence({ verified: true }); console.log(`✓ bing verify — ${siteUrl} is already verified`); return; }
  // BingSiteAuth.xml can list several users, so a client's own code (if any) is kept alongside ours.
  const path = 'public/BingSiteAuth.xml';
  const next = CENTRAL ? null : mergeBingAuth(existsSync(path) ? readFileSync(path, 'utf8') : '', code);
  if (next) { writeFileSync(path, next); console.log(`Wrote ${path}.`); }
  const live = await fetch(`${origin}/BingSiteAuth.xml`).then((r) => (r.ok ? r.text() : '')).catch(() => '');
  if (!live.includes(code)) {
    evidence({ file: path, live: false });
    fail(`${origin}/BingSiteAuth.xml is not live with the agency code yet. Commit ${path} and push (main auto-deploys), wait for the deploy, then run \`npm run bing -- verify\` again. Keep the file in the repo permanently.`, 3);
  }
  const ok = await bing('VerifySite', { body: { siteUrl } });
  evidence({ file: path, live: true, verified: Boolean(ok) });
  if (!ok) fail('Bing did not accept the verification yet — wait a few minutes after the deploy and run it again');
  console.log(`✓ bing verify — ${siteUrl} verified in the agency Bing account`);
}

async function submit() {
  if (site.previewMode) fail('site.previewMode is true — a noindexed site is not submitted. Launch first.');
  const s = await findSite();
  if (!s?.IsVerified) fail('the site is not verified in the agency Bing account — run `npm run bing -- verify` first', 2);
  const feedUrl = `${origin}/sitemap.xml`;
  await bing('SubmitFeed', { body: { siteUrl, feedUrl } });
  const feeds = (await bing('GetFeeds', { query: { siteUrl } })) ?? [];
  for (const f of feeds) console.log(`   ${f.Url} — ${f.Status ?? 'status unknown'}${f.LastCrawled ? `, last crawled ${f.LastCrawled}` : ''}${f.UrlCount != null ? `, ${f.UrlCount} URLs` : ''}`);
  evidence({ sitemap: feedUrl, feeds });
  console.log(`✓ bing submit — ${feedUrl} submitted to Bing`);
}

const COMMANDS = { status, verify, submit, ...(CENTRAL ? { 'verify-prepare': verifyPrepare } : {}) };
if (!COMMANDS[cmd]) fail(`unknown command — use one of: ${Object.keys(COMMANDS).join(', ')}`);
try { await COMMANDS[cmd](); } catch (e) { fail(e.message); }
