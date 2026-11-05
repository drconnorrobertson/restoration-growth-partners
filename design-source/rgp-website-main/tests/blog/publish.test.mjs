/**
 * scripts/publish-due-posts.mjs against a MOCKED live site and deploy hook (a local HTTP server — no
 * network, no Vercel, no IndexNow, no Google). Submissions are injected, so nothing is ever sent. The default
 * announcer (start "Tell search engines" and wait for it, §28) is tested with a stubbed `gh`.
 * Run: npm run test:blog
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { run, defaultSubmit, NOTIFY_WORKFLOW } from '../../scripts/publish-due-posts.mjs';

const SITE = { previewMode: false, siteUrl: 'https://client.example', blog: { scheduleFrom: '' } };
const WORKFLOW = `on:\n  schedule:\n    - cron: '0 6 * * 3'\n  workflow_dispatch:\n`;
const NOW = new Date('2026-10-14T06:04:00Z'); // Wednesday 06:04 UTC — the weekly run, started a few minutes late

const posts = [
  { slug: 'old-post', publishDate: '2026-09-02T06:00:00Z' },                 // live for weeks
  { slug: 'due-today', publishDate: '2026-10-14T06:00:00Z' },                       // due 4 min ago, not live
  { slug: 'next-week', publishDate: '2026-10-21T06:00:00Z' },                // next Wednesday
  { slug: 'a-draft', publishDate: '2026-10-01T06:00:00Z', draft: true },     // draft
];

/** Mock live site: serves the sitemap + post pages for the slugs in `live`; the hook "deploys" `onDeploy`. */
let server; let origin; let state;
before(async () => {
  server = createServer((req, res) => {
    state.requests.push(`${req.method} ${req.url}`);
    if (req.url === '/hook' && req.method === 'POST') {
      state.hookCalls++;
      if (state.deployAfterPolls >= 0) state.deployAt = state.polls + state.deployAfterPolls;
      res.writeHead(201, { 'content-type': 'application/json' }); return res.end('{"job":{"state":"PENDING"}}');
    }
    if (req.url === '/sitemap.xml') {
      state.polls++;
      if (state.deployAt !== undefined && state.polls > state.deployAt) state.live = new Set([...state.live, ...state.onDeploy]);
      res.writeHead(200, { 'content-type': 'application/xml' });
      return res.end(`<?xml version="1.0"?><sitemapindex><sitemap><loc>${origin}/sitemap-0.xml</loc></sitemap></sitemapindex>`);
    }
    if (req.url === '/sitemap-0.xml') {
      res.writeHead(200, { 'content-type': 'application/xml' });
      return res.end(`<urlset>${[...state.live].map((s) => `<url><loc>${origin}/blog/${s}/</loc></url>`).join('')}</urlset>`);
    }
    const slug = req.url.match(/^\/blog\/([^/]+)\/$/)?.[1];
    res.writeHead(slug && state.live.has(slug) ? 200 : 404); res.end('');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  origin = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const reset = (over = {}) => { state = { requests: [], hookCalls: 0, polls: 0, live: new Set(['old-post']), onDeploy: ['due-today'], deployAfterPolls: 1, ...over }; };
const go = (over = {}) => {
  const submitted = [];
  const lines = [];
  return run({
    site: SITE, posts, now: NOW, origin, hookUrl: `${origin}/hook`.replace('http:', 'https:'), workflowText: WORKFLOW,
    fetchFn: (u, o) => fetch(u.replace(/^https:\/\/127/, 'http://127'), o), // the mock server speaks http
    submit: async (urls) => { submitted.push(...urls); },
    log: (l) => lines.push(l), sleep: async () => {}, intervalMs: 1, timeoutMs: 200, ...over,
  }).then((r) => ({ ...r, submitted, lines }));
};

test('dry run: finds the due post that is not live, calls NO hook and submits nothing', async () => {
  reset();
  const r = await go({ dryRun: true, submit: async () => { throw new Error('must not submit in dry run'); } });
  assert.equal(r.code, 0);
  assert.deepEqual(r.wouldPublish, ['due-today']);
  assert.equal(state.hookCalls, 0);
  assert.ok(!state.requests.some((x) => x.startsWith('POST')), 'no POST at all');
  assert.ok(r.lines.some((l) => l.includes('due, NOT live: /blog/due-today/')));
  assert.ok(!r.lines.join('\n').includes('next-week') && !r.lines.join('\n').includes('a-draft'), 'future/draft never considered');
  assert.ok(!r.lines.join('\n').includes('/hook'), 'the hook URL is never printed');
});

test('publish: hook → waits until the post is 200 and in the sitemap → submits the new URLs', async () => {
  reset({ deployAfterPolls: 2 });
  const r = await go();
  assert.equal(r.code, 0, r.message);
  assert.equal(state.hookCalls, 1);
  assert.deepEqual(r.published, ['due-today']);
  assert.deepEqual(r.submitted, [`${origin}/blog/due-today/`, `${origin}/blog/`]);
  assert.ok(state.polls >= 3, 'polled until the deployment was live');
});

test('nothing to do when every due post is already live', async () => {
  reset({ live: new Set(['old-post', 'due-today']) });
  const r = await go({ windowHours: 0 });
  assert.equal(r.code, 0);
  assert.match(r.message, /all 2 due post\(s\) are live/);
  assert.equal(state.hookCalls, 0);
});

test('a manual re-run after a failed submission (post already live, < 72 h old) announces it again, without a hook call', async () => {
  reset({ live: new Set(['old-post', 'due-today']) });
  const r = await go({ now: new Date('2026-10-16T15:00:00Z') }); // Friday re-run
  assert.equal(r.code, 0);
  assert.equal(state.hookCalls, 0);
  assert.deepEqual(r.submitted, [`${origin}/blog/due-today/`, `${origin}/blog/`]);
  reset({ live: new Set(['old-post', 'due-today']) });
  const nextWeek = await go({ now: new Date('2026-10-20T15:00:00Z') }); // > 72 h later: not re-announced
  assert.equal(nextWeek.submitted.length, 0);
});

test('fails (non-zero) when the deployment never publishes the post', async () => {
  reset({ deployAfterPolls: -1 });
  const r = await go();
  assert.equal(r.code, 1);
  assert.match(r.message, /did not publish \/blog\/due-today\//);
  assert.equal(r.submitted.length, 0, 'nothing submitted for a post that is not live');
});

test('fails when the hook secret is missing, or the hook is rejected', async () => {
  reset();
  assert.match((await go({ hookUrl: '' })).message, /VERCEL_DEPLOY_HOOK_URL is not set/);
  reset();
  const r = await go({ fetchFn: (u, o) => (o?.method === 'POST' ? Promise.resolve(new Response('', { status: 404 })) : fetch(u, o)) });
  assert.equal(r.code, 1);
  assert.match(r.message, /deploy hook returned HTTP 404/);
});

test('fails when a submission step fails — and says the post is live', async () => {
  reset();
  const r = await go({ submit: async () => { throw new Error('Search Console sitemap step failed (exit 1) — the posts ARE live'); } });
  assert.equal(r.code, 1);
  assert.deepEqual(r.published, ['due-today']);
  assert.match(r.message, /posts ARE live/);
});

test('fails when the workflow is not the agency slot (timezone or weekday); does nothing before launch', async () => {
  reset();
  assert.match((await go({ workflowText: WORKFLOW.replace("'0 6 * * 3'", "'0 6 * * 3'\n      timezone: 'America/New_York'") })).message, /runs '0 6 \* \* 3' in America\/New_York; it needs one weekly run, cron '0 6 \* \* 3' in UTC/);
  assert.match((await go({ workflowText: WORKFLOW.replace('* * 3', '* * *') })).message, /runs '0 6 \* \* \*'/);
  const pre = await go({ site: { ...SITE, previewMode: true } });
  assert.equal(pre.code, 0);
  assert.match(pre.message, /not launched/);
  assert.equal(state.requests.length, 0, 'no requests before launch');
});

test('CLI: the starter (previewMode true) exits 0 without network', () => {
  const r = spawnSync('node', ['--experimental-strip-types', 'scripts/publish-due-posts.mjs', '--dry-run'], { cwd: fileURLToPath(new URL('../../', import.meta.url)), encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /site\.previewMode is true/);
});

/** A stubbed `gh`: records calls; `watchStatus` is the announcement run's result. */
const fakeGh = ({ startStatus = 0, watchStatus = 0, appears = true } = {}) => {
  const calls = [];
  let label = '';
  const gh = (args) => {
    calls.push(args.join(' '));
    if (args[0] === 'workflow') { label = args.find((a) => a.startsWith('reason=')).slice(7); return { status: startStatus, stderr: startStatus ? 'HTTP 403: Resource not accessible by integration' : '' }; }
    if (args[0] === 'run' && args[1] === 'list') return { status: 0, stdout: JSON.stringify(appears ? [{ databaseId: 42, displayTitle: `Tell search engines: ${label}`, url: 'https://github.com/o/r/actions/runs/42' }] : []) };
    if (args[0] === 'run' && args[1] === 'watch') return { status: watchStatus };
    return { status: 1 };
  };
  return { gh, calls };
};

test('announcing = starting "Tell search engines" (the ONE path) and waiting for its result', async () => {
  const { gh, calls } = fakeGh();
  const lines = [];
  await defaultSubmit(['https://x.com/blog/a/', 'https://x.com/blog/'], (l) => lines.push(l), { gh, sleep: async () => {} });
  assert.match(calls[0], new RegExp(`^workflow run ${NOTIFY_WORKFLOW.replace('.', '\\.')} --ref \\S+ -f reason=blog publish `));
  assert.ok(calls.some((c) => c.startsWith('run watch 42 --exit-status')));
  assert.ok(!calls.some((c) => /indexnow|gsc/.test(c)), 'no direct IndexNow / Search Console call any more — no double submissions');
  assert.ok(lines.some((l) => l.includes('IndexNow, Bing and Google told')));
});

test('announcement failures fail the publish run and say the posts ARE live', async () => {
  await assert.rejects(defaultSubmit(['u'], () => {}, { gh: fakeGh({ watchStatus: 1 }).gh, sleep: async () => {} }), /"Tell search engines" failed — the posts ARE live; open https:\/\/github\.com\/o\/r\/actions\/runs\/42/);
  await assert.rejects(defaultSubmit(['u'], () => {}, { gh: fakeGh({ startStatus: 1 }).gh, sleep: async () => {} }), /could not start "Tell search engines" \(HTTP 403: Resource not accessible by integration\) — the posts ARE live/);
  await assert.rejects(defaultSubmit(['u'], () => {}, { gh: fakeGh({ appears: false }).gh, sleep: async () => {} }), /run did not appear — the posts ARE live/);
});

test('on GitHub (requireHook): a missing or malformed hook secret fails the run — dry run included — while posts are scheduled', async () => {
  const HOOK = 'https://api.vercel.com/v1/integrations/deploy/prj_x/abc123';
  reset();
  const dry = await go({ dryRun: true, requireHook: true, hookUrl: '' });
  assert.equal(dry.code, 1);
  assert.match(dry.message, /VERCEL_DEPLOY_HOOK_URL is missing .* 1 post\(s\) are scheduled \(next: next-week, .*npm run vercel:hook/);
  assert.equal(state.requests.length, 0, 'fails before touching the live site');
  reset();
  assert.match((await go({ dryRun: true, requireHook: true, hookUrl: 'null' })).message, /is not a Vercel deploy hook URL/);
  reset();
  const ok = await go({ dryRun: true, requireHook: true, hookUrl: HOOK });
  assert.equal(ok.code, 0, ok.message);
  assert.ok(!ok.lines.join('\n').includes(HOOK), 'the hook URL is never printed');
  // nothing scheduled, but a due post is not live: the dry run still needs the hook
  reset();
  const dueOnly = await go({ dryRun: true, requireHook: true, hookUrl: '', posts: posts.filter((p) => p.slug !== 'next-week') });
  assert.equal(dueOnly.code, 1);
  assert.match(dueOnly.message, /1 due post\(s\) are not live \(due-today\)/);
  // locally (no requireHook) a dry run needs no secrets
  reset();
  assert.equal((await go({ dryRun: true, hookUrl: '' })).code, 0);
  // before launch nothing is required
  reset();
  assert.equal((await go({ site: { ...SITE, previewMode: true }, requireHook: true, hookUrl: '' })).code, 0);
});
