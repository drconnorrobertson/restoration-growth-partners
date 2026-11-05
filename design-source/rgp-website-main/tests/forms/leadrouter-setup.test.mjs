/**
 * `npm run leadrouter:setup` (scripts/leadrouter-setup.mjs, CORE_CONTRACTS §27) with a FAKE `gh` on PATH: no GitHub
 * workflow runs, no router is touched, the probe is a stub. Proves what the script sends to the router's
 * "set up client" workflow (--partner-webhook, --career-webhook, --skip-lead-test) and what it writes back from the
 * router's answer: site.ts leadRouter.careersReady / partnerReady (a careers form that asks for a résumé stays OFF
 * while the router has no résumé folder) and the careers / partner lines of artifacts/launch/lead-delivery.md.
 * Run: npm run test:forms
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** A throwaway client repo: the starter's site.ts (real siteUrl), hosting.json, the setup script, a stub probe, a fake gh. */
function project(result) {
  const dir = mkdtempSync(join(tmpdir(), 'leadrouter-setup-'));
  mkdirSync(join(dir, 'src/data'), { recursive: true });
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  mkdirSync(join(dir, 'bin'));
  cpSync(join(ROOT, 'hosting.json'), join(dir, 'hosting.json'));
  cpSync(join(ROOT, 'scripts/leadrouter-setup.mjs'), join(dir, 'scripts/leadrouter-setup.mjs'));
  writeFileSync(join(dir, 'scripts/probe-lead-router.mjs'), "console.log('✓ probe stub');\n");
  const site = readFileSync(join(ROOT, 'src/data/site.ts'), 'utf8').replace(/siteUrl:\s*'[^']*'/, "siteUrl: 'https://www.demo-restoration.com'");
  writeFileSync(join(dir, 'src/data/site.ts'), site);
  writeFileSync(join(dir, 'result.json'), JSON.stringify(result));
  // Fake gh: records every call; "run download" hands back result.json like the workflow's artifact.
  writeFileSync(join(dir, 'bin/gh'), `#!/usr/bin/env node
const fs = require('node:fs'); const a = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(join(dir, 'gh-calls.log'))}, JSON.stringify(a) + '\\n');
if (a[0] === 'run' && a[1] === 'list') console.log(JSON.stringify([{ databaseId: 7, createdAt: new Date().toISOString(), displayTitle: 'Set up demo', url: 'https://github.com/x/actions/runs/7' }]));
if (a[0] === 'run' && a[1] === 'view') console.log('2026-10-28T00:00:00.0000000Z ✓ client "demo" updated');
if (a[0] === 'run' && a[1] === 'download') fs.copyFileSync(${JSON.stringify(join(dir, 'result.json'))}, a[a.indexOf('-D') + 1] + '/result.json');
`);
  chmodSync(join(dir, 'bin/gh'), 0o755);
  const run = (...args) => spawnSync(process.execPath, ['--experimental-strip-types', 'scripts/leadrouter-setup.mjs', ...args], {
    cwd: dir, encoding: 'utf8', env: { ...process.env, PATH: `${join(dir, 'bin')}:${process.env.PATH}` },
  });
  const calls = () => readFileSync(join(dir, 'gh-calls.log'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  return { dir, run, calls, site: () => readFileSync(join(dir, 'src/data/site.ts'), 'utf8'), record: () => readFileSync(join(dir, 'artifacts/launch/lead-delivery.md'), 'utf8') };
}

const base = { ok: true, clientId: 'demo', origins: ['https://www.demo-restoration.com', 'https://demo-restoration.com'], turnstileSiteKey: '0x4AAAAAAATESTKEY' };
const sent = (p) => Object.fromEntries(p.calls().find((c) => c[0] === 'workflow' && c[1] === 'run' && c[2] === 'setup-client.yml').filter((x, i, a) => a[i - 1] === '-f').map((f) => f.split(/=(.*)/s).slice(0, 2)));

test('careers + partner webhooks are sent; --skip-lead-test skips only the service-lead test; both forms switch on', () => {
  const p = project({
    ...base, careerWebhookSet: true, partnerWebhookSet: true, resumeUpload: true,
    testCareer: { id: 'c1', email: 'clientinfo+careertest-demo@restorationgrowthpartners.com', status: 'delivered' },
    testPartner: { id: 'p1', email: 'clientinfo+partnertest-demo@restorationgrowthpartners.com', status: 'delivered' },
  });
  const r = p.run('--client', 'demo', '--career-webhook', 'https://services.leadconnectorhq.com/hooks/L/webhook-trigger/career',
    '--resume-folder', 'Career Resume', '--location-id', 'LOC1', '--partner-webhook', 'https://services.leadconnectorhq.com/hooks/L/webhook-trigger/partner', '--skip-lead-test');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(
    { career: sent(p).career_ghl_webhook_url, partner: sent(p).partner_ghl_webhook_url, folder: sent(p).career_resume_folder, test: sent(p).send_test_lead },
    { career: 'https://services.leadconnectorhq.com/hooks/L/webhook-trigger/career', partner: 'https://services.leadconnectorhq.com/hooks/L/webhook-trigger/partner', folder: 'Career Resume', test: 'false' },
  );
  assert.match(p.site(), /careersReady: true,/);
  assert.match(p.site(), /partnerReady: true,/);
  assert.match(p.site(), /clientId: 'demo'/);
  const rec = p.record();
  assert.match(rec, /Careers form: connected \(résumés → GHL Media\) · test application: `c1` \(clientinfo\+careertest-demo@/);
  assert.match(rec, /Partner form: connected · test enquiry: `p1`/);
  assert.match(rec, /Test lead: not sent/);
});

test('without the flags nothing extra is sent and the forms stay off; the service-lead test is not skipped', () => {
  const p = project({ ...base, careerWebhookSet: false, partnerWebhookSet: false, resumeUpload: false, testLead: { id: 'l1', email: 'x@y.co', status: 'delivered' } });
  const r = p.run('--client', 'demo');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const f = sent(p);
  assert.equal(f.partner_ghl_webhook_url, undefined);
  assert.equal(f.send_test_lead, undefined); // the workflow's default: send it
  assert.match(p.site(), /careersReady: false,/);
  assert.match(p.site(), /partnerReady: false,/);
  assert.match(p.record(), /Careers form: not connected · test application: not sent this run/);
});

test('a careers form that asks for a résumé stays OFF (and the run fails) while the router has no résumé folder', () => {
  const p = project({ ...base, careerWebhookSet: true, partnerWebhookSet: false, resumeUpload: false });
  const r = p.run('--client', 'demo', '--career-webhook', 'https://services.leadconnectorhq.com/hooks/L/webhook-trigger/career', '--skip-lead-test');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /resumeUpload is on but the router has no résumé folder — re-run with --resume-folder/);
  assert.match(p.site(), /careersReady: false,/);
});
