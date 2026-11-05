#!/usr/bin/env node
/**
 * search-notify.mjs — "Tell search engines" after every production deploy of a LAUNCHED site (CORE_CONTRACTS §28
 * "After every production deploy"; owner decision 2026-10-26). The body of .github/workflows/search-notify.yml in
 * the CLIENT repo. Runs on GitHub; nobody holds a key.
 *
 *   0. Trigger filter (triggerDecision): a `deployment_status` event that is `success` for the `Production`
 *      environment, or a manual / blog-publisher `workflow_dispatch`. Preview deploys, failed deploys and a site
 *      with site.previewMode true do nothing (exit 0).
 *   1. Wait until the production domain serves the deployed build: poll {siteUrl}/search-manifest.json until its
 *      `commit` is the deployed commit (or a later commit that contains it). Nothing is submitted before that.
 *   2. Three steps, EACH runs even when another fails:
 *      a. IndexNow — only changed pages: the live manifest vs the one stored by the last run whose IndexNow step
 *         succeeded (GitHub Actions artifact `search-manifest`, 90 days). Changed + added + removed URLs are sent.
 *         When the comparison cannot run (none stored, download failed, malformed, other origin) the FULL list is
 *         sent once and the log says why. No change → IndexNow is not called (that is a success).
 *      b. Bing — resubmit /sitemap.xml (scripts/bing-webmaster.mjs submit), EVERY time. Org secret BING_WEBMASTER_API_KEY.
 *      c. Google — resubmit /sitemap.xml (scripts/search-console.mjs submit), EVERY time. Org secrets
 *         GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_TOKEN_JSON.
 *   3. Exit 1 (red run) when any step failed, with one plain line per failure; the live manifest is handed back for
 *      upload only when IndexNow succeeded, so a failed send is retried by the next run.
 *
 * Inputs (env): EVENT_NAME, GITHUB_EVENT_PATH (the event JSON), INPUT_FULL ('true' = send every URL to IndexNow),
 * INPUT_EXPECT_COMMIT (workflow_dispatch: wait for this commit), RESULT_DIR (manifest for upload), GITHUB_REPOSITORY +
 * GH_TOKEN (artifact download, commit compare), the secrets above. Locally: `--dry-run` prints the plan, sends nothing.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { MANIFEST_FILE, diffManifests, parseManifest } from './lib/search-manifest.mjs';
import { checkKeyFile, submitIndexNow } from './lib/indexnow.mjs';

export const WORKFLOW_FILE = '.github/workflows/search-notify.yml';
export const ARTIFACT = 'search-manifest';
export const GOOGLE_SECRETS = ['GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET', 'GOOGLE_TOKEN_JSON'];
export const BING_MISSING = 'BING_WEBMASTER_API_KEY not visible to this repo — owner: set its repository access to All repositories (GitHub → organization Settings → Secrets and variables → Actions → BING_WEBMASTER_API_KEY)';
export const GOOGLE_MISSING = (names) => `${names.join(', ')} not visible to this repo — owner: these are organization secrets written by \`npm run search:connect\`; their repository access must include this repo`;

/**
 * Should this run announce anything? Pure (unit-tested). Returns { run, reason, expectCommit }.
 * `event` is the GitHub event payload; `site` is src/data/site.ts at the deployed commit.
 */
export function triggerDecision({ eventName, event = {}, site = {} }) {
  const no = (reason) => ({ run: false, reason, expectCommit: null });
  if (site.previewMode !== false) return no('site.previewMode is not false — the site is not launched; nothing is announced (this job starts working at launch)');
  const origin = String(site.siteUrl ?? '');
  if (!/^https?:\/\/[^/]+\/?$/.test(origin) || /(^|\.)example\.com$/.test(new URL(origin).hostname)) return no(`site.siteUrl is "${site.siteUrl}" — not a production origin`);
  if (eventName === 'workflow_dispatch') {
    const c = String(event.inputs?.expect_commit ?? '').trim();
    if (c && !/^[0-9a-f]{7,40}$/i.test(c)) return no(`expect_commit "${c}" is not a commit SHA`);
    return { run: true, reason: `manual run${event.inputs?.reason ? ` (${event.inputs.reason})` : ''}`, expectCommit: c || null };
  }
  if (eventName !== 'deployment_status') return no(`event "${eventName}" is not a deploy`);
  const state = event.deployment_status?.state;
  const env = String(event.deployment_status?.environment ?? event.deployment?.environment ?? '');
  if (state !== 'success') return no(`deployment status is "${state}", not success`);
  if (env.toLowerCase() !== 'production') return no(`a ${env || 'non-production'} deployment — only Production deploys are announced`);
  const sha = event.deployment?.sha;
  if (!/^[0-9a-f]{40}$/i.test(sha ?? '')) return no('the deployment event carries no commit SHA');
  return { run: true, reason: `Production deploy of ${sha.slice(0, 7)}`, expectCommit: sha };
}

