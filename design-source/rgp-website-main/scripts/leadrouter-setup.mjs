#!/usr/bin/env node
/**
 * leadrouter-setup.mjs — connect this client site's forms to the ONE agency lead router (CORE_CONTRACTS §27).
 *
 * The router work runs as a GitHub workflow in Restoration-Growth-Partners/rgp-lead-router ("Lead router: set up
 * client"), where the agency keys are GitHub secrets — no key is ever on this computer. This script only needs the
 * `gh` login every team member already has. Safe to re-run.
 *
 *   1. runs the workflow: client record (websites + GHL webhook, stored in Cloudflare), the client's own spam-check
 *      widget, a labelled TEST lead that GHL must accept; with --career-webhook / --partner-webhook also a labelled TEST
 *      career application (+ a small labelled PDF résumé when résumé upload is on) / TEST partner enquiry, each to its
 *      own GHL workflow
 *   2. writes site.ts leadRouter (submitUrl, clientId, siteId, turnstileSiteKey, careersReady, partnerReady)
 *   3. leadrouter:probe on every website (creates no lead)
 *   4. artifacts/launch/lead-delivery.md
 *   Then the agent looks in GHL → Opportunities → New Leads for the test lead (skill agency-lead-delivery-setup).
 *
 * Usage (from the client repo):
 *   npm run leadrouter:setup -- --client <slug> --webhook <GHL inbound webhook URL> [--origin https://x.vercel.app]
 *   npm run leadrouter:setup -- --client <slug>                 # re-run: keeps the stored webhook
 *   npm run leadrouter:setup -- --check                         # read-only: this client's record + recent leads
 *   Careers: --career-webhook <url> [--resume-folder "Career Resume" --location-id <GHL location id>]
 *     (résumé upload also needs the org secret GHL_TOKEN_<CLIENT> — skill agency-lead-delivery-setup)
 *   Partner enquiries: --partner-webhook <url>
 *   --skip-lead-test   no service-lead test this run (it rings the client's office) — e.g. adding careers/partner to a
 *                      client whose lead form is already proven
 */
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : null; };
const opts = (n) => args.flatMap((a, i) => (a === n && args[i + 1] ? [args[i + 1]] : []));
const fails = [];
const ok = (m) => console.log(`  ✓ ${m}`);
const info = (m) => console.log(`  · ${m}`);
const fail = (m) => { fails.push(m); console.error(`  ✗ ${m}`); };
const step = (m) => console.log(`\n${m}`);
const stop = (m) => { if (m) fail(m); finish(); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const gh = (a) => spawnSync('gh', a, { encoding: 'utf8' });

const hosting = JSON.parse(readFileSync(resolve(process.cwd(), 'hosting.json'), 'utf8'));
const ROUTER = (hosting.leadRouter?.url || '').replace(/\/+$/, '');
const REPO = hosting.leadRouter?.repo || 'Restoration-Growth-Partners/rgp-lead-router';
const SITE_TS = resolve(process.cwd(), 'src/data/site.ts');
const { site } = await import(pathToFileURL(SITE_TS).href);
if (!site.siteUrl && existsSync('astro.config.mjs')) {
  const m = readFileSync('astro.config.mjs', 'utf8').match(/\bsite:\s*['"]([^'"]+)['"]/);
  if (m) site.siteUrl = m[1];
}
const lr = site.leadRouter ?? {};
const clientId = opt('--client') || lr.clientId;
if (!ROUTER) stop('hosting.json has no leadRouter.url');
if (!clientId || !/^[a-z0-9-]+$/.test(clientId)) stop('client slug unknown — pass --client <slug> (lowercase, e.g. "dryfirst"); it becomes site.leadRouter.clientId');
if (gh(['auth', 'status']).status !== 0) stop('not logged in to GitHub — run: gh auth login (with your agency GitHub account)');

/** Start a workflow in the router repo, wait for it, print its ✓/✗ lines, return { ok, runId, url }. */
async function runWorkflow(file, fields, label) {
  const started = Date.now();
  const r = gh(['workflow', 'run', file, '-R', REPO, ...Object.entries(fields).filter(([, v]) => v).flatMap(([k, v]) => ['-f', `${k}=${v}`])]);
  if (r.status !== 0) stop(`could not start "${label}": ${r.stderr.trim()} — you need write access to ${REPO} (GitHub team website-team)`);
  let run;
  for (let i = 0; i < 20 && !run; i++) {
    await sleep(3000);
    const list = JSON.parse(gh(['run', 'list', '-R', REPO, '--workflow', file, '--limit', '10', '--json', 'databaseId,createdAt,displayTitle,url']).stdout || '[]');
    run = list.find((x) => Date.parse(x.createdAt) >= started - 10000 && x.displayTitle.includes(fields.client || 'all clients'));
  }
  if (!run) stop(`"${label}" did not start — look at https://github.com/${REPO}/actions`);
  info(`running on GitHub: ${run.url}`);
  const w = spawnSync('gh', ['run', 'watch', String(run.databaseId), '-R', REPO, '--exit-status', '--interval', '5'], { encoding: 'utf8' });
  const log = gh(['run', 'view', String(run.databaseId), '-R', REPO, '--log']).stdout || '';
  for (const line of log.split('\n')) {
    const m = line.match(/\d{2}Z ([✓✗→|].*)$/);
    if (m) console.log(`    ${m[1]}`);
  }
  return { ok: w.status === 0, runId: run.databaseId, url: run.url };
}

// ---------------------------------------------------------------------------------------------- --check
if (args.includes('--check')) {
  step(`Router record + recent leads for "${clientId}" (read-only)`);
  const r = await runWorkflow('check-leads.yml', { client: clientId, limit: '10' }, 'Lead router: check leads');
  r.ok ? ok(`full table: ${r.url}`) : fail(`check failed: ${r.url}`);
  finish();
}

// ---------------------------------------------------------------------------------------------- 1. workflow
if (!site.siteUrl || /example\.com/.test(site.siteUrl)) stop(`site.siteUrl is "${site.siteUrl}" — set the real production URL first`);
const webhook = opt('--webhook') || process.env.GHL_WEBHOOK_URL || '';
const vercelProject = existsSync('.vercel/project.json') ? JSON.parse(readFileSync('.vercel/project.json', 'utf8')).projectName : null;
const extra = [...new Set([...(vercelProject ? [`https://${vercelProject}.vercel.app`] : []), ...opts('--origin').map((o) => new URL(o).origin)])];
step(`1. Router: set up "${clientId}" (GitHub workflow — keys stay on GitHub)`);
const run = await runWorkflow('setup-client.yml', {
  client: clientId, name: opt('--name') || site.name || '', site_url: new URL(site.siteUrl).origin,
  extra_origins: extra.join(','), ghl_webhook_url: webhook,
  career_ghl_webhook_url: opt('--career-webhook') || '', career_resume_folder: opt('--resume-folder') || '',
  ghl_location_id: opt('--location-id') || '', partner_ghl_webhook_url: opt('--partner-webhook') || '',
  send_test_lead: args.includes('--skip-lead-test') ? 'false' : '',
}, 'Lead router: set up client');
const dir = mkdtempSync(resolve(tmpdir(), 'leadrouter-'));
gh(['run', 'download', String(run.runId), '-R', REPO, '-n', 'result', '-D', dir]);
const result = existsSync(resolve(dir, 'result.json')) ? JSON.parse(readFileSync(resolve(dir, 'result.json'), 'utf8')) : {};
if (!run.ok) fail(`the router setup reported a problem — details: ${run.url}`);
else ok('client record saved, test lead accepted by GHL');

// ---------------------------------------------------------------------------------------------- 2. site.ts
step('2. site.ts leadRouter values');
const want = { submitUrl: `${ROUTER}/submit`, clientId, siteId: lr.siteId || `${clientId}-restoration`, turnstileSiteKey: result.turnstileSiteKey || '' };
// Careers / Partner forms switch on only when the router has that form's own GHL workflow (and, for a careers form
// that asks for a résumé, the résumé folder) — the values come from the router, never from this run's flags.
const forms = site.forms ?? {};
const ready = {};
if ('careerWebhookSet' in result) {
  const resumeMismatch = result.careerWebhookSet && forms.careers?.resumeUpload && !result.resumeUpload;
  ready.careersReady = Boolean(result.careerWebhookSet && !resumeMismatch);
  ready.partnerReady = Boolean(result.partnerWebhookSet);
  if (resumeMismatch) fail('site.forms.careers.resumeUpload is on but the router has no résumé folder — re-run with --resume-folder "<GHL Media folder>" --location-id <id> (org secret GHL_TOKEN_' + clientId.toUpperCase() + '), or set resumeUpload: false');
  if (forms.careers?.enabled && !ready.careersReady && !resumeMismatch) info('site.forms.careers is on but the router has no careers workflow yet — the form stays disabled until you re-run with --career-webhook <URL>');
  if (forms.partner?.enabled && !ready.partnerReady) info('site.forms.partner is on but the router has no partner workflow yet — the form stays disabled until you re-run with --partner-webhook <URL>');
}
const src = readFileSync(SITE_TS, 'utf8');
const block = src.match(/leadRouter:\s*\{[\s\S]*?\n\s*\}/);
if (!block) stop('could not find the leadRouter block in src/data/site.ts');
let next = block[0];
for (const [k, v] of Object.entries(want)) {
  if (!v) continue;
  const re = new RegExp(`(${k}:\\s*)(['"\`])[^'"\`]*\\2`);
  if (!re.test(next)) { fail(`site.ts leadRouter.${k} not found`); continue; }
  next = next.replace(re, `$1'${v}'`);
}
for (const [k, v] of Object.entries(ready)) {
  const re = new RegExp(`(${k}:\\s*)(true|false)`);
  if (!re.test(next)) { fail(`site.ts leadRouter.${k} not found — add \`${k}: false,\` to the leadRouter block (starter ≥ 2026-10-28)`); continue; }
  next = next.replace(re, `$1${v}`);
}
if (!want.turnstileSiteKey && !lr.turnstileSiteKey) fail('no spam-check site key came back from the router setup — see the run page');
if (next === block[0]) ok('already set');
else { writeFileSync(SITE_TS, src.replace(block[0], next)); ok(`written: ${[...Object.entries(want).filter(([, v]) => v), ...Object.entries(ready)].map(([k, v]) => `${k}=${v}`).join(' · ')} — commit and push`); }

// ---------------------------------------------------------------------------------------------- 3. probe
step('3. leadrouter:probe (every website, no lead created)');
const origins = result.origins || [];
const probe = spawnSync(process.execPath, ['--experimental-strip-types', resolve(process.cwd(), 'scripts/probe-lead-router.mjs'), ...origins.flatMap((o) => ['--origin', o])], { encoding: 'utf8' });
process.stdout.write(probe.stdout.split('\n').map((l) => `  ${l}`).join('\n'));
if (probe.status !== 0) fail('leadrouter:probe failed (see above)');

// ---------------------------------------------------------------------------------------------- 4. record
step('4. Evidence record');
mkdirSync('artifacts/launch', { recursive: true });
const t = result.testLead;
const formTest = (x, where) => x ? `\`${x.id}\` (${x.email}) → router status **${x.status}**; GHL check — ${where}: **pending** (agent fills in: date, execution log seen)` : 'not sent this run';
writeFileSync('artifacts/launch/lead-delivery.md', `# Lead delivery — ${site.name || clientId}

Generated by \`npm run leadrouter:setup\` on ${new Date().toISOString()} (CORE_CONTRACTS §27). No secrets in this file.

- Router: ${ROUTER} · client_id \`${clientId}\` · site_id \`${want.siteId}\`
- Websites allowed to send leads: ${origins.join(', ') || '(see run)'}
- Spam-check site key: \`${want.turnstileSiteKey || lr.turnstileSiteKey}\`
- Router setup run: ${run.url} → ${run.ok ? 'passed' : 'FAILED'}
- Test lead: ${t ? `\`${t.id}\` (${t.email}) → router status **${t.status}**` : 'not sent'}
- GHL check — Opportunities → **New Leads** shows the test lead: **pending** (agent fills in: date, pipeline, stage)
- Real browser submission on the deployed site: **pending** (agent fills in: lead id, date, New Leads confirmed)
- Careers form: ${result.careerWebhookSet ? `connected${result.resumeUpload ? ' (résumés → GHL Media)' : ' (no résumé upload)'}` : 'not connected'} · test application: ${formTest(result.testCareer, 'careers workflow Execution logs + NOT in New Leads' + (result.resumeUpload ? ' + labelled PDF in the Media folder' : ''))}
- Partner form: ${result.partnerWebhookSet ? 'connected' : 'not connected'} · test enquiry: ${formTest(result.testPartner, 'partner workflow Execution logs + NOT in New Leads')}
`);
ok('artifacts/launch/lead-delivery.md');
if (t) info(`next: open the client's GHL → Opportunities → New Leads and find ${t.email}`);
if (result.testCareer) info(`next: the careers workflow's Execution logs show ${result.testCareer.email} (and it is NOT in New Leads)`);
if (result.testPartner) info(`next: the partner workflow's Execution logs show ${result.testPartner.email} (and it is NOT in New Leads)`);
finish();

function finish() {
  console.log(fails.length ? `\n✗ leadrouter:setup — ${fails.length} problem(s). Fix the first one and re-run (safe to repeat).` : '\n✓ leadrouter:setup passed');
  process.exit(fails.length ? 1 : 0);
}
