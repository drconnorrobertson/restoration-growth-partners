/**
 * The Vercel deploy hook → GitHub secret step of `npm run vercel:setup` (scripts/lib/vercel-hook.mjs, §25/§29) against
 * MOCKED `vercel api` and `gh` runners — no network, no Vercel, no GitHub. Proves: nothing is stored from an empty,
 * failed or malformed response; a 403 names the role problem; a missing hook is created once; an existing hook and
 * secret change nothing; the URL is never in argv or a log line; the temp dir is always removed.
 * Run: npm run test:hosting
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync, mkdtempSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensurePublishHook, parseProject, isHookUrl, vercelStatus, vercelFailure, matchingHooks, plan, redact, HOOK_NAME, SECRET_NAME } from '../../scripts/lib/vercel-hook.mjs';

const URL = 'https://api.vercel.com/v1/integrations/deploy/prj_abc123/Zx9Yw8Vu7T';
const NEW_URL = 'https://api.vercel.com/v1/integrations/deploy/prj_abc123/NewNewNew1';
const REPO = 'Restoration-Growth-Partners/client-a-website';
const project = ({ hooks = [], autoExpose = true, org = 'Restoration-Growth-Partners', repo = 'client-a-website', type = 'github' } = {}) => ({
  id: 'prj_abc123', name: 'client-a-website', autoExposeSystemEnvs: autoExpose,
  link: { type, org, repo, productionBranch: 'main', deployHooks: hooks },
});
const HOOK = { id: 'h1', name: HOOK_NAME, ref: 'main', url: URL, createdAt: 1 };

/** A mock world: Vercel project state + whether the repo secret exists; records every call. */
function world({ proj = project(), secret = false, respond = {} } = {}) {
  const s = { proj: structuredClone(proj), secret, secretValue: null, calls: [], stdinSeen: [], tmpRoot: mkdtempSync(join(tmpdir(), 'vh-test-')), lines: [] };
  s.vercel = (args, outFile) => {
    s.calls.push(['vercel', ...args]);
    const [, path] = args;
    const method = args.includes('-X') ? args[args.indexOf('-X') + 1] : 'GET';
    const key = `${method} ${path.split('?')[0].replace(/^\/v\d+/, '')}`;
    if (respond[key]) { const r = respond[key](s, args); if (r.stdout !== undefined) writeFileSync(outFile, r.stdout); return { status: r.status ?? 0, stderr: r.stderr ?? '' }; }
    if (method === 'GET' && /^\/v9\/projects\//.test(path)) { writeFileSync(outFile, JSON.stringify(s.proj)); return { status: 0, stderr: '' }; }
    if (method === 'PATCH') { s.proj.autoExposeSystemEnvs = true; writeFileSync(outFile, JSON.stringify(s.proj)); return { status: 0, stderr: '' }; }
    if (method === 'POST' && /deploy-hooks$/.test(path)) {
      const f = (k) => args.find((a) => a.startsWith(`${k}=`)).slice(k.length + 1);
      s.proj.link.deployHooks.push({ id: 'h2', name: f('name'), ref: f('ref'), url: NEW_URL, createdAt: 2 });
      writeFileSync(outFile, JSON.stringify(s.proj)); return { status: 0, stderr: '' };
    }
    return { status: 1, stderr: `Error: unexpected ${key} (500)` };
  };
  s.gh = (args, { stdinFile } = {}) => {
    s.calls.push(['gh', ...args]);
    if (args[0] === 'api') return s.secret ? { status: 0, stdout: `{"name":"${SECRET_NAME}"}`, stderr: '' } : { status: 1, stdout: '', stderr: 'gh: Not Found (HTTP 404)' };
    if (args[0] === 'secret' && args[1] === 'set') {
      const st = statSync(stdinFile);
      s.stdinSeen.push({ mode: st.mode & 0o777, dirMode: statSync(join(stdinFile, '..')).mode & 0o777 });
      s.secretValue = readFileSync(stdinFile, 'utf8'); s.secret = true;
      return { status: 0, stdout: '', stderr: '' };
    }
    return { status: 1, stdout: '', stderr: 'unexpected' };
  };
  s.go = (over = {}) => ensurePublishHook({ project: 'client-a-website', team: 'restoration-growth-partners', githubOwner: 'Restoration-Growth-Partners', branch: 'main', vercel: s.vercel, gh: s.gh, log: (l) => s.lines.push(l), tmpRoot: s.tmpRoot, ...over });
  s.posts = () => s.calls.filter((c) => c[0] === 'vercel' && c.includes('POST'));
  s.sets = () => s.calls.filter((c) => c[0] === 'gh' && c[1] === 'secret');
  s.assertClean = () => {
    assert.deepEqual(readdirSync(s.tmpRoot), [], 'temp dir removed');
    for (const c of s.calls) for (const a of c) assert.ok(!String(a).includes('api.vercel.com/v1/integrations'), `hook URL never in argv: ${c.join(' ')}`);
    for (const l of s.lines) assert.ok(!l.includes('integrations/deploy'), `hook URL never logged: ${l}`);
  };
  return s;
}

// ---------------------------------------------------------------- pure helpers
test('isHookUrl: only a https://api.vercel.com/ URL without whitespace', () => {
  assert.ok(isHookUrl(URL));
  for (const bad of ['', undefined, null, 'null', 'http://api.vercel.com/x', 'https://evil.example/api.vercel.com/', 'https://api.vercel.com/', `${URL}\n`, `${URL} x`, '{"error":{"code":"forbidden"}}'])
    assert.equal(isHookUrl(bad), false, String(bad));
});

test('parseProject: empty, non-JSON and non-project responses throw without echoing the body', () => {
  assert.throws(() => parseProject(''), /empty response/);
  assert.throws(() => parseProject('  \n'), /empty response/);
  assert.throws(() => parseProject(`Error: ${URL}`), (e) => /not JSON/.test(e.message) && !e.message.includes(URL));
  assert.throws(() => parseProject('{"error":{"code":"forbidden"}}'), /not a project/);
  const p = parseProject(JSON.stringify(project({ hooks: [HOOK], autoExpose: false })));
  assert.equal(p.autoExposeSystemEnvs, false);
  assert.deepEqual(p.hooks.map((h) => h.name), [HOOK_NAME]);
  assert.deepEqual(parseProject(JSON.stringify({ id: 'p' })).hooks, [], 'no link → no hooks');
});

test('vercel errors: 403 names the role, 404 the project; stderr hook URLs are hidden', () => {
  assert.equal(vercelStatus('Error: Project not found. (404)'), 404);
  assert.match(vercelFailure('Error: You do not have permission to access this resource. (403)', 'create the deploy hook', { team: 'restoration-growth-partners' }).message, /role must be Member or Owner in the agency team restoration-growth-partners/);
  assert.match(vercelFailure('Error: Project not found. (404)', 'read', { team: 't', project: 'x' }).message, /could not find project "x"/);
  assert.ok(!vercelFailure(`Error: bad ${URL} (500)`, 'x').message.includes(URL));
  assert.equal(redact(`a ${URL} b`), 'a <hook URL hidden> b');
});

test('plan + matchingHooks: name AND branch must match; oldest first', () => {
  const hooks = [{ ...HOOK, createdAt: 5, id: 'late' }, { ...HOOK, ref: 'dev', id: 'dev' }, { ...HOOK, name: 'other', id: 'o' }, { ...HOOK, createdAt: 1, id: 'early' }];
  assert.deepEqual(matchingHooks(hooks, HOOK_NAME, 'main').map((h) => h.id), ['early', 'late']);
  assert.equal(plan({ hookExists: true, secretExists: true }), 'already-set');
  assert.equal(plan({ hookExists: true, secretExists: true, restore: true }), 'store-existing');
  assert.equal(plan({ hookExists: true, secretExists: false }), 'store-existing');
  assert.equal(plan({ hookExists: false, secretExists: true }), 'create-and-store');
});

// ---------------------------------------------------------------- the whole step, mocked
test('existing hook + existing secret → "already set", no POST, no PATCH, no secret write', async () => {
  const s = world({ proj: project({ hooks: [HOOK] }), secret: true });
  const r = await s.go();
  assert.equal(r.code, 0);
  assert.equal(r.action, 'already-set');
  assert.match(r.message, /already set/);
  assert.equal(r.repo, REPO);
  assert.equal(s.posts().length, 0);
  assert.ok(!s.calls.some((c) => c.includes('PATCH')));
  assert.equal(s.sets().length, 0);
  s.assertClean();
});

test('missing hook → created once, read back, stored from a mode-600 file in a mode-700 dir', async () => {
  const s = world();
  const r = await s.go();
  assert.equal(r.code, 0, r.message);
  assert.equal(r.action, 'create-and-store');
  assert.equal(s.posts().length, 1);
  assert.ok(s.posts()[0].includes(`name=${HOOK_NAME}`) && s.posts()[0].includes('ref=main'));
  assert.equal(s.secretValue, NEW_URL, 'exactly the URL, no newline');
  assert.deepEqual(s.stdinSeen, [{ mode: 0o600, dirMode: 0o700 }]);
  assert.deepEqual(s.sets()[0].slice(1), ['secret', 'set', SECRET_NAME, '--app', 'actions', '-R', REPO]);
  s.assertClean();
  const again = await s.go(); // rerun: idempotent, no duplicate hook
  assert.equal(again.action, 'already-set');
  assert.equal(s.posts().length, 1);
  assert.equal(s.proj.link.deployHooks.length, 1);
});

test('existing hook, missing secret → stores the EXISTING hook, never creates a second one', async () => {
  const s = world({ proj: project({ hooks: [HOOK] }) });
  const r = await s.go();
  assert.equal(r.action, 'store-existing');
  assert.equal(s.posts().length, 0);
  assert.equal(s.secretValue, URL);
  s.assertClean();
});

test('a hook for another branch does not count; --restore re-stores an existing hook', async () => {
  const s = world({ proj: project({ hooks: [{ ...HOOK, ref: 'staging' }] }), secret: true });
  assert.equal((await s.go()).action, 'create-and-store');
  const t = world({ proj: project({ hooks: [HOOK] }), secret: true });
  const r = await t.go({ restore: true });
  assert.equal(r.action, 'store-existing');
  assert.equal(t.secretValue, URL);
  assert.equal(t.posts().length, 0);
});

test('empty Vercel response → fails, nothing stored (the bug that stored an EMPTY secret)', async () => {
  const s = world({ respond: { 'GET /projects/client-a-website': () => ({ status: 0, stdout: '' }) } });
  await assert.rejects(s.go(), /empty response/);
  assert.equal(s.sets().length, 0);
  s.assertClean();
});

test('403 creating the hook → role message, nothing stored', async () => {
  const s = world({ respond: { 'POST /projects/prj_abc123/deploy-hooks': () => ({ status: 1, stdout: '', stderr: 'Error: You don\'t have permission to create a deploy hook. (403)' }) } });
  await assert.rejects(s.go(), /role must be Member or Owner/);
  assert.equal(s.sets().length, 0);
  s.assertClean();
});

test('POST "succeeds" but the hook is not there, or its URL is malformed → fails, nothing stored', async () => {
  const s = world({ respond: { 'POST /projects/prj_abc123/deploy-hooks': () => ({ status: 0, stdout: '' }) } });
  await assert.rejects(s.go(), /shows no hook/);
  assert.equal(s.sets().length, 0);
  const t = world({ proj: project({ hooks: [{ ...HOOK, url: '' }] }) });
  await assert.rejects(t.go(), /not a https:\/\/api\.vercel\.com\/ URL/);
  assert.equal(t.sets().length, 0);
  s.assertClean(); t.assertClean();
});

test('autoExposeSystemEnvs off → turned on; --check only reports (exit 1) and changes nothing', async () => {
  const s = world({ proj: project({ hooks: [HOOK], autoExpose: false }), secret: true });
  const r = await s.go();
  assert.equal(r.code, 0);
  assert.equal(s.proj.autoExposeSystemEnvs, true);
  assert.ok(s.lines.some((l) => /turned on "Automatically expose System Environment Variables"/.test(l)));
  const c = world({ proj: project({ autoExpose: false }) });
  const rc = await c.go({ check: true });
  assert.equal(rc.code, 1);
  assert.match(rc.message, /Automatically expose System Environment Variables" is OFF; no deploy hook/);
  assert.ok(!c.calls.some((x) => x.includes('PATCH') || x.includes('POST')));
  assert.equal(c.sets().length, 0);
  c.assertClean();
});

test('refuses a project that is not git-connected, under another org, or connected to a different repo', async () => {
  await assert.rejects(world({ proj: project({ type: null }) }).go(), /not connected to a GitHub repo/);
  await assert.rejects(world({ proj: project({ org: 'someone-else' }) }).go(), /refusing to store a secret outside the agency organization/);
  await assert.rejects(world().go({ repo: 'Restoration-Growth-Partners/other-website' }), /not Restoration-Growth-Partners\/other-website/);
});

test('gh cannot read or write secrets → plain admin-access message, URL never leaks', async () => {
  const s = world({ proj: project({ hooks: [HOOK] }) });
  const realGh = s.gh;
  s.gh = (args, o) => (args[0] === 'secret' ? { status: 1, stdout: '', stderr: `HTTP 403: Resource not accessible ${URL}` } : realGh(args, o));
  await assert.rejects(s.go({ gh: s.gh }), (e) => /needs admin access/.test(e.message) && !e.message.includes(URL));
  s.assertClean();
});