/** Run every step, whatever the others do. Each step: { name, run: async () => message }. Returns results. */
export async function runSteps(steps, log = console.log) {
  const results = [];
  for (const step of steps) {
    log(`\n→ ${step.name}`);
    try {
      const message = await step.run();
      results.push({ name: step.name, ok: true, message: message ?? 'done' });
      log(`✓ ${step.name} — ${message ?? 'done'}`);
    } catch (e) {
      results.push({ name: step.name, ok: false, message: e.message });
      log(`✗ ${step.name} — ${e.message}`);
    }
  }
  return results;
}

/**
 * Wait until the production domain serves the build of `expectCommit` (or a later one that contains it).
 * Returns the live manifest. Throws a plain message on timeout. With no expectCommit, returns what is live now.
 */
export async function waitForLive({ origin, expectCommit, fetchFn = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  timeoutMs = 15 * 60_000, intervalMs = 15_000, contains = async () => false, log = console.log }) {
  const url = `${String(origin).replace(/\/$/, '')}/${MANIFEST_FILE}`;
  const deadline = Date.now() + timeoutMs;
  let last = 'not fetched yet';
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetchFn(`${url}?t=${Date.now()}`, { headers: { 'cache-control': 'no-cache' } });
      if (res.status !== 200) last = `HTTP ${res.status}`;
      else {
        const m = parseManifest(await res.text());
        if (!expectCommit) return m;
        if (!m.commit) throw Object.assign(new Error(`${url} records no commit — the build ran without VERCEL_GIT_COMMIT_SHA. Vercel → Project → Settings → Environment Variables → tick "Automatically expose System Environment Variables", then redeploy`), { fatal: true });
        if (m.commit === expectCommit) return m;
        if (await contains(expectCommit, m.commit)) { log(`  · production already serves ${m.commit.slice(0, 7)}, a later commit that includes ${expectCommit.slice(0, 7)}`); return m; }
        last = `serving commit ${m.commit.slice(0, 7)}`;
      }
    } catch (e) {
      if (e.fatal) throw e;
      last = e.message;
    }
    if (!expectCommit) throw new Error(`${url} is not readable (${last}) — the live build has no search manifest: the build must run postbuild.mjs (it writes ${MANIFEST_FILE}); nothing was submitted`);
    if (Date.now() >= deadline) {
      throw new Error(`production (${origin}) did not serve commit ${expectCommit?.slice(0, 7)} within ${Math.round(timeoutMs / 60000)} min (last: ${last}) — check Vercel → Deployments that this deploy was promoted to the production domain; nothing was submitted`);
    }
    if (attempt === 0) log(`  · waiting for ${url} to show commit ${expectCommit.slice(0, 7)} (now: ${last})`);
    await sleep(intervalMs);
  }
}

/** The IndexNow step: only changed pages; the full list when the comparison cannot run. Pure apart from injected I/O. */
export async function indexNowStep({ origin, key, live, previous, full = false, fetchFn = fetch, log = console.log, dryRun = false }) {
  if (!key) throw new Error('site.indexNow.key is not set — IndexNow cannot be told (§28 launch step 2c: set the key, rebuild, deploy)');
  const plan = full
    ? { ...diffManifests(null, live), reason: 'a full send was asked for (workflow input "full")' }
    : diffManifests(previous, live);
  if (plan.mode === 'full') log(`  ⚠ FULL LIST — ${plan.reason}. Sending every sitemap URL (${plan.submit.length}) to IndexNow once.`);
  else log(`  · compared with the last announced deploy: ${plan.changed.length} changed, ${plan.added.length} added, ${plan.removed.length} removed, ${plan.unchanged.length} unchanged`);
  for (const [label, list] of [['changed', plan.changed], ['added', plan.added], ['removed', plan.removed]]) {
    if (plan.mode === 'diff') for (const u of list.slice(0, 20)) log(`    ${label}: ${u}`);
    if (plan.mode === 'diff' && list.length > 20) log(`    … and ${list.length - 20} more ${label}`);
  }
  if (!plan.submit.length) return { plan, message: 'no page changed since the last announced deploy — IndexNow not called' };
  await checkKeyFile({ origin, key, fetchFn });
  const n = await submitIndexNow({ origin, key, urls: plan.submit, fetchFn, log, dryRun });
  return { plan, message: `${dryRun ? 'would send' : 'sent'} ${n} URL(s) (${plan.mode === 'full' ? 'full list' : 'changed pages only'})` };
}

