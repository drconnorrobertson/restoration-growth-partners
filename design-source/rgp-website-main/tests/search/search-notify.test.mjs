/**
 * "Tell search engines" after every production deploy (CORE_CONTRACTS §28): the page fingerprint and manifest diff
 * (scripts/lib/search-manifest.mjs), the trigger filter, "each step runs even if another fails", waiting for the
 * deployed commit, and the workflow file (scripts/search-notify.mjs, .github/workflows/search-notify.yml).
 * Nothing here touches the network, GitHub, Google, Bing or IndexNow. Run: npm run test:search
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pageFingerprint, diffManifests, parseManifest, buildManifest, stripCopyrightYear } from '../../scripts/lib/search-manifest.mjs';
import { triggerDecision, runSteps, waitForLive, notify, BING_MISSING } from '../../scripts/search-notify.mjs';

const STARTER = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const O = 'https://www.client.com';
const page = ({ title = 'Water Damage | Client', body = '<h1>Water damage</h1><p>We dry homes.</p>', year = 2026, extraHead = '', cls = 'a' } = {}) =>
  `<!doctype html><html><head><title>${title}</title><meta name="description" content="Fast drying"><link rel="canonical" href="${O}/water/">` +
  `<link rel="stylesheet" href="/_astro/index.${cls}1b2.css">${extraHead}<script type="application/ld+json">{"@type":"LocalBusiness","name":"Client"}</script></head>` +
  `<body class="${cls}"><header data-astro-cid-${cls}><a href="/">Home</a></header><main>${body}</main>` +
  `<script>window.x=${Date.now()}</script><footer><p>© ${year} Client LLC. All rights reserved.</p></footer></body></html>`;
const M = (pages, extra = {}) => ({ version: 1, site: O, commit: 'a'.repeat(40), builtAt: '2026-10-26T10:00:00Z', previewMode: false, indexNowKey: 'abcdef12', pages, ...extra });

// ---------------------------------------------------------------- fingerprint
test('fingerprint: CSS bundle names, classes, scripts and the copyright year do not count as a change', () => {
  const base = pageFingerprint(page());
  assert.equal(pageFingerprint(page({ cls: 'zz' })), base, 'class names, Astro cids and the CSS bundle hash are ignored');
  assert.equal(pageFingerprint(page({ year: 2027 })), base, 'a new calendar year is not a page change');
  assert.equal(pageFingerprint(page({ extraHead: '<script src="/_astro/x.123.js"></script><style>.a{}</style>' })), base, 'scripts and styles are ignored');
  assert.equal(stripCopyrightYear('© 2024–2026 Client'), '© YEAR Client');
});

test('fingerprint: text, title, meta, links, images and JSON-LD DO count', () => {
  const base = pageFingerprint(page());
  assert.notEqual(pageFingerprint(page({ title: 'Water Damage Repair | Client' })), base, 'title');
  assert.notEqual(pageFingerprint(page({ body: '<h1>Water damage</h1><p>We dry homes fast.</p>' })), base, 'visible text');
  assert.notEqual(pageFingerprint(page({ body: '<h1>Water damage</h1><p>We dry homes.</p><a href="/mold/">Mold</a>' })), base, 'a new link');
  assert.notEqual(pageFingerprint(page({ body: '<h1>Water damage</h1><p>We dry homes.</p><img src="/_astro/van.9f.webp" alt="Our van">' })), base, 'an image');
  assert.notEqual(pageFingerprint(page().replace('"name":"Client"', '"name":"Client LLC"')), base, 'structured data');
  assert.notEqual(pageFingerprint(page().replace('Fast drying', 'Fast drying, 24/7')), base, 'meta description');
});

// ---------------------------------------------------------------- manifest diff
test('diff: unchanged, changed, added and removed URLs; IndexNow gets changed + added + removed', () => {
  const prev = M({ [`${O}/`]: 'h1', [`${O}/a/`]: 'h2', [`${O}/gone/`]: 'h3', [`${O}/same/`]: 'h4' });
  const cur = M({ [`${O}/`]: 'h1', [`${O}/a/`]: 'h2-new', [`${O}/new/`]: 'h5', [`${O}/same/`]: 'h4' });
  const d = diffManifests(prev, cur);
  assert.equal(d.mode, 'diff');
  assert.deepEqual(d.unchanged, [`${O}/`, `${O}/same/`]);
  assert.deepEqual(d.changed, [`${O}/a/`]);
  assert.deepEqual(d.added, [`${O}/new/`]);
  assert.deepEqual(d.removed, [`${O}/gone/`]);
  assert.deepEqual(d.submit, [`${O}/a/`, `${O}/new/`, `${O}/gone/`]);
  assert.deepEqual(diffManifests(cur, cur).submit, [], 'nothing changed → nothing to send');
});

test('diff: no previous manifest, a failed download, or a malformed one → the FULL list, with the reason', () => {
  const cur = M({ [`${O}/`]: 'h1', [`${O}/a/`]: 'h2' });
  const all = [`${O}/`, `${O}/a/`];
  for (const [previous, why] of [
    [null, /no previous manifest/],
    [undefined, /no previous manifest/],
    [{ error: 'download of artifact 9 failed (HTTP 500)' }, /could not be loaded: download of artifact 9 failed/],
    ['{not json', /malformed: not JSON/],
    [{ version: 2, pages: {} }, /malformed: unsupported version 2/],
    [{ version: 1 }, /malformed: no "pages" object/],
    [{ version: 1, pages: {} }, /malformed: lists no pages/],
    [{ version: 1, pages: { '/relative/': 'x' } }, /malformed: page key "\/relative\/" is not an absolute URL/],
    [M({ 'https://other.com/': 'x' }, { site: 'https://other.com' }), /is for https:\/\/other\.com/],
  ]) {
    const d = diffManifests(previous, cur);
    assert.equal(d.mode, 'full', String(previous));
    assert.match(d.reason, why);
    assert.deepEqual(d.submit, all);
  }
  assert.throws(() => diffManifests(null, { version: 1, pages: {} }), /lists no pages/, 'a broken LIVE manifest is an error, never an empty send');
  assert.throws(() => parseManifest('[]'), /not a JSON object/);
});

test('buildManifest: every sitemap URL → its built page fingerprint; a URL with no built file is listed as null', () => {
  const dist = mkdtempSync(join(tmpdir(), 'manifest-'));
  mkdirSync(join(dist, 'water'), { recursive: true });
  writeFileSync(join(dist, 'index.html'), page({ body: '<h1>Home</h1>' }));
  writeFileSync(join(dist, 'water', 'index.html'), page());
  writeFileSync(join(dist, 'sitemap-0.xml'), `<urlset><url><loc>${O}/</loc></url><url><loc>${O}/water/</loc></url><url><loc>${O}/api/x/</loc></url></urlset>`);
  const { manifest, missing } = buildManifest({ dist, origin: `${O}/`, commit: 'c'.repeat(40), previewMode: false, indexNowKey: 'abcdef12' });
  assert.equal(manifest.site, O);
  assert.equal(manifest.pages[`${O}/water/`], pageFingerprint(page()));
  assert.equal(manifest.pages[`${O}/api/x/`], null);
  assert.deepEqual(missing, [`${O}/api/x/`]);
  assert.equal(manifest.commit, 'c'.repeat(40));
  assert.doesNotThrow(() => parseManifest(JSON.stringify(manifest)));
});

// ---------------------------------------------------------------- trigger filter
const LIVE = { previewMode: false, siteUrl: O, indexNow: { key: 'abcdef12' } };
const deployEvent = (state, environment, sha = 'b'.repeat(40)) => ({ deployment_status: { state, environment }, deployment: { environment, sha } });

test('trigger: only a successful Production deploy of a launched site (or a manual run) announces anything', () => {
  const ok = triggerDecision({ eventName: 'deployment_status', event: deployEvent('success', 'Production'), site: LIVE });
  assert.equal(ok.run, true);
  assert.equal(ok.expectCommit, 'b'.repeat(40));
  assert.equal(triggerDecision({ eventName: 'deployment_status', event: deployEvent('success', 'production'), site: LIVE }).run, true, 'case-insensitive');
  for (const [event, why] of [
    [deployEvent('success', 'Preview'), /Preview deployment/],
    [deployEvent('failure', 'Production'), /"failure", not success/],
    [deployEvent('pending', 'Production'), /"pending"/],
    [deployEvent('error', 'Production'), /"error"/],
    [deployEvent('success', 'Production', 'main'), /no commit SHA/],
  ]) {
    const d = triggerDecision({ eventName: 'deployment_status', event, site: LIVE });
    assert.equal(d.run, false);
    assert.match(d.reason, why);
  }
  const pre = triggerDecision({ eventName: 'deployment_status', event: deployEvent('success', 'Production'), site: { ...LIVE, previewMode: true } });
  assert.equal(pre.run, false);
  assert.match(pre.reason, /not launched/);
  assert.equal(triggerDecision({ eventName: 'deployment_status', event: deployEvent('success', 'Production'), site: { siteUrl: O } }).run, false, 'previewMode must be explicitly false');
  assert.equal(triggerDecision({ eventName: 'deployment_status', event: deployEvent('success', 'Production'), site: { ...LIVE, siteUrl: 'https://example.com' } }).run, false);
  assert.equal(triggerDecision({ eventName: 'push', event: {}, site: LIVE }).run, false);
  const manual = triggerDecision({ eventName: 'workflow_dispatch', event: { inputs: { reason: 'blog publish', expect_commit: '' } }, site: LIVE });
  assert.equal(manual.run, true);
  assert.equal(manual.expectCommit, null);
  assert.equal(triggerDecision({ eventName: 'workflow_dispatch', event: { inputs: { expect_commit: 'abc1234' } }, site: LIVE }).expectCommit, 'abc1234');
  assert.equal(triggerDecision({ eventName: 'workflow_dispatch', event: { inputs: { expect_commit: 'main; rm -rf' } }, site: LIVE }).run, false);
  assert.equal(triggerDecision({ eventName: 'workflow_dispatch', event: {}, site: { ...LIVE, previewMode: true } }).run, false);
});

// ---------------------------------------------------------------- each step runs
test('runSteps: every step runs even when an earlier one fails; failures are reported, not thrown', async () => {
  const ran = [];
  const results = await runSteps([
    { name: 'IndexNow', run: async () => { ran.push('i'); throw new Error('HTTP 403 — key not valid'); } },
    { name: 'Bing', run: async () => { ran.push('b'); throw new Error(BING_MISSING); } },
    { name: 'Google', run: async () => { ran.push('g'); return 'submitted'; } },
  ], () => {});
  assert.deepEqual(ran, ['i', 'b', 'g']);
  assert.deepEqual(results.map((r) => r.ok), [false, false, true]);
  assert.match(results[1].message, /^BING_WEBMASTER_API_KEY not visible to this repo — owner: set its repository access to All repositories/);
});

// ---------------------------------------------------------------- the whole job, mocked
/** A mock site: serves the given manifest(s) in turn, the key file, and records IndexNow POSTs. */
function mockFetch({ manifests, key = 'abcdef12', indexNowStatus = 200 }) {
  const calls = { manifest: 0, posts: [] };
  const fn = async (url, init = {}) => {
    if (init.method === 'POST') { calls.posts.push(JSON.parse(init.body)); return new Response('', { status: indexNowStatus }); }
    if (url.startsWith(`${O}/search-manifest.json`)) {
      const m = manifests[Math.min(calls.manifest++, manifests.length - 1)];
      return m === 404 ? new Response('', { status: 404 }) : new Response(JSON.stringify(m), { status: 200 });
    }
    if (url === `${O}/${key}.txt`) return new Response(key, { status: 200 });
    return new Response('', { status: 404 });
  };
  return { fn, calls };
}
const SECRETS = { BING_WEBMASTER_API_KEY: 'bing-key-123456', GOOGLE_OAUTH_CLIENT_ID: 'id', GOOGLE_OAUTH_CLIENT_SECRET: 'secret', GOOGLE_TOKEN_JSON: '{"refresh_token":"r"}' };
const SHA = 'b'.repeat(40);
const job = (over = {}) => {
  const lines = [];
  const called = { bing: 0, google: 0 };
  return notify({
    site: LIVE, eventName: 'deployment_status', event: deployEvent('success', 'Production', SHA), env: SECRETS,
    runBing: async () => { called.bing++; return 'bing submit — sitemap submitted'; },
    runGoogle: async () => { called.google++; return 'gsc submit — Google downloaded the sitemap'; },
    log: (l) => lines.push(l), sleep: async () => {}, intervalMs: 1, timeoutMs: 50, ...over,
  }).then((r) => ({ ...r, lines, called }));
};
const PREV = M({ [`${O}/`]: 'h1', [`${O}/a/`]: 'h2' }, { commit: 'a'.repeat(40) });
const NEW = M({ [`${O}/`]: 'h1', [`${O}/a/`]: 'h2-new', [`${O}/blog/post/`]: 'h3' }, { commit: SHA });

