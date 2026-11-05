/**
 * GitHub "workflow" permission check (CORE_CONTRACTS §25). GitHub rejects any push that adds or changes a file under
 * `.github/workflows/` when the pushing `gh` login's token lacks the `workflow` OAuth scope — and it says so only
 * AFTER the repo was created and the push started (a teammate hit this 2026-10-28). Every script that pushes or
 * creates workflow files calls this FIRST and stops before doing anything if the scope is missing.
 *
 * Pure parsing of `gh auth status` (JSON from `--json hosts`, or the text output of older gh versions) plus one
 * decision function; the only side effect is the injected `run` in readAuthStatus, so it is unit-tested with fixtures
 * (tests/hosting/gh-workflow-scope.test.mjs). CLI: scripts/check-gh-workflow-scope.mjs (npm run gh:workflow-check).
 */
export const HOST = 'github.com';
export const SCOPE = 'workflow';
export const FIX_COMMAND = `gh auth refresh -h ${HOST} -s ${SCOPE}`;
export const MISSING_MESSAGE = `Your GitHub login can't add or change workflow files. Run: ${FIX_COMMAND} (approve in the browser), then re-run.`;

const ENV_SOURCES = new Set(['GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN']);

/** "'gist', 'read:org', 'repo'" or "gist, read:org, repo" → ['gist','read:org','repo']; '' → []; missing → null (unknown). */
export function splitScopes(raw) {
  if (raw === undefined || raw === null) return null;
  return String(raw).split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '').trim()).filter(Boolean);
}

/** `gh auth status --json hosts` output → [{ login, active, scopes|null, tokenSource, ok }] for one host. */
export function parseAuthStatusJson(text, host = HOST) {
  const data = JSON.parse(text);
  const entries = data?.hosts?.[host];
  if (!Array.isArray(entries)) return [];
  return entries.map((e) => ({
    login: e.login ?? null,
    active: e.active === true,
    scopes: 'scopes' in e ? splitScopes(e.scopes) : null,
    tokenSource: e.tokenSource ?? null,
    ok: e.state === undefined ? true : e.state === 'success',
  }));
}

/**
 * Text `gh auth status` output (gh before `--json`) → the same shape. Account blocks start with
 * "✓ Logged in to github.com account NAME (source)" — older gh: "Logged in to github.com as NAME (source)" — or
 * "X Failed to log in to github.com account NAME (source)"; "- Active account: true|false" and
 * "- Token scopes: 'a', 'b'" follow. A version without "Active account" lines has one account, which is active.
 */
export function parseAuthStatusText(text, host = HOST) {
  const accounts = [];
  let inHost = false;
  let cur = null;
  const hostRe = new RegExp(`^\\s*${host.replace(/\./g, '\\.')}\\s*:?\\s*$`);
  const loginRe = new RegExp(`(Logged in|Failed to log in) to ${host.replace(/\./g, '\\.')} (?:account|as) (\\S+)(?: \\(([^)]+)\\))?`);
  for (const line of String(text).split(/\r?\n/)) {
    if (hostRe.test(line)) { inHost = true; continue; }
    if (/^\S/.test(line) && line.trim() && !loginRe.test(line)) { inHost = false; cur = null; continue; }
    const m = line.match(loginRe);
    if (m) {
      const source = m[3] ? m[3].replace(/^.*?(GH_TOKEN|GITHUB_TOKEN|keyring|oauth_token).*$/, '$1') : null;
      cur = { login: m[2], active: null, scopes: null, tokenSource: source, ok: m[1] === 'Logged in' };
      accounts.push(cur);
      inHost = true;
      continue;
    }
    if (!inHost || !cur) continue;
    const active = line.match(/Active account:\s*(true|false)/i);
    if (active) cur.active = active[1].toLowerCase() === 'true';
    const scopes = line.match(/Token scopes:\s*(.*)$/i);
    if (scopes) cur.scopes = /^none$/i.test(scopes[1].trim()) ? [] : splitScopes(scopes[1]);
  }
  if (accounts.length === 1 && accounts[0].active === null) accounts[0].active = true;
  for (const a of accounts) if (a.active === null) a.active = false;
  return accounts;
}

/** Pick the account that will push: `login` when given (a keyring entry over an env-token entry), else the active one. */
export function pickAccount(accounts, login) {
  if (login) {
    const same = accounts.filter((a) => a.login && a.login.toLowerCase() === String(login).toLowerCase());
    return same.find((a) => !ENV_SOURCES.has(a.tokenSource)) ?? same[0] ?? null;
  }
  return accounts.find((a) => a.active) ?? null;
}

/**
 * The decision. Returns { ok: true } when the account's token has `workflow`;
 * { ok: true, warning } when the token's scopes cannot be read (fine-grained / app tokens have none to list);
 * { ok: false, message } otherwise — the message is the exact fix a person (or their Claude) runs.
 */
export function checkWorkflowScope(accounts, { login } = {}) {
  const acct = pickAccount(accounts, login);
  if (!acct) {
    return { ok: false, message: login
      ? `gh is not signed in to ${HOST} as ${login} on this computer. Run: gh auth login -h ${HOST} -s ${SCOPE} (approve in the browser), then re-run.`
      : `gh is not signed in to ${HOST}. Run: gh auth login -h ${HOST} -s ${SCOPE} (approve in the browser), then re-run.` };
  }
  if (!acct.ok) {
    return { ok: false, account: acct.login, message: `The GitHub login ${acct.login} on this computer is no longer valid. Run: gh auth login -h ${HOST} -s ${SCOPE} (approve in the browser), then re-run.` };
  }
  if (acct.scopes === null) {
    return { ok: true, account: acct.login, warning: `could not read the scopes of ${acct.login}'s GitHub token (a fine-grained or app token lists none) — if a push of a workflow file is rejected, it needs "Workflows: read and write".` };
  }
  if (acct.scopes.includes(SCOPE)) return { ok: true, account: acct.login };
  if (ENV_SOURCES.has(acct.tokenSource)) {
    return { ok: false, account: acct.login, message: `${MISSING_MESSAGE} (The token in ${acct.tokenSource} is being used and has no "workflow" scope — unset ${acct.tokenSource} or replace it with a token that has it.)` };
  }
  if (!acct.active) {
    return { ok: false, account: acct.login, message: `Your GitHub login ${acct.login} can't add or change workflow files. Run: gh auth switch -h ${HOST} -u ${acct.login}, then ${FIX_COMMAND} (approve in the browser), then switch back with gh auth switch, then re-run.` };
  }
  return { ok: false, account: acct.login, message: MISSING_MESSAGE };
}

/**
 * Read `gh auth status` through the injected runner `run(args) → { status, stdout, stderr }` (never throws).
 * JSON first; gh versions without `--json` fall back to the text output (printed on stdout or stderr, exit 1 when
 * any account has a problem — still parseable).
 */
export function readAuthStatus(run) {
  const j = run(['auth', 'status', '--hostname', HOST, '--json', 'hosts']);
  if (j.status === 0 && j.stdout.trim().startsWith('{')) {
    try { return parseAuthStatusJson(j.stdout); } catch { /* fall through to text */ }
  }
  const t = run(['auth', 'status', '--hostname', HOST]);
  return parseAuthStatusText(`${t.stdout}\n${t.stderr}`);
}
