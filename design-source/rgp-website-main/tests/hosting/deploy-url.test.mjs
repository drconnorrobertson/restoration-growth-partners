/**
 * Which address `npm run deploy:verify` smoke-tests (scripts/lib/deploy-url.mjs, CORE_CONTRACTS §25). No network.
 * Proves: --url always wins; a launched site is tested on site.siteUrl; a pre-launch site on the Vercel project's
 * stable *.vercel.app alias; and the two addresses that fail falsely — the vercel.com dashboard link Vercel posts on
 * GitHub, and the protected per-deployment URL — are never chosen (2026-10-28: CVW reported / 308 and robots,
 * llms, sitemap 404 while production was fine).
 * Run: npm run test:hosting
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chooseSmokeUrl, pickStableAlias, vercelProjectFromStatusUrl } from '../../scripts/lib/deploy-url.mjs';

const STATUS_URL = 'https://vercel.com/restoration-growth-partners/client-central-valley-water-restoration-website/AT2A4Q7w13w2RRpLer8cy6pa5Lo3';
const DEPLOYMENT_URL = 'https://client-central-valley-water-restoration-website-c4akh6dza.vercel.app';
// The real CVW response (2026-10-28): custom domains + a shortened stable alias.
const CVW_DOMAINS = { domains: [
  { name: 'cvwrestorations.com', redirect: 'www.cvwrestorations.com', redirectStatusCode: 308, gitBranch: null, customEnvironmentId: null, verified: true },
  { name: 'www.cvwrestorations.com', redirect: null, gitBranch: null, customEnvironmentId: null, verified: true },
  { name: 'client-central-valley-water-restora.vercel.app', redirect: null, gitBranch: null, customEnvironmentId: null, verified: true },
] };
const LAUNCHED = { previewMode: false, siteUrl: 'https://www.cvwrestorations.com' };
const PRE_LAUNCH = { previewMode: true, siteUrl: 'https://www.newclient.com' };

test('launched site (previewMode false) → site.siteUrl, never the GitHub status link or a deployment URL', () => {
  const r = chooseSmokeUrl({ site: LAUNCHED, alias: 'https://client-central-valley-water-restora.vercel.app' });
  assert.deepEqual(r, { url: 'https://www.cvwrestorations.com', source: 'site.siteUrl (launched site)' });
  // A path or trailing slash on siteUrl is reduced to the origin the smoke paths are appended to.
  assert.equal(chooseSmokeUrl({ site: { previewMode: false, siteUrl: 'https://www.cvwrestorations.com/' } }).url, 'https://www.cvwrestorations.com');
});

test('pre-launch site (previewMode true) → the stable production alias', () => {
  const r = chooseSmokeUrl({ site: PRE_LAUNCH, alias: pickStableAlias(CVW_DOMAINS) });
  assert.equal(r.url, 'https://client-central-valley-water-restora.vercel.app');
  assert.match(r.source, /stable production alias/);
});

test('--url always wins, with or without a scheme', () => {
  assert.deepEqual(chooseSmokeUrl({ cliUrl: 'https://www.cvwrestorations.com/', site: PRE_LAUNCH, alias: 'https://x.vercel.app' }), { url: 'https://www.cvwrestorations.com', source: '--url' });
  assert.equal(chooseSmokeUrl({ cliUrl: 'preview-abc.vercel.app', site: LAUNCHED }).url, 'https://preview-abc.vercel.app');
  assert.equal(chooseSmokeUrl({ cliUrl: 'not a url', site: LAUNCHED }).url, null);
});

test('no alias before launch → a clear failure naming --url; the deployment URL is never a fallback', () => {
  const r = chooseSmokeUrl({ site: PRE_LAUNCH, alias: null });
  assert.equal(r.url, null);
  assert.match(r.problem, /--url https:\/\/<alias>\.vercel\.app/);
  assert.match(r.problem, /vercel login/);
});

test('a launched site with a missing or placeholder siteUrl fails instead of guessing', () => {
  for (const siteUrl of ['', 'https://example.com', undefined]) {
    const r = chooseSmokeUrl({ site: { previewMode: false, siteUrl } });
    assert.equal(r.url, null, String(siteUrl));
    assert.match(r.problem, /site\.siteUrl/);
  }
});

test('unreadable src/data/site.ts → a failure that says how to fix it', () => {
  const r = chooseSmokeUrl({ site: null });
  assert.equal(r.url, null);
  assert.match(r.problem, /src\/data\/site\.ts/);
});

test('the chosen address is never the vercel.com dashboard or the per-deployment URL', () => {
  for (const [site, alias] of [[LAUNCHED, null], [PRE_LAUNCH, pickStableAlias(CVW_DOMAINS)]]) {
    const { url } = chooseSmokeUrl({ site, alias });
    assert.notEqual(new URL(url).hostname, 'vercel.com');
    assert.notEqual(url, DEPLOYMENT_URL);
  }
});

test('pickStableAlias: only a verified, non-redirecting production *.vercel.app domain', () => {
  assert.equal(pickStableAlias(CVW_DOMAINS), 'https://client-central-valley-water-restora.vercel.app');
  assert.equal(pickStableAlias({ domains: [
    { name: 'old-name.vercel.app', redirect: 'www.client.com', verified: true },
    { name: 'branch-alias.vercel.app', gitBranch: 'staging', verified: true },
    { name: 'unverified.vercel.app', verified: false },
    { name: 'www.client.com', verified: true },
  ] }), null);
  assert.equal(pickStableAlias(null), null);
  assert.equal(pickStableAlias({}), null);
});

test('vercelProjectFromStatusUrl: team and project from the GitHub status link; anything else → null', () => {
  assert.deepEqual(vercelProjectFromStatusUrl(STATUS_URL), { team: 'restoration-growth-partners', project: 'client-central-valley-water-restoration-website' });
  assert.equal(vercelProjectFromStatusUrl(DEPLOYMENT_URL), null);
  assert.equal(vercelProjectFromStatusUrl('https://vercel.com/restoration-growth-partners'), null);
  assert.equal(vercelProjectFromStatusUrl(null), null);
});