test('job: waits for the deployed commit, then IndexNow gets ONLY the changed pages, and Bing + Google are told', async () => {
  const { fn, calls } = mockFetch({ manifests: [PREV, PREV, NEW] }); // production still serves the old build twice
  const r = await job({ fetchFn: fn, loadPrevious: async () => PREV });
  assert.equal(r.code, 0, r.lines.join('\n'));
  assert.ok(calls.manifest >= 3, 'polled until the new build was live');
  assert.equal(calls.posts.length, 1);
  assert.deepEqual(calls.posts[0].urlList, [`${O}/a/`, `${O}/blog/post/`]);
  assert.equal(calls.posts[0].keyLocation, `${O}/abcdef12.txt`);
  assert.deepEqual(r.called, { bing: 1, google: 1 }, 'Bing and Google every time');
  assert.equal(r.storeManifest, true, 'the live manifest becomes the new baseline');
});

test('job: no previous manifest (or a broken one) → the FULL list once, said plainly in the log', async () => {
  for (const loadPrevious of [async () => null, async () => ({ error: 'download failed' }), async () => { throw new Error('gh missing'); }]) {
    const { fn, calls } = mockFetch({ manifests: [NEW] });
    const r = await job({ fetchFn: fn, loadPrevious });
    assert.equal(r.code, 0);
    assert.deepEqual(calls.posts[0].urlList, Object.keys(NEW.pages));
    assert.ok(r.lines.some((l) => /FULL LIST — .*Sending every sitemap URL \(3\) to IndexNow once/.test(l)), r.lines.join('\n'));
  }
});

