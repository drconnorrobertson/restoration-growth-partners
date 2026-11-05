#!/usr/bin/env node
/**
 * site-alert.mjs — command-line front of scripts/lib/site-alert.mjs (CORE_CONTRACTS §32 "Website Alerts").
 * Copied UNCHANGED into every repo that sends alerts. Never fails the caller: delivery problems are logged (and shown
 * as warnings) and the exit code is 0; only a wrong command line exits 2.
 *
 *   node scripts/site-alert.mjs event
 *       In GitHub Actions: reads the triggering event (.github/workflows/site-alerts.yml) —
 *         workflow_run      another workflow of this repo completed: failure / timed_out / startup_failure → alert
 *                           "workflow:<file>"; success (at least one job really ran and passed) → recovery.
 *         deployment_status a Production deployment (Vercel): failure / error → alert "vercel-production-deploy";
 *                           success → recovery.
 *         workflow_dispatch with ALERT_TEST=true → `test` below.
 *   node scripts/site-alert.mjs test
 *       A clearly labelled TEST alert ("[TEST] [<site>] Alert test — please ignore"), then its recovery.
 *   node scripts/site-alert.mjs raise   --check <id> --title "<what broke>" [--summary …] [--site …] [--where <url>]
 *                                       [--severity …] [--cause …] [--next …] [--link "Label=https://…"]… [--details-file f]
 *                                       [--issue <n>] [--test]
 *   node scripts/site-alert.mjs resolve --check <id> [--site …] [--summary …] [--issue <n>]
 *
 * Site name: --site, else env SITE_NAME, else site.name from src/data/site.ts, else the repository name.
 * Env: CLICKUP_API_TOKEN, SLACK_ALERT_WEBHOOK_URL (organization secrets), GITHUB_TOKEN or GH_TOKEN, GITHUB_REPOSITORY,
 * GITHUB_EVENT_NAME, GITHUB_EVENT_PATH, GITHUB_STEP_SUMMARY; ALERTS_CONFIG (optional path to alerts.json).
 */
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createAlerter, loadConfig } from './lib/site-alert.mjs';

const env = process.env;
const argv = process.argv.slice(2);
const cmd = argv[0];
const opts = {};
const links = [];
for (let i = 1; i < argv.length; i++) {
  const a = argv[i];
  if (!a.startsWith('--')) continue;
  const name = a.slice(2);
  if (name === 'test') { opts.test = true; continue; }
  const v = argv[++i];
  if (name === 'link') links.push(v); else opts[name] = v;
}
const usage = () => { console.error('usage: site-alert.mjs event | test | raise --check <id> --title "<what broke>" [...] | resolve --check <id> [...]'); process.exit(2); };
if (!['event', 'test', 'raise', 'resolve'].includes(cmd)) usage();

const repo = env.GITHUB_REPOSITORY ?? '';
const server = env.GITHUB_SERVER_URL ?? 'https://github.com';
const runUrl = env.GITHUB_RUN_ID ? `${server}/${repo}/actions/runs/${env.GITHUB_RUN_ID}` : '';

async function siteName() {
  if (opts.site) return opts.site;
  if (env.SITE_NAME) return env.SITE_NAME;
  const file = join(process.cwd(), 'src', 'data', 'site.ts');
  if (existsSync(file)) {
    try { const { site } = await import(pathToFileURL(file).href); if (site?.name) return site.name; } catch { /* fall through */ }
    const m = /\bname:\s*['"]([^'"]+)['"]/.exec(readFileSync(file, 'utf8'));
    if (m) return m[1];
  }
  return repo.split('/')[1] || 'unknown site';
}

const summaryLines = [];
const report = (title, r) => {
  summaryLines.push(`### ${title}`, '', `Alert \`${r.key}\`: **${r.action}**`, '', ...(r.lines ?? []).map((l) => `- ${l}`), '');
  for (const l of r.lines ?? []) if (/: (skipped|failed)/.test(l)) console.log(`::warning title=Website alert::${l}`);
};

