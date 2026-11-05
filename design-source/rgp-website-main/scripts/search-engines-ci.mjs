#!/usr/bin/env node
/**
 * search-engines-ci.mjs — the body of the workflow "Search engines" (.github/workflows/search-engines.yml in
 * agent-website-builder; CORE_CONTRACTS §28). Client repos start it through `npm run gsc` / `npm run bing`
 * (scripts/lib/search-remote.mjs); nobody runs it by hand.
 *
 * Inputs (env): SITE_URL (production origin), ACTION (gsc-status … bing-submit), URLS (gsc-inspect only),
 * RESULT_DIR (uploaded as the `result` artifact). Secrets (env, GitHub organization secrets):
 *   GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_TOKEN_JSON   for gsc-*  (owner: npm run search:connect)
 *   BING_WEBMASTER_API_KEY                                                  for bing-* (owner: npm run search:connect -- --bing-only)
 *
 * It checks the inputs, fails with a plain message when a secret is missing, writes the Google keys to temp
 * files (mode 600, deleted afterwards) for scripts/lib/google.mjs, runs search-console.mjs / bing-webmaster.mjs
 * with SEARCH_SITE_URL set, and leaves in RESULT_DIR: output.txt (what the script printed), exit.json, and the
 * evidence JSON. Secrets are never printed: they are masked in the log, never passed on argv, and scrubbed
 * from every result file before upload (artifacts are not masked by GitHub).
 */
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

export const ACTIONS = {
  'gsc-status': ['gsc', ['status']],
  'gsc-verify-prepare': ['gsc', ['verify-prepare']],
  'gsc-verify': ['gsc', ['verify']],
  'gsc-submit': ['gsc', ['submit']],
  'gsc-submit-check': ['gsc', ['submit', '--check']],
  'gsc-inspect': ['gsc', ['inspect']],
  'bing-status': ['bing', ['status']],
  'bing-verify-prepare': ['bing', ['verify-prepare']],
  'bing-verify': ['bing', ['verify']],
  'bing-submit': ['bing', ['submit']],
};
const SCRIPT = { gsc: 'search-console.mjs', bing: 'bing-webmaster.mjs' };
export const SECRETS = { gsc: ['GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET', 'GOOGLE_TOKEN_JSON'], bing: ['BING_WEBMASTER_API_KEY'] };
const HINT = {
  gsc: 'The owner runs `npm run search:connect` once in their own terminal: it signs in to Google as the agency account and stores them as GitHub organization secrets.',
  bing: 'The owner adds it with `npm run search:connect -- --bing-only` (key from Bing Webmaster Tools → Settings → API Access).',
};

/** Inputs → { tool, args, site, urls } or { problem }. Pure (unit-tested). */
export function planCentral(env) {
  const entry = ACTIONS[env.ACTION ?? ''];
  if (!entry) return { problem: `unknown action "${env.ACTION ?? ''}" — one of: ${Object.keys(ACTIONS).join(', ')}` };
  const [tool, args] = entry;
  let u = null;
  try { u = new URL(String(env.SITE_URL ?? '').trim()); } catch { /* below */ }
  if (!u || !/^https?:$/.test(u.protocol) || u.username || u.password || u.search || u.hash || !['', '/'].includes(u.pathname)
    || /(^|\.)example\.com$/.test(u.hostname) || !u.hostname.includes('.')) {
    return { tool, problem: `site_url "${env.SITE_URL ?? ''}" is not a production origin like https://www.client.com` };
  }
  const urls = String(env.URLS ?? '').split(/[\s,]+/).filter(Boolean);
  if (urls.length && env.ACTION !== 'gsc-inspect') return { tool, problem: 'urls is only for gsc-inspect' };
  if (urls.length > 20) return { tool, problem: 'at most 20 urls per inspect' };
  for (const x of urls) {
    let p = null;
    try { p = new URL(x); } catch { /* below */ }
    if (!p || !/^https?:$/.test(p.protocol)) return { tool, problem: `"${x}" is not a full page URL` };
  }
  return { tool, args, site: u.origin, urls };
}

export const missingSecrets = (tool, env) => SECRETS[tool].filter((n) => !String(env[n] ?? '').trim());

/** Replace every secret value (and the refresh token inside GOOGLE_TOKEN_JSON) with ***. */
export function scrub(text, secrets) {
  let out = String(text);
  for (const s of secrets) if (s && s.length >= 6) out = out.split(s).join('***');
  return out;
}

