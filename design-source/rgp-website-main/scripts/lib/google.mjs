/**
 * Google API access as the AGENCY Google account (§28 launch indexing).
 *
 * No service account: clients grant Search Console access to the agency email at onboarding, so the
 * scripts act as that account through OAuth. The keys are GitHub organization secrets (owner decision
 * 2026-10-21; the owner stores them once with `npm run search:connect`) — nobody holds them on a computer.
 * The workflow that uses them writes them to temp files (mode 600) and points these env vars at them:
 *
 *   GOOGLE_OAUTH_CLIENT_FILE  the "Desktop app" OAuth client: { installed: { client_id, client_secret } }
 *   GOOGLE_TOKEN_FILE         the sign-in: { refresh_token, email, scopes, created }
 *
 * Written by: the "Search engines" workflow (scripts/search-engines-ci.mjs) and each client repo's blog
 * publish workflow (.github/workflows/publish-scheduled-posts.yml, §29).
 */
import { readFileSync, existsSync } from 'node:fs';

export const CLIENT_FILE = process.env.GOOGLE_OAUTH_CLIENT_FILE || '';
export const TOKEN_FILE = process.env.GOOGLE_TOKEN_FILE || '';
export const SCOPES = [
  'https://www.googleapis.com/auth/webmasters',        // Search Console: properties, sitemaps, URL inspection
  'https://www.googleapis.com/auth/siteverification',  // verify ownership with the HTML file
  'openid',
  'email',                                             // record WHICH Google account signed in
];
const NO_KEYS = 'the Google keys are GitHub organization secrets — run `npm run gsc` (it uses the "Search engines" workflow), or the owner runs `npm run search:connect`';

export function readClient() {
  if (!CLIENT_FILE || !existsSync(CLIENT_FILE)) throw new Error(`no Google OAuth client (GOOGLE_OAUTH_CLIENT_FILE) — ${NO_KEYS}`);
  const raw = JSON.parse(readFileSync(CLIENT_FILE, 'utf8'));
  const c = raw.installed ?? raw.web ?? raw;
  if (!c.client_id || !c.client_secret) throw new Error('the Google OAuth client is incomplete — the owner runs `npm run search:connect`');
  return { clientId: c.client_id, clientSecret: c.client_secret };
}

let cached = null;

/** A fresh access token for the agency account (refreshes from the stored refresh token). */
export async function accessToken() {
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
  if (!TOKEN_FILE || !existsSync(TOKEN_FILE)) throw new Error(`no Google sign-in (GOOGLE_TOKEN_FILE) — ${NO_KEYS}`);
  const stored = JSON.parse(readFileSync(TOKEN_FILE, 'utf8'));
  const { clientId, clientSecret } = readClient();
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: stored.refresh_token, grant_type: 'refresh_token' }),
  });
  const body = await res.json();
  if (!res.ok) {
    const hint = body.error === 'invalid_grant'
      ? ' — the sign-in expired or was revoked. If the OAuth consent screen is "External" in Testing mode, Google expires it after 7 days: set it to Internal (Google Workspace) or publish it, then the owner runs `npm run search:connect`'
      : '';
    const client = body.error === 'invalid_client' || body.error === 'unauthorized_client'
      ? ' — the OAuth client ID/secret do not match the stored sign-in (secret rotated?): the owner runs `npm run search:connect`'
      : '';
    throw new Error(`Google token refresh failed: ${body.error_description ?? body.error ?? res.status}${hint}${client}`);
  }
  cached = { token: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
  return cached.token;
}

/** Which agency account the stored sign-in belongs to (for messages and evidence). */
export function signedInAs() {
  try { return JSON.parse(readFileSync(TOKEN_FILE, 'utf8')).email ?? 'unknown account'; } catch { return 'not signed in'; }
}

/** fetch against a Google API with the agency token; throws with Google's message on failure. */
export async function gapi(url, { method = 'GET', body } = {}) {
  const res = await fetch(url, {
    method,
    headers: { authorization: `Bearer ${await accessToken()}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const err = new Error(`${method} ${url.replace(/\?.*$/, '')} → ${res.status}: ${data.error?.message ?? text}`);
    err.status = res.status;
    throw err;
  }
  return data;
}
