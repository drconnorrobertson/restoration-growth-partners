#!/usr/bin/env node
/**
 * verify-deploy.mjs — prove the last push reached GitHub cleanly AND Vercel deployed it correctly (§25).
 *
 *  1. git: no unpushed commits on the current branch (warns on a dirty tree)
 *  2. GitHub: the commit's status/check from Vercel reaches success (polls; failure = exit 1 with the URL)
 *  3. Vercel deployment smoke: / (200, HTML), /robots.txt, /sitemap.xml (real XML), /llms.txt (200),
 *     plus the first page listed in the sitemap — all fetched on the site's public address:
 *     `--url` if given; else `site.siteUrl` once launched (site.previewMode false); else, before launch, the Vercel
 *     project's stable production alias (*.vercel.app, looked up with `vercel api`). Never the dashboard link Vercel
 *     posts on GitHub or a per-deployment URL: those are protected and fail falsely (scripts/lib/deploy-url.mjs).
 *
 * Usage: npm run deploy:verify [-- --sha <sha>] [--url <address>] [--timeout <seconds>] [--repo owner/name]
 * Run after EVERY push (build handoff, review, launch). A failed deploy is a blocker, never a "probably fine".
 */
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chooseSmokeUrl, pickStableAlias, vercelProjectFromStatusUrl } from './lib/deploy-url.mjs';
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const sh = (c) => execSync(c, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const hosting = existsSync('hosting.json') ? JSON.parse(readFileSync('hosting.json', 'utf8')) : {};
const fails = []; const fail = (m) => { fails.push(m); console.error(`  ✗ ${m}`); };
const ok = (m) => console.log(`  ✓ ${m}`);
let url = null; // the address the smoke test (step 3) runs on

// 1. git state
let sha = arg('--sha', null);
try { if (!sha) sha = sh('git rev-parse HEAD'); } catch { fail('not a git repo'); done(); }
if (sh('git status --porcelain')) console.warn('  ⚠ working tree has uncommitted changes — the deployment reflects HEAD, not these');
try { const ahead = Number(sh('git rev-list --count @{u}..HEAD')); ahead === 0 ? ok(`nothing unpushed (HEAD ${sha.slice(0, 7)})`) : fail(`${ahead} commit(s) not pushed — push first`); }
catch { fail('no upstream branch — run npm run repo:setup'); }
let repo = arg('--repo', null);
if (!repo) { try { repo = sh('git remote get-url origin').replace(/^.*github\.com[/:]/, '').replace(/\.git$/, ''); } catch { fail('no origin remote'); } }

// 2. GitHub → Vercel status
const cliUrl = arg('--url', null);
let statusUrl = null; // Vercel's dashboard link for this commit's deployment (build log), never smoke-tested
const timeout = Number(arg('--timeout', 600)) * 1000; const started = Date.now();
const tokenEnv = (() => { try { return { ...process.env, GH_TOKEN: sh(`gh auth token --user ${hosting.githubUser || ''}`) }; } catch { return process.env; } })();
const gh = (path) => JSON.parse(execSync(`gh api ${path}`, { encoding: 'utf8', env: tokenEnv }));
if (repo && !cliUrl) {
  let state = 'pending', lastSeen = 'none';
  while (Date.now() - started < timeout) {
    let vercel = null;
    try {
      const st = gh(`repos/${repo}/commits/${sha}/status`);
      vercel = (st.statuses || []).find((s) => /vercel/i.test(s.context));
      if (!vercel) { const cr = gh(`repos/${repo}/commits/${sha}/check-runs`); const run = (cr.check_runs || []).find((r) => /vercel/i.test(r.app?.slug || r.name)); if (run) vercel = { state: run.conclusion === 'success' ? 'success' : run.status === 'completed' ? 'failure' : 'pending', target_url: run.details_url }; }
    } catch (e) { fail(`GitHub API error: ${e.message.split('\n')[0]}`); break; }
    if (!vercel) { lastSeen = 'no Vercel status yet'; }
    else { state = vercel.state; statusUrl = vercel.target_url; lastSeen = state; if (state !== 'pending') break; }
    execSync('sleep 10');
  }
  if (state === 'success') ok(`Vercel reported success on GitHub for ${sha.slice(0, 7)}`);
  else if (state === 'pending' && lastSeen === 'no Vercel status yet') fail(`no Vercel status on this commit after ${timeout / 1000}s — is the repo connected to a Vercel project (npm run vercel:setup) and the GitHub App installed?`);
  else if (state === 'pending') fail(`Vercel still building after ${timeout / 1000}s`);
  else fail(`Vercel deployment ${state}: ${statusUrl || '(no URL)'} — open the Vercel build log; do not proceed`);
}

// 3. smoke on the site's public address (see the header and scripts/lib/deploy-url.mjs)
let site = null;
try { ({ site } = await import(pathToFileURL(resolve(process.cwd(), 'src/data/site.ts')).href)); } catch { /* chooseSmokeUrl names the fix */ }
let alias = null;
if (!cliUrl && site && site.previewMode !== false) {
  // Before launch: the project's stable *.vercel.app alias, read from Vercel (its name can be shortened, so never guessed).
  const linked = existsSync('.vercel/project.json') ? JSON.parse(readFileSync('.vercel/project.json', 'utf8')) : {};
  const fromStatus = vercelProjectFromStatusUrl(statusUrl);
  const project = fromStatus?.project || linked.projectId || linked.projectName;
  const scope = fromStatus?.team || hosting.vercelTeam || linked.orgId;
  if (project) {
    try { alias = pickStableAlias(JSON.parse(sh(`vercel api "/v9/projects/${encodeURIComponent(project)}/domains?production=true"${scope ? ` --scope ${scope}` : ''}`))); }
    catch (e) { console.warn(`  ⚠ Vercel domain lookup failed: ${String(e.stderr || e.message).trim().split('\n').pop()}`); }
  }
}
const target = chooseSmokeUrl({ cliUrl, site, alias });
if (!target.url) fail(target.problem);
else {
  url = target.url;
  console.log(`  · smoke test on ${url} — ${target.source}`);
  let branch = '';
  try { branch = sh('git rev-parse --abbrev-ref HEAD'); } catch { /* not on a branch */ }
  if (!cliUrl && branch && hosting.productionBranch && branch !== hosting.productionBranch) {
    console.warn(`  ⚠ on branch ${branch}: its preview is not what this address serves (that is ${hosting.productionBranch}); pass --url <the branch preview> to test it`);
  }
}
if (url) {
  const origin = url.replace(/\/$/, '');
  const get = async (p) => { const r = await fetch(origin + p, { redirect: 'manual' }); return { status: r.status, type: r.headers.get('content-type') || '', body: r.status === 200 ? await r.text() : '' }; };
  const root = await get('/');
  if (root.status === 401) fail(`${origin} returns 401 — Vercel Deployment Protection is on; disable it for previews (Project → Settings → Deployment Protection) or share a bypass link`);
  else root.status === 200 && /html/.test(root.type) ? ok(`/ 200 html`) : fail(`/ → ${root.status}`);
  for (const p of ['/robots.txt', '/llms.txt']) { const r = await get(p); r.status === 200 ? ok(`${p} 200`) : fail(`${p} → ${r.status}`); }
  const sm = await get('/sitemap.xml');
  if (sm.status === 200 && sm.body.trimStart().startsWith('<?xml')) {
    ok('/sitemap.xml 200 xml');
    const loc = [...sm.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]).find((l) => !/sitemap/.test(l));
    if (loc) { const p = new URL(loc).pathname; const r = await get(p); r.status === 200 ? ok(`${p} 200 (from sitemap)`) : fail(`${p} (from sitemap) → ${r.status}`); }
  } else fail(`/sitemap.xml → ${sm.status} ${sm.status === 200 ? '(not XML — a redirect shell?)' : ''}`);
  const noindex = /<meta[^>]*name="robots"[^>]*noindex/i.test(root.body);
  console.log(`  · index state on this deployment: ${noindex ? 'noindex (site.previewMode true — expected before launch)' : 'INDEXABLE (launch posture)'}`);
}
done();
function done() { console.log(fails.length ? `\n✗ deploy:verify failed — ${fails.length} problem(s). Fix before handing off.` : `\n✓ deploy:verify passed — ${url || '(no deployment URL)'}`); process.exit(fails.length ? 1 : 0); }