function main() {
  const env = process.env;
  const resultDir = env.RESULT_DIR || join(tmpdir(), 'search-engines-result');
  mkdirSync(resultDir, { recursive: true });
  let output = '';
  let keyDir = null;
  const say = (line) => { console.log(line); output += `${line}\n`; };
  const done = (exit) => {
    const secrets = secretValues(env);
    writeFileSync(join(resultDir, 'output.txt'), scrub(output, secrets));
    for (const f of readdirSync(resultDir)) {
      const p = join(resultDir, f);
      writeFileSync(p, scrub(readFileSync(p, 'utf8'), secrets));
    }
    writeFileSync(join(resultDir, 'exit.json'), JSON.stringify({ exit, action: env.ACTION ?? null, site: env.SITE_URL ?? null }));
    if (keyDir) rmSync(keyDir, { recursive: true, force: true });
    process.exit(exit);
  };

  const plan = planCentral(env);
  if (plan.problem) { say(`✗ ${plan.tool ?? 'search engines'} — ${plan.problem}`); done(1); }
  const missing = missingSecrets(plan.tool, env);
  if (missing.length) {
    say(`✗ ${plan.tool} ${plan.args[0]} — ${missing.join(' not set, ')} not set (GitHub organization secret${missing.length > 1 ? 's' : ''} for agent-website-builder). ${HINT[plan.tool]}`);
    done(1);
  }
  // GitHub already masks each secret; this adds the refresh token inside GOOGLE_TOKEN_JSON (short lines like "{" are skipped).
  if (env.GITHUB_ACTIONS) for (const s of secretValues(env)) for (const line of s.split('\n')) if (line.trim().length >= 8) console.log(`::add-mask::${line.trim()}`);

  const childEnv = { PATH: env.PATH, HOME: env.HOME, SEARCH_SITE_URL: plan.site, SEARCH_EVIDENCE_DIR: resultDir };
  keyDir = mkdtempSync(join(env.RUNNER_TEMP || tmpdir(), 'search-keys-'));
  try {
    if (plan.tool === 'gsc') {
      let token;
      try { token = JSON.parse(env.GOOGLE_TOKEN_JSON); } catch { token = null; }
      if (!token?.refresh_token) { say('✗ gsc — GOOGLE_TOKEN_JSON is not a saved Google sign-in (no refresh_token). The owner runs `npm run search:connect` again.'); done(1); }
      const clientFile = join(keyDir, 'google-oauth-client.json');
      const tokenFile = join(keyDir, 'google-token.json');
      writeFileSync(clientFile, JSON.stringify({ installed: { client_id: env.GOOGLE_OAUTH_CLIENT_ID.trim(), client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET.trim() } }), { mode: 0o600 });
      writeFileSync(tokenFile, JSON.stringify(token), { mode: 0o600 });
      Object.assign(childEnv, { GOOGLE_OAUTH_CLIENT_FILE: clientFile, GOOGLE_TOKEN_FILE: tokenFile });
    } else {
      childEnv.BING_WEBMASTER_API_KEY = env.BING_WEBMASTER_API_KEY.trim();
    }
    const here = dirname(fileURLToPath(import.meta.url));
    const r = spawnSync(process.execPath, ['--experimental-strip-types', join(here, SCRIPT[plan.tool]), ...plan.args, ...plan.urls],
      { cwd: join(here, '..'), env: childEnv, encoding: 'utf8', timeout: 8 * 60_000 });
    for (const stream of [r.stdout, r.stderr]) for (const line of String(stream ?? '').split('\n')) if (line.trim()) say(scrub(line, secretValues(env)));
    if (r.error) say(`✗ ${plan.tool} — ${r.error.message}`);
    done(r.status ?? 1);
  } catch (e) {
    say(`✗ ${plan.tool} — ${scrub(e.message, secretValues(env))}`);
    done(1);
  }
}

function secretValues(env) {
  const vals = [...SECRETS.gsc, ...SECRETS.bing].map((n) => String(env[n] ?? '').trim()).filter(Boolean);
  try { const t = JSON.parse(env.GOOGLE_TOKEN_JSON ?? ''); if (t.refresh_token) vals.push(t.refresh_token); } catch { /* not JSON */ }
  return vals;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
