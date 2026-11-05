/**
 * `npm run gsc` / `npm run bing` argument handling (scripts/lib/search-remote.mjs), the central workflow's
 * input checks and missing-secret failure (scripts/search-engines-ci.mjs), and the BingSiteAuth.xml merge.
 * Nothing here calls GitHub, Google or Bing. Run: npm run test:search
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { planRemote, mergeBingAuth, saveEvidence } from '../../scripts/lib/search-remote.mjs';
import { planCentral, missingSecrets, scrub, ACTIONS } from '../../scripts/search-engines-ci.mjs';

const STARTER = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
// The workflow lives in agent-website-builder only; client repos (a copy of the starter) skip that test.
const WORKFLOW_PATH = join(STARTER, '..', '.github', 'workflows', 'search-engines.yml');
const WORKFLOW = existsSync(WORKFLOW_PATH) ? readFileSync(WORKFLOW_PATH, 'utf8') : null;

test('planRemote: the commands people use map to workflow actions', () => {
  assert.deepEqual(planRemote('gsc', []), { cmd: 'status', action: 'gsc-status', urls: [] });
  assert.equal(planRemote('gsc', ['verify']).action, 'gsc-verify');
  assert.equal(planRemote('gsc', ['submit']).action, 'gsc-submit');
  assert.equal(planRemote('gsc', ['submit', '--check']).action, 'gsc-submit-check');
  assert.deepEqual(planRemote('gsc', ['inspect', 'https://www.x.com/', 'https://www.x.com/a/']).urls, ['https://www.x.com/', 'https://www.x.com/a/']);
  assert.equal(planRemote('bing', ['status']).action, 'bing-status');
  assert.equal(planRemote('bing', ['submit']).action, 'bing-submit');
  for (const tool of ['gsc', 'bing']) for (const cmd of ['status', 'verify', 'submit']) {
    const { action } = planRemote(tool, [cmd]);
    assert.ok(ACTIONS[action] || cmd === 'verify', `${action} exists in the workflow runner`);
  }
});

test('planRemote: bad input is rejected with a plain message', () => {
  assert.throws(() => planRemote('gsc', ['delete']), /unknown command "delete" — use one of: status, verify, submit, inspect/);
  assert.throws(() => planRemote('bing', ['inspect']), /unknown command/);
  assert.throws(() => planRemote('gsc', ['status', '--force']), /unknown option --force/);
  assert.throws(() => planRemote('bing', ['submit', '--check']), /unknown option --check/);
  assert.throws(() => planRemote('gsc', ['submit', 'https://x.com/']), /takes no URLs/);
  assert.throws(() => planRemote('gsc', ['inspect', '/blog/']), /not a full page URL/);
  assert.throws(() => planRemote('gsc', ['inspect', 'ftp://x.com/']), /not a full page URL/);
  assert.throws(() => planRemote('gsc', ['inspect', ...Array.from({ length: 21 }, (_, i) => `https://x.com/${i}`)]), /at most 20/);
});

test('every action the runner knows is a choice in the workflow (and verify-prepare/verify exist for both tools)', { skip: !WORKFLOW && 'the workflow is in agent-website-builder only' }, () => {
  for (const a of Object.keys(ACTIONS)) assert.match(WORKFLOW, new RegExp(`- ${a}\\n`), a);
  for (const a of ['gsc-verify-prepare', 'gsc-verify', 'bing-verify-prepare', 'bing-verify']) assert.ok(ACTIONS[a]);
  assert.match(WORKFLOW, /^on:\n {2}workflow_dispatch:/m, 'workflow_dispatch only');
  for (const line of WORKFLOW.split('\n').filter((l) => /^\s*run:/.test(l))) assert.doesNotMatch(line, /\$\{\{/, `no expressions in run: ${line}`);
  assert.doesNotMatch(WORKFLOW, /set -x/);
});

test('planCentral: site_url and urls are checked before anything runs', () => {
  assert.deepEqual(planCentral({ ACTION: 'gsc-status', SITE_URL: 'https://www.romexterra.com/' }), { tool: 'gsc', args: ['status'], site: 'https://www.romexterra.com', urls: [] });
  assert.deepEqual(planCentral({ ACTION: 'gsc-submit-check', SITE_URL: 'https://www.x.com' }).args, ['submit', '--check']);
  assert.match(planCentral({ ACTION: 'nope', SITE_URL: 'https://www.x.com' }).problem, /unknown action/);
  for (const bad of ['', 'www.x.com', 'https://www.x.com/blog/', 'https://www.example.com', 'https://x.com/?a=1', 'javascript:alert(1)', 'https://localhost'])
    assert.match(planCentral({ ACTION: 'gsc-status', SITE_URL: bad }).problem ?? '', /not a production origin/, bad);
  assert.match(planCentral({ ACTION: 'gsc-status', SITE_URL: 'https://www.x.com', URLS: 'https://www.x.com/a' }).problem, /only for gsc-inspect/);
  assert.match(planCentral({ ACTION: 'gsc-inspect', SITE_URL: 'https://www.x.com', URLS: '--evil' }).problem, /not a full page URL/);
  assert.deepEqual(planCentral({ ACTION: 'gsc-inspect', SITE_URL: 'https://www.x.com', URLS: 'https://www.x.com/a, https://www.x.com/b' }).urls, ['https://www.x.com/a', 'https://www.x.com/b']);
});

test('missing secrets: named exactly; the run fails cleanly and writes the result', () => {
  assert.deepEqual(missingSecrets('gsc', { GOOGLE_OAUTH_CLIENT_ID: 'a', GOOGLE_OAUTH_CLIENT_SECRET: 'b' }), ['GOOGLE_TOKEN_JSON']);
  assert.deepEqual(missingSecrets('bing', {}), ['BING_WEBMASTER_API_KEY']);
  const dir = mkdtempSync(join(tmpdir(), 'search-ci-'));
  const secret = 'GOCSPX-thisMustNeverBePrinted123';
  const r = spawnSync(process.execPath, [join(STARTER, 'scripts', 'search-engines-ci.mjs')], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, SITE_URL: 'https://www.romexterra.com', ACTION: 'gsc-status', RESULT_DIR: dir, GOOGLE_OAUTH_CLIENT_ID: '1-a.apps.googleusercontent.com', GOOGLE_OAUTH_CLIENT_SECRET: secret },
  });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /✗ gsc status — GOOGLE_TOKEN_JSON not set .*npm run search:connect/);
  assert.ok(!r.stdout.includes(secret) && !r.stderr.includes(secret));
  assert.equal(JSON.parse(readFileSync(join(dir, 'exit.json'), 'utf8')).exit, 1);
  assert.match(readFileSync(join(dir, 'output.txt'), 'utf8'), /GOOGLE_TOKEN_JSON not set/);
  const b = spawnSync(process.execPath, [join(STARTER, 'scripts', 'search-engines-ci.mjs')], {
    encoding: 'utf8', env: { PATH: process.env.PATH, SITE_URL: 'https://www.romexterra.com', ACTION: 'bing-verify-prepare', RESULT_DIR: dir },
  });
  assert.equal(b.status, 1);
  assert.match(b.stdout, /BING_WEBMASTER_API_KEY not set/);
});

test('scrub removes secret values (and the refresh token) from result text', () => {
  assert.equal(scrub('token=1//abcdefg and GOCSPX-xyzxyz', ['1//abcdefg', 'GOCSPX-xyzxyz']), 'token=*** and ***');
});

test('BingSiteAuth.xml: our code is added, a client code is kept, no rewrite when present', () => {
  const client = '<?xml version="1.0"?>\n<users>\n\t<user>CLIENTCODE</user>\n</users>\n';
  const merged = mergeBingAuth(client, 'AGENCYCODE');
  assert.match(merged, /<user>CLIENTCODE<\/user>\n\t<user>AGENCYCODE<\/user>/);
  assert.equal(mergeBingAuth(merged, 'AGENCYCODE'), null);
  assert.equal(mergeBingAuth('', 'AGENCYCODE'), '<?xml version="1.0"?>\n<users>\n\t<user>AGENCYCODE</user>\n</users>\n');
});

test('evidence merge keeps earlier commands and drops the helper verify-prepare entry', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'search-ev-')), 'launch', 'search-console.json');
  saveEvidence(path, { site: 'https://www.x.com', account: 'a@x.com', status: { property: 'sc-domain:x.com' } });
  saveEvidence(path, { site: 'https://www.x.com', account: 'a@x.com', 'verify-prepare': { file: 'google1.html' }, submit: { errors: 0 } });
  const saved = JSON.parse(readFileSync(path, 'utf8'));
  assert.deepEqual(Object.keys(saved).sort(), ['account', 'site', 'status', 'submit']);
  saveEvidence(path, null);
  assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), saved, 'no result → file untouched');
});
