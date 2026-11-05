#!/usr/bin/env node
/**
 * search-connect.mjs — the OWNER's one-time Google sign-in for Search Console (CORE_CONTRACTS §28; owner decision
 * 2026-10-21: the agency keys live in GitHub, nobody holds them). Run it in your own terminal, never through
 * the agent:
 *
 *   npm run search:connect                 Google OAuth client ID + secret, Google sign-in, (optional) Bing key
 *   npm run search:connect -- --bing-only  only the Bing Webmaster API key
 *
 * Run it again only when Google access is revoked, the OAuth client secret is rotated, or the Bing key changes.
 *
 * 1. Checks your `gh` login can write organization secrets in Restoration-Growth-Partners (org admin, token
 *    scope admin:org) — BEFORE asking for anything.
 * 2. Asks for the client ID and secret (and the Bing key) with a hidden prompt that reads a whole paste —
 *    in chunks, with \r\n — never echoes it, and discards anything left over so nothing reaches the shell.
 * 3. Opens Google's sign-in (loopback + PKCE): sign in as the AGENCY Google account and click Allow.
 * 4. Stores, as GitHub ORGANIZATION secrets (value on stdin; never argv, never printed, never on disk):
 *      GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_TOKEN_JSON  → the "Search engines" workflow
 *                                                                              (agent-website-builder) AND every
 *                                                                              client repo's weekly blog publish
 *                                                                              workflow (§29), which builds the
 *                                                                              client file from the ID + secret
 *      BING_WEBMASTER_API_KEY                                                 → the "Search engines" workflow
 *    An existing secret keeps its visibility (which repos can read it). New ones: the Google secrets are
 *    visible to all org repos (client repos' blog workflows read them), the Bing key only to agent-website-builder.
 *    GOOGLE_OAUTH_CLIENT_JSON (the client as JSON, written by older versions) is no longer used or written — one
 *    copy of each key; if it still exists, this prints a reminder that the owner may delete it.
 */
import { createServer } from 'node:http';
import { randomBytes, createHash } from 'node:crypto';
import { execFile, spawnSync } from 'node:child_process';
import { SCOPES } from './lib/google.mjs';
import { HiddenInput, Cancelled, askValid, checkClientId, checkClientSecret, checkBingKey } from './lib/hidden-prompt.mjs';

const ORG = 'Restoration-Growth-Partners';
const SYSTEM_REPO = 'agent-website-builder';
const BING_ONLY = process.argv.includes('--bing-only');
const gh = (args, input) => spawnSync('gh', args, { encoding: 'utf8', ...(input === undefined ? {} : { input }) });
const fail = (msg) => { console.error(`\n✗ search:connect — ${msg}`); process.exit(1); };

if (!process.stdin.isTTY) fail('run this in your own terminal: npm run search:connect');

// 1. Can this gh login write organization secrets?
if (gh(['auth', 'status']).status !== 0) fail('not logged in to GitHub — run: gh auth login (the owner account)');
const login = gh(['api', 'user', '--jq', '.login']).stdout.trim();
const role = gh(['api', `user/memberships/orgs/${ORG}`, '--jq', '.role']).stdout.trim();
if (role !== 'admin') fail(`${login || 'this GitHub login'} is not an owner of ${ORG} — organization secrets need an org owner`);
if (gh(['api', `orgs/${ORG}/actions/secrets/public-key`]).status !== 0) {
  fail('your gh login cannot write organization secrets yet. Run this once, then run npm run search:connect again:\n\n    gh auth refresh -h github.com -s admin:org\n');
}
console.log(`✓ GitHub: ${login}, owner of ${ORG}`);

// 2. Ask for everything up front (one reader for the whole session; drained before it is released).
const io = new HiddenInput().start();
let clientId = '', clientSecret = '', bingKey = '';
try {
  console.log('\nPaste each value and press Enter. Nothing shows while you paste — that is expected.\n');
  if (!BING_ONLY) {
    clientId = await askValid(io, 'Google OAuth client ID: ', checkClientId);
    clientSecret = await askValid(io, 'Google OAuth client secret: ', checkClientSecret);
  }
  bingKey = await askValid(io, BING_ONLY ? 'Bing Webmaster API key: ' : 'Bing Webmaster API key (Enter to skip): ', checkBingKey, { optional: !BING_ONLY });
} catch (e) {
  await io.drain();
  io.stop();
  fail(e instanceof Cancelled ? 'cancelled — nothing was saved' : `${e.message} — nothing was saved`);
}
await io.drain();
io.stop();

// 3. Google sign-in as the agency account → refresh token (kept in memory only).
const token = BING_ONLY ? null : await signIn(clientId, clientSecret);