/** Run a child script (Bing / Google) and pass its output through; throws with its last error line. */
export function runScript({ script, args, env, cwd, exec = spawnSync, log = console.log }) {
  const r = exec(process.execPath, ['--experimental-strip-types', script, ...args], { cwd, env, encoding: 'utf8', timeout: 8 * 60_000 });
  const lines = `${r.stdout ?? ''}\n${r.stderr ?? ''}`.split('\n').filter((l) => l.trim());
  for (const l of lines) log(`    ${l}`);
  if (r.status !== 0) {
    const why = [...lines].reverse().find((l) => l.includes('✗')) ?? r.error?.message ?? `exit ${r.status ?? r.signal}`;
    throw new Error(why.replace(/^\s*✗\s*/, ''));
  }
  return [...lines].reverse().find((l) => /[✓⚠]/.test(l))?.replace(/^\s*✓\s*/, '') ?? 'submitted';
}

/**
 * The whole job with every side effect injected (tests pass stubs). Returns { code, results, storeManifest, live }.
 */
export async function notify({ site, eventName, event, env = {}, fetchFn = fetch, loadPrevious = async () => null,
  contains = async () => false, runBing, runGoogle, log = console.log, sleep, timeoutMs, intervalMs, dryRun = false }) {
  const decision = triggerDecision({ eventName, event, site });
  log(`search-notify — ${site.siteUrl} · ${eventName}: ${decision.reason}${dryRun ? ' · DRY RUN' : ''}`);
  if (!decision.run) return { code: 0, results: [], storeManifest: false, skipped: decision.reason };
  const origin = String(site.siteUrl).replace(/\/$/, '');

  let live;
  try { live = await waitForLive({ origin, expectCommit: decision.expectCommit, fetchFn, contains, log, ...(sleep ? { sleep } : {}), ...(timeoutMs ? { timeoutMs } : {}), ...(intervalMs ? { intervalMs } : {}) }); }
  catch (e) { log(`✗ ${e.message}`); return { code: 1, results: [{ name: 'Wait for the production build', ok: false, message: e.message }], storeManifest: false }; }
  if (live.previewMode === true) {
    log('production serves a previewMode (noindex) build — nothing is announced');
    return { code: 0, results: [], storeManifest: false, skipped: 'live build is previewMode' };
  }
  log(`  ✓ production serves the build of ${live.commit ? live.commit.slice(0, 7) : 'the current commit'} (${Object.keys(live.pages).length} pages, built ${live.builtAt})`);

  let previous;
  try { previous = await loadPrevious(); } catch (e) { previous = { error: e.message }; }
  let indexNowOk = false;
  const results = await runSteps([
    { name: 'IndexNow (changed pages)', run: async () => {
      const r = await indexNowStep({ origin, key: site.indexNow?.key ?? '', live, previous, full: env.INPUT_FULL === 'true', fetchFn, log, dryRun });
      indexNowOk = !dryRun;
      return r.message;
    } },
    { name: 'Bing sitemap', run: async () => {
      if (!String(env.BING_WEBMASTER_API_KEY ?? '').trim()) throw new Error(BING_MISSING);
      return dryRun ? `would resubmit ${origin}/sitemap.xml to Bing` : runBing();
    } },
    { name: 'Google sitemap', run: async () => {
      const missing = GOOGLE_SECRETS.filter((n) => !String(env[n] ?? '').trim());
      if (missing.length) throw new Error(GOOGLE_MISSING(missing));
      return dryRun ? `would resubmit ${origin}/sitemap.xml to Search Console` : runGoogle();
    } },
  ], log);
  const failed = results.filter((r) => !r.ok);
  log(failed.length
    ? `\n✗ search-notify — ${failed.length} of ${results.length} step(s) failed: ${failed.map((r) => r.name).join(', ')}. The site IS live; fix the cause and re-run (Actions → "Tell search engines" → Run workflow).`
    : `\n✓ search-notify — IndexNow, Bing and Google told about ${origin}`);
  return { code: failed.length ? 1 : 0, results, storeManifest: indexNowOk, live };
}

// ------------------------------------------------------------------------------------------------ CLI (GitHub Actions)
const gh = (args) => spawnSync('gh', args, { encoding: 'utf8' });

