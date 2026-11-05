#!/usr/bin/env node
/**
 * publish-due-posts.mjs — the weekly blog publisher (CORE_CONTRACTS §29). Run once a week, Wednesday
 * 06:00 UTC (the same slot for every client), by .github/workflows/publish-scheduled-posts.yml in the
 * CLIENT repo; re-run by hand from the Actions tab (Run workflow, dry run unticked) after a failure.
 *
 *  1. Reads src/content/posts/*.json and picks the posts that are due: not a draft, publishDate ≤ now
 *     (the same isPublished() rule the build uses).
 *  2. Asks the LIVE site which of them are actually published: in the live /sitemap.xml and HTTP 200.
 *  3. Any due post not live → POST the Vercel deploy hook (secret VERCEL_DEPLOY_HOOK_URL) to rebuild
 *     production → poll until every one of them returns 200 AND is in the live sitemap (or time out).
 *  4. Announces them through the ONE announcing path, the workflow "Tell search engines"
 *     (.github/workflows/search-notify.yml, CORE_CONTRACTS §28): a deploy-hook build reports no deployment to
 *     GitHub, so this script starts that workflow itself (`gh workflow run`, the job's GITHUB_TOKEN) and waits for
 *     it. It sends IndexNow only the pages that changed (the new post, /blog/, posts whose related lists moved)
 *     and resubmits /sitemap.xml to Bing and Google. Its failure fails this run ("the posts ARE live").
 *     Posts that are already live but were published within --window-hours (default 72: the Wednesday
 *     run plus two business days of re-runs) are announced the same way — that is how a manual re-run
 *     after a failed announcement finishes the job (the manifest comparison never double-sends a page).
 *  5. Exits non-zero with a plain message when anything fails or a due post is still not live — that
 *     failed GitHub Actions run (and its email) is the alert until Slack/ClickUp alerts exist.
 *
 * Does nothing (exit 0) while site.previewMode is true: a site that is not launched has nothing to announce.
 *
 * Usage (from the repo root of a client site):
 *   node --experimental-strip-types scripts/publish-due-posts.mjs [--dry-run] [--now <iso>]
 *        [--site <origin>] [--posts <dir>] [--timeout <s>] [--interval <s>] [--window-hours <h>]
 *   --dry-run  everything except the deploy-hook call and the announcement run:
 *              reads posts, checks the live site, prints what it would do. Needs no secrets locally;
 *              on GitHub Actions (requireHook) a launched site with scheduled posts fails when
 *              VERCEL_DEPLOY_HOOK_URL is missing or not a Vercel hook URL, so the gap shows before a Wednesday.
 *
 * Secrets (GitHub Actions secrets only — never in the repo, never printed):
 *   VERCEL_DEPLOY_HOOK_URL                 repo secret created by `npm run vercel:setup` / `npm run vercel:hook` (hook
 *                                          "publish-scheduled-posts", branch main) — nobody sees or pastes the URL
 *   GH_TOKEN                               the workflow's own GITHUB_TOKEN (actions: write) to start "Tell search engines"
 * The search engine keys are not used here: "Tell search engines" reads them from the organization secrets.
 */
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { isPublished, loadPostFiles, postPath, formatPostDate, WEEKDAYS, PUBLISH_SLOT } from '../src/utils/blog-schedule.mjs';
import { isHookUrl } from './lib/vercel-hook.mjs';

export const WORKFLOW_FILE = '.github/workflows/publish-scheduled-posts.yml';
export const NOTIFY_WORKFLOW = 'search-notify.yml';

/** Every <loc> in a sitemap, following a sitemap index. */
export async function sitemapUrls(fetchFn, url, seen = new Set()) {
  if (seen.has(url)) return [];
  seen.add(url);
  const res = await fetchFn(url, { headers: { 'cache-control': 'no-cache' } });
  if (res.status !== 200) throw new Error(`${url} returned HTTP ${res.status}`);
  const xml = await res.text();
  const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]);
  if (/<sitemapindex/i.test(xml)) return (await Promise.all(locs.map((l) => sitemapUrls(fetchFn, l, seen)))).flat();
  return locs;
}