test('job: nothing changed → IndexNow is not called (success), Bing + Google are still told', async () => {
  const { fn, calls } = mockFetch({ manifests: [NEW] });
  const r = await job({ fetchFn: fn, loadPrevious: async () => NEW });
  assert.equal(r.code, 0);
  assert.equal(calls.posts.length, 0);
  assert.deepEqual(r.called, { bing: 1, google: 1 });
  assert.match(r.results[0].message, /no page changed .* IndexNow not called/);
});

test('job: each step runs even if another fails; the run fails (exit 1) and names every failure', async () => {
  const { fn } = mockFetch({ manifests: [NEW], indexNowStatus: 403 });
  const r = await job({ fetchFn: fn, loadPrevious: async () => PREV, runGoogle: async () => { throw new Error('gsc submit — Google token refresh failed: invalid_grant'); } });
  assert.equal(r.code, 1);
  assert.deepEqual(r.results.map((x) => [x.name, x.ok]), [['IndexNow (changed pages)', false], ['Bing sitemap', true], ['Google sitemap', false]]);
  assert.match(r.results[0].message, /HTTP 403 — key not valid/);
  assert.equal(r.storeManifest, false, 'IndexNow failed → keep the old baseline so the next run resends');
  assert.ok(r.lines.some((l) => /2 of 3 step\(s\) failed: IndexNow \(changed pages\), Google sitemap/.test(l)));
});

