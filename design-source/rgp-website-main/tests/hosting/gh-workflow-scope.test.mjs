/**
 * The GitHub "workflow" permission check (scripts/lib/gh-workflow-scope.mjs, CORE_CONTRACTS §25) against fixture
 * `gh auth status` output — JSON (`--json hosts`) and the text of current and older gh versions. No gh, no network.
 * Proves: a login without `workflow` is stopped with the exact fix command; the pushing account (not just the
 * active one) is the one checked; unknown scopes warn instead of blocking; env tokens and invalid logins are named.
 * Run: npm run test:hosting
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitScopes, parseAuthStatusJson, parseAuthStatusText, checkWorkflowScope, readAuthStatus, MISSING_MESSAGE, FIX_COMMAND } from '../../scripts/lib/gh-workflow-scope.mjs';

const JSON_TWO = JSON.stringify({ hosts: { 'github.com': [
  { state: 'success', active: true, host: 'github.com', login: 'Teammate', tokenSource: 'keyring', scopes: 'gist, read:org, repo', gitProtocol: 'https' },
  { state: 'success', active: false, host: 'github.com', login: 'RGP623', tokenSource: 'keyring', scopes: 'gist, read:org, repo, workflow', gitProtocol: 'https' },
] } });

const TEXT_CURRENT = `github.com
  ✓ Logged in to github.com account RGP623 (keyring)
  - Active account: true
  - Git operations protocol: https
  - Token: gho_************************************
  - Token scopes: 'gist', 'read:org', 'repo', 'workflow'

  ✓ Logged in to github.com account Teammate (keyring)
  - Active account: false
  - Git operations protocol: https
  - Token: gho_************************************
  - Token scopes: 'gist', 'read:org', 'repo'
`;

const TEXT_OLD = `github.com
  ✓ Logged in to github.com as Teammate (/Users/t/.config/gh/hosts.yml)
  ✓ Git operations for github.com configured to use https protocol.
  ✓ Token: gho_************************************
  ✓ Token scopes: gist, read:org, repo
`;

test('splitScopes reads quoted and unquoted lists; missing is unknown, empty is none', () => {
  assert.deepEqual(splitScopes("'gist', 'read:org', 'repo', 'workflow'"), ['gist', 'read:org', 'repo', 'workflow']);
  assert.deepEqual(splitScopes('gist, read:org, repo'), ['gist', 'read:org', 'repo']);
  assert.deepEqual(splitScopes(''), []);
  assert.equal(splitScopes(undefined), null);
  // "workflow" must be a whole scope, not a substring of another one
  assert.equal(splitScopes("'read:workflow-runs'").includes('workflow'), false);
});

test('JSON: every account with its own scopes and active flag', () => {
  const a = parseAuthStatusJson(JSON_TWO);
  assert.equal(a.length, 2);
  assert.deepEqual(a.map((x) => [x.login, x.active, x.scopes.includes('workflow')]), [['Teammate', true, false], ['RGP623', false, true]]);
});

test('text (current gh): two accounts, scopes attached to the right one', () => {
  const a = parseAuthStatusText(TEXT_CURRENT);
  assert.deepEqual(a.map((x) => [x.login, x.active, x.tokenSource, x.scopes]), [
    ['RGP623', true, 'keyring', ['gist', 'read:org', 'repo', 'workflow']],
    ['Teammate', false, 'keyring', ['gist', 'read:org', 'repo']],
  ]);
});

test('text (older gh, one account, no "Active account" line): that account is active', () => {
  const a = parseAuthStatusText(TEXT_OLD);
  assert.equal(a.length, 1);
  assert.equal(a[0].login, 'Teammate');
  assert.equal(a[0].active, true);
  assert.deepEqual(a[0].scopes, ['gist', 'read:org', 'repo']);
});

test('active login WITHOUT workflow → blocked with the exact owner-approved message', () => {
  const r = checkWorkflowScope(parseAuthStatusJson(JSON_TWO));
  assert.equal(r.ok, false);
  assert.equal(r.message, MISSING_MESSAGE);
  assert.equal(MISSING_MESSAGE, "Your GitHub login can't add or change workflow files. Run: gh auth refresh -h github.com -s workflow (approve in the browser), then re-run.");
});

test('active login WITH workflow → ok', () => {
  const r = checkWorkflowScope(parseAuthStatusText(TEXT_CURRENT));
  assert.deepEqual(r, { ok: true, account: 'RGP623' });
});

test('the PUSHING account is checked, not just the active one', () => {
  // repo:setup pushes as the shared login when it is signed in, even if another account is active
  assert.equal(checkWorkflowScope(parseAuthStatusJson(JSON_TWO), { login: 'RGP623' }).ok, true);
  assert.equal(checkWorkflowScope(parseAuthStatusJson(JSON_TWO), { login: 'rgp623' }).ok, true, 'logins are case-insensitive');
  const r = checkWorkflowScope(parseAuthStatusText(TEXT_CURRENT), { login: 'Teammate' });
  assert.equal(r.ok, false);
  assert.match(r.message, /gh auth switch -h github\.com -u Teammate/, 'an inactive account must be switched to before refresh works');
  assert.ok(r.message.includes(FIX_COMMAND));
});

test('not signed in / unknown login / invalid token → blocked, never "ok"', () => {
  assert.equal(checkWorkflowScope([]).ok, false);
  assert.match(checkWorkflowScope([]).message, /gh auth login -h github\.com -s workflow/);
  assert.equal(checkWorkflowScope(parseAuthStatusJson(JSON_TWO), { login: 'Nobody' }).ok, false);
  const bad = parseAuthStatusText('github.com\n  X Failed to log in to github.com account Teammate (keyring)\n  - Active account: true\n');
  const r = checkWorkflowScope(bad);
  assert.equal(r.ok, false);
  assert.match(r.message, /no longer valid/);
});

test('token from GH_TOKEN without workflow → blocked and names the env variable', () => {
  const env = parseAuthStatusJson(JSON.stringify({ hosts: { 'github.com': [
    { state: 'success', active: true, login: 'Teammate', tokenSource: 'GH_TOKEN', scopes: 'repo' }] } }));
  const r = checkWorkflowScope(env);
  assert.equal(r.ok, false);
  assert.match(r.message, /GH_TOKEN/);
  const txt = parseAuthStatusText("github.com\n  ✓ Logged in to github.com account Teammate (GH_TOKEN)\n  - Active account: true\n  - Token scopes: 'repo'\n");
  assert.equal(txt[0].tokenSource, 'GH_TOKEN');
  assert.equal(checkWorkflowScope(txt).ok, false);
});

test('a token whose scopes cannot be read (fine-grained) warns but does not block', () => {
  const fg = parseAuthStatusJson(JSON.stringify({ hosts: { 'github.com': [{ state: 'success', active: true, login: 'Teammate', tokenSource: 'GH_TOKEN' }] } }));
  const r = checkWorkflowScope(fg);
  assert.equal(r.ok, true);
  assert.match(r.warning, /Workflows: read and write/);
});

test('readAuthStatus uses JSON when gh supports it, the text output when it does not', () => {
  const calls = [];
  const modern = (a) => { calls.push(a.join(' ')); return { status: 0, stdout: JSON_TWO, stderr: '' }; };
  assert.equal(readAuthStatus(modern)[0].login, 'Teammate');
  assert.equal(calls.length, 1);
  assert.match(calls[0], /--json hosts/);
  // older gh: unknown flag → exit 1; text on stderr with exit 1 is still read
  const old = (a) => a.includes('--json')
    ? { status: 1, stdout: '', stderr: 'unknown flag: --json' }
    : { status: 1, stdout: '', stderr: TEXT_OLD };
  const accts = readAuthStatus(old);
  assert.equal(accts[0].login, 'Teammate');
  assert.equal(checkWorkflowScope(accts).message, MISSING_MESSAGE);
});