let alerter;
try { alerter = createAlerter({ config: loadConfig() }); }
catch (e) { console.log(`::warning title=Website alert::not sent — ${e.message}`); process.exit(0); }

const gh = async (path) => {
  const token = env.GITHUB_TOKEN || env.GH_TOKEN;
  const res = await fetch(`${env.GITHUB_API_URL ?? 'https://api.github.com'}/repos/${repo}${path}`, { headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`GitHub ${path} → HTTP ${res.status}`);
  return res.json();
};

const NEXT_STEP = {
  'publish-scheduled-posts': 'Open the failed run, fix what its last step names (deploy hook secret, a post that did not go live, Search Console keys), then Actions → "Publish scheduled blog posts" → Run workflow with "Dry run" UNTICKED. A due post stays unpublished until this succeeds.',
  'search-notify': 'Open the failed run: its summary names the failed step (IndexNow, Bing or Google). Fix it (usually an expired or missing organization secret — owner: npm run search:connect), then Actions → "Tell search engines" → Run workflow.',
};
const SEVERITY = {
  'publish-scheduled-posts': 'High — this week\'s scheduled blog post(s) may not be live.',
  'search-notify': 'Medium — the site is up; search engines were not told about the latest deploy.',
};

async function onWorkflowRun(ev, site) {
  const run = ev.workflow_run;
  const file = basename(run.path ?? run.name ?? 'workflow', '.yml');
  const check = `workflow:${file}`;
  const conclusion = run.conclusion;
  if (conclusion === 'success') {
    let ranJob = true;
    try { ranJob = (await gh(`/actions/runs/${run.id}/jobs?per_page=100`)).jobs.some((j) => j.conclusion === 'success'); } catch { /* assume it ran */ }
    if (!ranJob) { console.log(`"${run.name}" run ${run.id} skipped every job — nothing checked, no recovery.`); return; }
    report(`Recovery — ${run.name}`, await alerter.resolve({ site, check, summary: `"${run.name}" run #${run.run_number} succeeded` }));
    return;
  }
  if (!['failure', 'timed_out', 'startup_failure'].includes(conclusion)) { console.log(`"${run.name}" concluded ${conclusion} — not an alert.`); return; }
  let failedSteps = [];
  try {
    const jobs = (await gh(`/actions/runs/${run.id}/jobs?per_page=100`)).jobs;
    failedSteps = jobs.filter((j) => j.conclusion && j.conclusion !== 'success' && j.conclusion !== 'skipped')
      .map((j) => `${j.name}${(j.steps ?? []).filter((s) => s.conclusion === 'failure').map((s) => ` → step "${s.name}"`).join('')}`);
  } catch { /* the link is enough */ }
  report(`Alert — ${run.name}`, await alerter.raise({
    site, check,
    title: `"${run.name}" workflow failed`,
    summary: `run #${run.run_number} ${conclusion.replace('_', ' ')} (${run.event}, ${run.head_branch})`,
    where: run.html_url,
    severity: SEVERITY[file] ?? 'High — a website workflow failed.',
    cause: failedSteps.length ? `Failed: ${failedSteps.join('; ')}. The run log has the exact error.` : '',
    nextStep: NEXT_STEP[file] ?? `Open the failed run, fix the error, then re-run it (Actions → "${run.name}" → Re-run failed jobs, or Run workflow).`,
    links: [{ label: 'Failed run', url: run.html_url }, { label: 'Commit', url: `${server}/${repo}/commit/${run.head_sha}` }],
  }));
}

async function onDeployment(ev, site) {
  const d = ev.deployment ?? {};
  const s = ev.deployment_status ?? {};
  const envName = String(s.environment ?? d.environment ?? '');
  if (envName.toLowerCase() !== 'production') { console.log(`Deployment to "${envName}" — only Production is watched.`); return; }
  const check = 'vercel-production-deploy';
  if (s.state === 'success') { report('Recovery — Vercel production deploy', await alerter.resolve({ site, check, summary: `production deploy of ${String(d.sha).slice(0, 7)} succeeded` })); return; }
  if (!['failure', 'error'].includes(s.state)) { console.log(`Production deployment state "${s.state}" — not final.`); return; }
  report('Alert — Vercel production deploy', await alerter.raise({
    site, check,
    title: 'Vercel production deploy failed',
    summary: `deploy of ${String(d.sha).slice(0, 7)} (${d.ref ?? 'main'}) ended "${s.state}"${s.description ? `: ${s.description}` : ''}`,
    where: s.environment_url || s.target_url || '',
    severity: 'High — the latest change is NOT live; the site keeps serving the previous deployment.',
    cause: s.description ? `Vercel says: ${s.description}` : 'See the Vercel build log.',
    nextStep: 'Open the Vercel deployment log (link), fix the build error, and push the fix to main — or revert the commit (CORE_CONTRACTS §25); Vercel redeploys on push. Then `npm run deploy:verify`.',
    links: [s.target_url && { label: 'Vercel deployment (build log)', url: s.target_url }, { label: 'Commit', url: `${server}/${repo}/commit/${d.sha}` }].filter(Boolean),
  }));
}

async function testAlert(site) {
  const base = { site, check: 'alert-test', test: true };
  const raised = await alerter.raise({
    ...base,
    title: 'Alert test — please ignore',
    summary: 'labelled test of the website alert path; it resolves itself in a few seconds',
    where: runUrl,
    severity: 'None — TEST',
    cause: 'Sent on purpose (Run workflow → "alert test").',
    nextStep: 'Nothing. Check the ClickUp task, the Slack post (with the tags) and this repo\'s GitHub issue all appeared, then closed.',
    links: runUrl ? [{ label: 'Test run', url: runUrl }] : [],
  });
  report('TEST alert', raised);
  report('TEST recovery', await alerter.resolve({ ...base, summary: 'test complete' }));
}

const site = await siteName();
if (cmd === 'test') await testAlert(site);
else if (cmd === 'raise' || cmd === 'resolve') {
  if (!opts.check || (cmd === 'raise' && !opts.title)) usage();
  const a = {
    site, check: opts.check, title: opts.title, summary: opts.summary, where: opts.where, severity: opts.severity,
    cause: opts.cause, nextStep: opts.next, test: opts.test, issue: opts.issue ? Number(opts.issue) : undefined,
    details: opts['details-file'] && existsSync(opts['details-file']) ? readFileSync(opts['details-file'], 'utf8') : undefined,
    links: [...links.map((l) => { const i = l.indexOf('='); return { label: l.slice(0, i), url: l.slice(i + 1) }; }), ...(runUrl ? [{ label: 'Run', url: runUrl }] : [])],
  };
  report(`${cmd === 'raise' ? 'Alert' : 'Recovery'} — ${opts.check}`, cmd === 'raise' ? await alerter.raise(a) : await alerter.resolve(a));
} else {
  const name = env.GITHUB_EVENT_NAME;
  let ev = {};
  try { ev = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8')); } catch { /* no event */ }
  try {
    if (name === 'workflow_run') await onWorkflowRun(ev, site);
    else if (name === 'deployment_status') await onDeployment(ev, site);
    else if (name === 'workflow_dispatch' && String(env.ALERT_TEST) === 'true') await testAlert(site);
    else console.log(`Event "${name}" — nothing to do (manual runs need the "alert test" box ticked).`);
  } catch (e) { console.log(`::warning title=Website alert::not sent — ${String(e?.message ?? e)}`); }
}
if (summaryLines.length) {
  console.log(summaryLines.join('\n'));
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `## Website alert\n\n${summaryLines.join('\n')}\n`);
}
process.exit(0);