/** The workflow's schedule entries: [{ cron, timezone }] (no timezone line = UTC). */
export function workflowSchedules(text) {
  const lines = String(text).split('\n');
  const out = [];
  lines.forEach((line, i) => {
    const m = line.match(/^\s*-\s*cron:\s*["']([^"']+)["']/);
    if (!m) return;
    const tz = (lines[i + 1] ?? '').match(/^\s*timezone:\s*["']?([^"'\s]+)["']?\s*$/)?.[1];
    out.push({ cron: m[1].trim(), timezone: tz ?? 'UTC' });
  });
  return out;
}

/**
 * Why the workflow schedule is not the agency slot, or null. It must be ONE weekly run on Wednesday in UTC,
 * at or after 06:00 (so the post is due when it runs).
 */
export function scheduleProblem(text) {
  const entries = workflowSchedules(text);
  const [hh, mm] = PUBLISH_SLOT.time.split(':').map(Number);
  const want = `one weekly run, cron '${mm} ${hh} * * ${WEEKDAYS.indexOf(PUBLISH_SLOT.day)}' in UTC (${PUBLISH_SLOT.day} ${PUBLISH_SLOT.time} UTC, the same for every client — §29)`;
  if (entries.length !== 1) return `${WORKFLOW_FILE} has ${entries.length} schedule entries; it needs ${want}`;
  const [{ cron, timezone }] = entries;
  const [min, hour, dom, mon, dow] = cron.split(/\s+/);
  const ok = ['UTC', 'Etc/UTC'].includes(timezone) && dom === '*' && mon === '*' && /^\d+$/.test(min) && /^\d+$/.test(hour)
    && /^\d$/.test(dow) && Number(dow) === WEEKDAYS.indexOf(PUBLISH_SLOT.day) && Number(hour) * 60 + Number(min) >= hh * 60 + mm;
  return ok ? null : `${WORKFLOW_FILE} runs '${cron}' in ${timezone}; it needs ${want}`;
}

/**
 * Default announcer: start the workflow "Tell search engines" (search-notify.yml) and wait for its result — the ONE
 * path that tells IndexNow (changed pages only), Bing and Google (§28). Throws when it cannot start or it fails.
 */