test('job: Bing key not visible to the repo → that exact message; IndexNow and Google still run', async () => {
  const { fn, calls } = mockFetch({ manifests: [NEW] });
  const r = await job({ fetchFn: fn, loadPrevious: async () => PREV, env: { ...SECRETS, BING_WEBMASTER_API_KEY: '' } });
  assert.equal(r.code, 1);
  assert.equal(r.results[1].message, BING_MISSING);
  assert.equal(r.called.bing, 0);
  assert.equal(r.called.google, 1);
  assert.equal(calls.posts.length, 1);
  const g = await job({ fetchFn: mockFetch({ manifests: [NEW] }).fn, loadPrevious: async () => PREV, env: { BING_WEBMASTER_API_KEY: 'k' } });
  assert.match(g.results[2].message, /GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_TOKEN_JSON not visible to this repo/);
});

test('job: production never serves the deployed commit → nothing is submitted, the run fails clearly', async () => {
  const { fn, calls } = mockFetch({ manifests: [PREV] });
  const r = await job({ fetchFn: fn, loadPrevious: async () => PREV });
  assert.equal(r.code, 1);
  assert.match(r.results[0].message, /did not serve commit bbbbbbb .* nothing was submitted/);
  assert.equal(calls.posts.length, 0);
  assert.deepEqual(r.called, { bing: 0, google: 0 });
});