/** The manifest from the newest unexpired `search-manifest` artifact in this repo, null when there is none. */
export function loadPreviousFromArtifacts(repo) {
  if (!repo) return { error: 'GITHUB_REPOSITORY is not set' };
  const list = gh(['api', `repos/${repo}/actions/artifacts?name=${ARTIFACT}&per_page=50`]);
  if (list.status !== 0) return { error: `could not list this repo's artifacts (${list.stderr.trim().split('\n').pop()})` };
  let arts;
  try { arts = JSON.parse(list.stdout).artifacts ?? []; } catch { return { error: 'the artifact list was not JSON' }; }
  const newest = arts.filter((a) => !a.expired).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0];
  if (!newest) return null;
  const dir = mkdtempSync(join(tmpdir(), 'search-manifest-'));
  try {
    const dl = gh(['run', 'download', String(newest.workflow_run?.id), '-R', repo, '-n', ARTIFACT, '-D', dir]);
    if (dl.status !== 0) return { error: `download of artifact ${newest.id} failed (${dl.stderr.trim().split('\n').pop()})` };
    const file = join(dir, MANIFEST_FILE);
    if (!existsSync(file)) return { error: `artifact ${newest.id} has no ${MANIFEST_FILE}` };
    try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return { error: `artifact ${newest.id} is not JSON` }; }
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

/** Does commit `later` contain commit `earlier`? (GitHub compare: ahead/identical). False when unknown. */
export function containsCommit(repo, earlier, later) {
  if (!repo) return false;
  const r = gh(['api', `repos/${repo}/compare/${earlier}...${later}`, '--jq', '.status']);
  return r.status === 0 && ['ahead', 'identical'].includes(r.stdout.trim());
}

async function main() {
  const env = process.env;
  const here = dirname(fileURLToPath(import.meta.url));
  const root = join(here, '..');
  const dryRun = process.argv.includes('--dry-run');
  const { site } = await import(pathToFileURL(join(root, 'src', 'data', 'site.ts')).href);
  const eventName = env.EVENT_NAME || env.GITHUB_EVENT_NAME || 'workflow_dispatch';
  const event = env.GITHUB_EVENT_PATH && existsSync(env.GITHUB_EVENT_PATH) ? JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8')) : {};
  const evidenceDir = mkdtempSync(join(env.RUNNER_TEMP || tmpdir(), 'search-evidence-'));
  const childEnv = { PATH: env.PATH, HOME: env.HOME, SEARCH_EVIDENCE_DIR: evidenceDir };

  const runBing = () => runScript({ script: join(here, 'bing-webmaster.mjs'), args: ['submit'], cwd: root, env: { ...childEnv, BING_WEBMASTER_API_KEY: env.BING_WEBMASTER_API_KEY.trim() } });
  const runGoogle = () => {
    let token;
    try { token = JSON.parse(env.GOOGLE_TOKEN_JSON); } catch { token = null; }
    if (!token?.refresh_token) throw new Error('GOOGLE_TOKEN_JSON is not a saved Google sign-in (no refresh_token) — owner: `npm run search:connect`');
    const keyDir = mkdtempSync(join(env.RUNNER_TEMP || tmpdir(), 'search-keys-'));
    try {
      const clientFile = join(keyDir, 'google-oauth-client.json');
      const tokenFile = join(keyDir, 'google-token.json');
      writeFileSync(clientFile, JSON.stringify({ installed: { client_id: env.GOOGLE_OAUTH_CLIENT_ID.trim(), client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET.trim() } }), { mode: 0o600 });
      writeFileSync(tokenFile, JSON.stringify(token), { mode: 0o600 });
      return runScript({ script: join(here, 'search-console.mjs'), args: ['submit'], cwd: root, env: { ...childEnv, GOOGLE_OAUTH_CLIENT_FILE: clientFile, GOOGLE_TOKEN_FILE: tokenFile } });
    } finally { rmSync(keyDir, { recursive: true, force: true }); }
  };

  const result = await notify({
    site, eventName, event, env, dryRun,
    loadPrevious: async () => loadPreviousFromArtifacts(env.GITHUB_REPOSITORY),
    contains: async (earlier, later) => containsCommit(env.GITHUB_REPOSITORY, earlier, later),
    runBing, runGoogle,
  });
  rmSync(evidenceDir, { recursive: true, force: true });

  if (result.storeManifest && env.RESULT_DIR) {
    mkdirSync(env.RESULT_DIR, { recursive: true });
    writeFileSync(join(env.RESULT_DIR, MANIFEST_FILE), JSON.stringify(result.live));
  }
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `store_manifest=${result.storeManifest ? 'true' : 'false'}\n`);
  if (env.GITHUB_STEP_SUMMARY) {
    const rows = result.results.map((r) => `| ${r.ok ? '✓' : '✗'} ${r.name} | ${String(r.message).replace(/\|/g, '\\|').replace(/\n/g, ' ')} |`);
    appendFileSync(env.GITHUB_STEP_SUMMARY, [
      `## Tell search engines — ${site.siteUrl}`, '',
      result.skipped ? `Nothing announced: ${result.skipped}.` : ['| Step | Result |', '|---|---|', ...rows].join('\n'), '',
    ].join('\n'));
  }
  process.exit(result.code);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