// 4. Store as organization secrets.
const secrets = [];
if (token) {
  secrets.push(
    ['GOOGLE_OAUTH_CLIENT_ID', clientId, 'all'],
    ['GOOGLE_OAUTH_CLIENT_SECRET', clientSecret, 'all'],
    ['GOOGLE_TOKEN_JSON', JSON.stringify(token), 'all'],
  );
}
if (bingKey) secrets.push(['BING_WEBMASTER_API_KEY', bingKey, 'selected']);
console.log('');
const failed = [];
for (const [name, value, defaultVisibility] of secrets) {
  const vis = visibilityArgs(name, defaultVisibility);
  const r = gh(['secret', 'set', name, '--org', ORG, ...vis], value);
  if (r.status === 0) console.log(`✓ ${name} saved (organization secret, ${vis.slice(1).join(' ')})`);
  else { failed.push(name); console.error(`✗ ${name} NOT saved: ${r.stderr.trim()}`); }
}
if (failed.length) fail(`${failed.length} secret(s) not saved — fix the error above and run npm run search:connect again`);
if (!bingKey && !BING_ONLY) console.log('· Bing key skipped — add it later with: npm run search:connect -- --bing-only');
if (token && gh(['api', `orgs/${ORG}/actions/secrets/GOOGLE_OAUTH_CLIENT_JSON`]).status === 0) {
  console.log('· GOOGLE_OAUTH_CLIENT_JSON is no longer used (the blog workflows build the client file from GOOGLE_OAUTH_CLIENT_ID +\n'
    + '  GOOGLE_OAUTH_CLIENT_SECRET) and still holds an older copy — delete it: GitHub → organization Settings → Secrets and\n'
    + `  variables → Actions → GOOGLE_OAUTH_CLIENT_JSON → Remove (or: gh secret delete GOOGLE_OAUTH_CLIENT_JSON --org ${ORG}).`);
}
console.log(`\n✓ search:connect — done. Nothing was written to this computer.${token ? `\n  Check from any client repo: npm run gsc -- status` : ''}`);
process.exit(0);

/** Keep an existing secret's visibility; a new one gets the default. */
function visibilityArgs(name, fallback) {
  const cur = gh(['api', `orgs/${ORG}/actions/secrets/${name}`, '--jq', '.visibility']);
  const visibility = cur.status === 0 ? cur.stdout.trim() : fallback;
  if (visibility !== 'selected') return ['--visibility', visibility];
  const repos = cur.status === 0
    ? gh(['api', '--paginate', `orgs/${ORG}/actions/secrets/${name}/repositories`, '--jq', '.repositories[].name']).stdout.trim().split('\n').filter(Boolean)
    : [SYSTEM_REPO];
  return repos.length ? ['--visibility', 'selected', '--repos', repos.join(',')] : ['--visibility', 'selected', '--no-repos-selected'];
}

/** Google OAuth loopback sign-in with PKCE; resolves with { refresh_token, email, scopes, created }. */
function signIn(id, secret) {
  return new Promise((resolveToken) => {
    const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const verifier = b64url(randomBytes(48));
    const challenge = b64url(createHash('sha256').update(verifier).digest());
    const state = b64url(randomBytes(16));
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const redirectUri = `http://127.0.0.1:${server.address().port}`;
      const url = `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({
        client_id: id, redirect_uri: redirectUri, response_type: 'code', scope: SCOPES.join(' '),
        access_type: 'offline', prompt: 'consent', code_challenge: challenge, code_challenge_method: 'S256', state,
      })}`;
      console.log('\nA Google sign-in page is opening. Sign in as the AGENCY Google account and click Allow.');
      console.log(`If it does not open, paste this into your browser:\n\n  ${url}\n`);
      if (process.platform === 'darwin') execFile('open', [url], () => {});
      else if (process.platform === 'win32') execFile('cmd', ['/c', 'start', '', url], () => {});
      const timer = setTimeout(() => fail('no sign-in within 5 minutes — run npm run search:connect again'), 5 * 60_000);

      server.on('request', async (req, res) => {
        const q = new URL(req.url, redirectUri).searchParams;
        if (!q.get('code') && !q.get('error')) { res.writeHead(404).end(); return; }
        const done = (msg) => new Promise((r) => res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }).end(msg, r));
        if (q.get('state') !== state) { await done('Something went wrong — close this tab and run npm run search:connect again.'); fail('state mismatch'); }
        if (q.get('error')) { await done('Google sign-in was cancelled. You can close this tab.'); fail(`Google returned: ${q.get('error')}`); }
        const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ code: q.get('code'), client_id: id, client_secret: secret, redirect_uri: redirectUri, grant_type: 'authorization_code', code_verifier: verifier }),
        });
        const tok = await tokenRes.json();
        if (!tokenRes.ok || !tok.refresh_token) { await done('Sign-in failed — see the terminal.'); fail(`Google sign-in failed: ${tok.error_description ?? tok.error ?? 'no refresh token returned'}`); }
        let email = 'unknown account';
        try { email = JSON.parse(Buffer.from(tok.id_token.split('.')[1], 'base64').toString()).email ?? email; } catch { /* no id_token */ }
        // Prove the sign-in works for Search Console before storing it.
        const sites = await fetch('https://www.googleapis.com/webmasters/v3/sites', { headers: { authorization: `Bearer ${tok.access_token}` } })
          .then((r) => (r.ok ? r.json() : null)).catch(() => null);
        await done(`Signed in as ${email}. You can close this tab.`);
        clearTimeout(timer);
        server.close();
        if (!sites) fail(`signed in as ${email}, but Search Console did not answer — check the Search Console API is on in the Google Cloud project; nothing was saved`);
        console.log(`✓ Google signed in as ${email} — Search Console shows ${(sites.siteEntry ?? []).length} propert${(sites.siteEntry ?? []).length === 1 ? 'y' : 'ies'}`);
        resolveToken({ refresh_token: tok.refresh_token, email, scopes: tok.scope, created: new Date().toISOString() });
      });
    });
  });
}