test('job: a later production build that contains the deployed commit counts as live', async () => {
  const later = { ...NEW, commit: 'c'.repeat(40) };
  const { fn } = mockFetch({ manifests: [later] });
  const r = await job({ fetchFn: fn, loadPrevious: async () => PREV, contains: async (a, b) => a === SHA && b === 'c'.repeat(40) });
  assert.equal(r.code, 0);
});

test('job: a build without a recorded commit fails at once with the Vercel setting to fix', async () => {
  await assert.rejects(waitForLive({ origin: O, expectCommit: SHA, fetchFn: mockFetch({ manifests: [{ ...NEW, commit: null }] }).fn, sleep: async () => {}, timeoutMs: 1000 }), /Automatically expose System Environment Variables/);
});

test('job: Preview deploys and an unlaunched site do nothing at all', async () => {
  const { fn, calls } = mockFetch({ manifests: [NEW] });
  const preview = await job({ fetchFn: fn, event: deployEvent('success', 'Preview') });
  assert.equal(preview.code, 0);
  assert.match(preview.skipped, /Preview/);
  const pre = await job({ fetchFn: fn, site: { ...LIVE, previewMode: true } });
  assert.equal(pre.code, 0);
  assert.equal(calls.manifest + calls.posts.length, 0, 'no request at all');
  assert.deepEqual([preview.called, pre.called], [{ bing: 0, google: 0 }, { bing: 0, google: 0 }]);
});

test('job: a manual run (blog publisher) announces what is live now without waiting for a commit', async () => {
  const { fn, calls } = mockFetch({ manifests: [NEW] });
  const r = await job({ fetchFn: fn, eventName: 'workflow_dispatch', event: { inputs: { reason: 'blog publish' } }, loadPrevious: async () => PREV });
  assert.equal(r.code, 0);
  assert.equal(calls.manifest, 1);
  const full = await job({ fetchFn: mockFetch({ manifests: [NEW] }).fn, eventName: 'workflow_dispatch', event: { inputs: {} }, env: { ...SECRETS, INPUT_FULL: 'true' }, loadPrevious: async () => NEW });
  assert.match(full.results[0].message, /sent 3 URL\(s\) \(full list\)/);
});

// ---------------------------------------------------------------- the workflow file
test('workflow: deployment_status + workflow_dispatch, Production-only filter, org secrets, manifest kept as an artifact', () => {
  const wf = readFileSync(join(STARTER, '.github', 'workflows', 'search-notify.yml'), 'utf8');
  assert.match(wf, /^on:\n {2}deployment_status:\n {2}workflow_dispatch:/m);
  assert.match(wf, /if: github\.event_name == 'workflow_dispatch' \|\| \(github\.event\.deployment_status\.state == 'success' && github\.event\.deployment\.environment == 'Production'\)/);
  for (const s of ['GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET', 'GOOGLE_TOKEN_JSON', 'BING_WEBMASTER_API_KEY']) assert.match(wf, new RegExp(`${s}: \\$\\{\\{ secrets\\.${s} \\}\\}`));
  assert.match(wf, /name: search-manifest\n/);
  assert.match(wf, /if: always\(\) && steps\.notify\.outputs\.store_manifest == 'true'/);
  assert.match(wf, /actions: read/);
  for (const line of wf.split('\n').filter((l) => /^\s*run:/.test(l))) assert.doesNotMatch(line, /\$\{\{/, `no expressions in run: ${line}`);
  const publish = readFileSync(join(STARTER, '.github', 'workflows', 'publish-scheduled-posts.yml'), 'utf8');
  assert.match(publish, /actions: write/, 'the blog publisher can start "Tell search engines"');
  assert.match(publish, /GH_TOKEN: \$\{\{ github\.token \}\}/);
});