export async function defaultSubmit(urls, log = console.log, { gh = (args) => spawnSync('gh', args, { encoding: 'utf8' }), sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const label = `blog publish ${new Date().toISOString().slice(0, 16)}Z ${randomBytes(3).toString('hex')}`;
  const ref = process.env.GITHUB_REF_NAME || 'main';
  const repo = process.env.GITHUB_REPOSITORY ? ['-R', process.env.GITHUB_REPOSITORY] : [];
  const byHand = 'start it by hand: Actions → "Tell search engines" → Run workflow';
  log(`→ Tell search engines (${NOTIFY_WORKFLOW}, "${label}"): ${urls.length} URL(s) went live — IndexNow gets every page that changed, Bing and Google the sitemap`);
  const started = gh(['workflow', 'run', NOTIFY_WORKFLOW, '--ref', ref, '-f', `reason=${label}`, ...repo]);
  if (started.status !== 0) throw new Error(`could not start "Tell search engines" (${String(started.stderr ?? '').trim().split('\n').pop() || `exit ${started.status}`}) — the posts ARE live; ${byHand}`);
  let run;
  for (let i = 0; i < 30 && !run; i++) {
    await sleep(5000);
    const list = gh(['run', 'list', '--workflow', NOTIFY_WORKFLOW, '--event', 'workflow_dispatch', '--limit', '20', '--json', 'databaseId,displayTitle,url', ...repo]);
    try { run = JSON.parse(list.stdout || '[]').find((x) => String(x.displayTitle).includes(label)); } catch { /* retry */ }
  }
  if (!run) throw new Error(`"Tell search engines" was started but its run did not appear — the posts ARE live; check the Actions tab, or ${byHand}`);
  log(`  · running: ${run.url}`);
  const watched = gh(['run', 'watch', String(run.databaseId), '--exit-status', '--interval', '10', ...repo]);
  if (watched.status !== 0) throw new Error(`"Tell search engines" failed — the posts ARE live; open ${run.url}, fix the step it names, then re-run that workflow`);
  log(`  ✓ IndexNow, Bing and Google told (${run.url})`);
}

/**
 * The publisher, with every side effect injected so it can be tested with mocked HTTP.
 * Returns { code, message, due, published, announced }.
 */
export async function run({
  site, posts, now = new Date(), dryRun = false, origin = site.siteUrl, hookUrl = '', requireHook = false,
  workflowText = null, fetchFn = fetch, submit = defaultSubmit, log = console.log,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)), timeoutMs = 15 * 60_000, intervalMs = 20_000, windowHours = 72,
}) {
  const done = (code, message, extra = {}) => ({ code, message, ...extra });
  if (site.previewMode) return done(0, 'site.previewMode is true — the site is not launched; nothing is published or announced. (This workflow starts working at launch.)');
  if (workflowText !== null) {
    const problem = scheduleProblem(workflowText);
    if (problem) return done(1, problem);
  }
  const base = String(origin).replace(/\/$/, '');
  if (!/^https?:\/\//.test(base)) return done(1, `site URL "${origin}" is not an absolute URL`);
  const at = (iso) => `${formatPostDate(iso)} (${iso})`;

  const due = posts.filter((p) => isPublished(p, now));
  // On GitHub (requireHook) every run — the dry run included — proves the secret is there while posts wait to publish.
  const scheduled = posts.filter((p) => !p.draft && !isPublished(p, now)).sort((a, b) => new Date(a.publishDate) - new Date(b.publishDate));
  const hookProblem = (n, what) => `VERCEL_DEPLOY_HOOK_URL is ${hookUrl ? 'not a Vercel deploy hook URL' : 'missing'} in this repo's Actions secrets and ${n} ${what} — the weekly run cannot publish without it. Fix: in the client repo run npm run vercel:hook (creates the hook and stores the secret; nobody sees the URL), then re-run this workflow`;
  if (requireHook && scheduled.length && !isHookUrl(hookUrl))
    return done(1, hookProblem(`${scheduled.length} post(s) are scheduled`, `(next: ${scheduled[0].slug}, ${at(scheduled[0].publishDate)})`));
  log(`publish-due-posts${dryRun ? ' (DRY RUN)' : ''} — ${base} · now ${now.toISOString()} · ${posts.length} post(s), ${due.length} due, ${posts.length - due.length} scheduled/draft`);
  if (!due.length) return done(0, 'no posts are due yet', { due: [] });

  let live;
  try { live = new Set(await sitemapUrls(fetchFn, `${base}/sitemap.xml`)); }
  catch (e) { return done(1, `could not read the live sitemap: ${e.message}`); }
  const url = (p) => `${base}${postPath(p.slug)}`;
  const status = async (u) => { try { return (await fetchFn(u, { headers: { 'cache-control': 'no-cache' } })).status; } catch { return 0; } };

  const missing = [];
  const announce = [];
  const recentSince = now.getTime() - windowHours * 3600_000;
  for (const p of due) {
    const inMap = live.has(url(p));
    const recent = new Date(p.publishDate).getTime() > recentSince;
    if (!inMap) { missing.push(p); continue; }
    if (recent) {
      const s = await status(url(p));
      if (s === 200) announce.push(p); else missing.push(p);
    }
  }
  for (const p of missing) log(`  · due, NOT live: ${postPath(p.slug)} — publishDate ${at(p.publishDate)}`);
  for (const p of announce) log(`  · due, already live since the last run: ${postPath(p.slug)}`);

  if (!missing.length && !announce.length) return done(0, `all ${due.length} due post(s) are live; nothing new to publish`, { due: due.map((p) => p.slug) });

  if (missing.length) {
    if (dryRun) {
      if (requireHook && !isHookUrl(hookUrl)) return done(1, hookProblem(`${missing.length} due post(s) are not live`, `(${missing.map((p) => p.slug).join(', ')})`));
      log(`  [dry run] would POST the Vercel deploy hook, wait up to ${Math.round(timeoutMs / 60000)} min for ${missing.map((p) => postPath(p.slug)).join(', ')} to return 200 and appear in the live sitemap, then start "Tell search engines" (IndexNow for the changed pages, the sitemap to Bing and Google).`);
      return done(0, `DRY RUN — ${missing.length} post(s) would be published: ${missing.map((p) => p.slug).join(', ')}`, { due: due.map((p) => p.slug), wouldPublish: missing.map((p) => p.slug) });
    }
    if (!/^https:\/\//.test(hookUrl)) return done(1, `${missing.length} due post(s) are not live (${missing.map((p) => p.slug).join(', ')}) and VERCEL_DEPLOY_HOOK_URL is not set — in the client repo run npm run vercel:hook (creates the hook and stores the GitHub Actions secret; nobody sees the URL)`);
    let hookRes;
    try { hookRes = await fetchFn(hookUrl, { method: 'POST' }); }
    catch (e) { return done(1, `the Vercel deploy hook request failed: ${e.message}`); }
    if (hookRes.status < 200 || hookRes.status >= 300) return done(1, `the Vercel deploy hook returned HTTP ${hookRes.status} — check the hook still exists in Vercel (Settings → Git → Deploy Hooks); npm run vercel:hook recreates a deleted hook and stores it`);
    log(`  ✓ deploy hook accepted (HTTP ${hookRes.status}); waiting for the deployment…`);

    const deadline = Date.now() + timeoutMs;
    let pending = [...missing];
    while (pending.length) {
      await sleep(intervalMs);
      let map;
      try { map = new Set(await sitemapUrls(fetchFn, `${base}/sitemap.xml`)); } catch { map = new Set(); }
      const still = [];
      for (const p of pending) if (!(map.has(url(p)) && (await status(url(p))) === 200)) still.push(p);
      pending = still;
      if (pending.length && Date.now() >= deadline)
        return done(1, `deployment did not publish ${pending.map((p) => postPath(p.slug)).join(', ')} within ${Math.round(timeoutMs / 60000)} min (not HTTP 200 and in the live sitemap) — open the Vercel deployment log for the latest production build`);
    }
    for (const p of missing) log(`  ✓ live: ${url(p)} (HTTP 200, in sitemap)`);
  }

  const urls = [...new Set([...missing, ...announce].map(url).concat(`${base}/blog/`))];
  if (dryRun) {
    log(`  [dry run] would start "Tell search engines" for ${urls.join(', ')} (IndexNow for the changed pages; ${base}/sitemap.xml to Bing and Google)`);
    return done(0, `DRY RUN — ${announce.length} live post(s) would be announced`, { announced: announce.map((p) => p.slug) });
  }
  try { await submit(urls, log); }
  catch (e) { return done(1, e.message, { published: missing.map((p) => p.slug) }); }
  return done(0, `published ${missing.length} and announced ${urls.length} URL(s)`, { published: missing.map((p) => p.slug), announced: urls });
}

// ------------------------------------------------------------------------------------------------ CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  const opt = (k, d) => { const i = argv.indexOf(k); return i > -1 ? argv[i + 1] : d; };
  const { site } = await import(new URL('../src/data/site.ts', import.meta.url).href);
  const now = opt('--now') ? new Date(opt('--now')) : new Date();
  if (Number.isNaN(now.getTime())) { console.error('✗ --now is not a date'); process.exit(1); }
  const result = await run({
    site,
    posts: loadPostFiles(opt('--posts', 'src/content/posts')),
    now,
    dryRun: argv.includes('--dry-run'),
    origin: opt('--site', site.siteUrl),
    hookUrl: process.env.VERCEL_DEPLOY_HOOK_URL ?? '',
    requireHook: process.env.GITHUB_ACTIONS === 'true',
    workflowText: existsSync(WORKFLOW_FILE) ? readFileSync(WORKFLOW_FILE, 'utf8') : null,
    timeoutMs: Number(opt('--timeout', 900)) * 1000,
    intervalMs: Number(opt('--interval', 20)) * 1000,
    windowHours: Number(opt('--window-hours', 72)),
  });
  if (result.code) { console.error(`✗ publish-due-posts — ${result.message}`); process.exit(result.code); }
  console.log(`✓ publish-due-posts — ${result.message}`);
}
