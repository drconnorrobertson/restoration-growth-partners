/**
 * The Vercel deploy hook the weekly blog publisher needs (CORE_CONTRACTS §25, §29), created and stored by code so
 * nobody — person or agent — ever sees its URL:
 *   1. read the Vercel project (agency scope) and the GitHub repo it is connected to;
 *   2. make sure "Automatically expose System Environment Variables" is on (autoExposeSystemEnvs — postbuild needs
 *      VERCEL_GIT_COMMIT_SHA for "Tell search engines", §28);
 *   3. find the hook named `publish-scheduled-posts` for the production branch, or create it (never a duplicate);
 *   4. store its URL as the client repo's GitHub Actions secret VERCEL_DEPLOY_HOOK_URL — only after it is proven to be
 *      a https://api.vercel.com/ URL, and only from a mode-600 file in a private temp dir (never argv, never a pipe
 *      from a call that may have failed, never printed). The temp dir is deleted in every case.
 * Idempotent: hook + secret already there → "already set", nothing changes. Hook there, secret missing → the
 * existing hook is stored. Every side effect goes through the injected `vercel` and `gh` runners, so the logic is
 * unit-tested with mocks (tests/hosting/vercel-hook.test.mjs). CLI: scripts/vercel-hook-setup.mjs.
 */
import { mkdtempSync, chmodSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const HOOK_NAME = 'publish-scheduled-posts';
export const SECRET_NAME = 'VERCEL_DEPLOY_HOOK_URL';
export const HOOK_URL_RE = /^https:\/\/api\.vercel\.com\/[A-Za-z0-9/_.~?=&%-]+$/;

/** True only for a non-empty https://api.vercel.com/ URL with no whitespace — the one shape a deploy hook has. */
export const isHookUrl = (u) => typeof u === 'string' && HOOK_URL_RE.test(u);

/** Hide anything that looks like a hook URL before a message is printed. */
export const redact = (s) => String(s ?? '').replace(/https:\/\/api\.vercel\.com\/\S*/g, '<hook URL hidden>');

const fail = (message, extra = {}) => Object.assign(new Error(message), extra);

/** `vercel api` prints errors as "Error: <message> (<status>)" on stderr. Returns the HTTP status or null. */
export function vercelStatus(stderr) {
  const m = String(stderr ?? '').match(/\((\d{3})\)\s*$/m);
  return m ? Number(m[1]) : null;
}

/** A plain message for a failed `vercel api` call. Never includes stdout (it can hold hook URLs). */
export function vercelFailure(stderr, what, { team, project } = {}) {
  const status = vercelStatus(stderr);
  const last = redact(String(stderr ?? '').trim().split('\n').filter(Boolean).pop() ?? '');
  if (status === 403 || (!status && /forbidden|not authori[sz]ed|permission/i.test(last)))
    return fail(`Vercel refused to ${what} (403): your Vercel role must be Member or Owner in the agency team ${team ?? ''} — Developer cannot create deploy hooks or change project settings. Ask a team Owner to change your role (Vercel → Team Settings → Members), then rerun.`, { status: 403 });
  if (status === 404) return fail(`Vercel could not find project "${project}" in scope ${team} (404) — check the name, or run npm run vercel:setup first.`, { status: 404 });
  return fail(`Vercel could not ${what}${status ? ` (HTTP ${status})` : ''}${last ? `: ${last}` : ''}`, { status });
}

/** Parse `vercel api /v9/projects/<p>` output. Throws on an empty or non-project response (never echoes it). */
export function parseProject(text) {
  const raw = String(text ?? '');
  if (!raw.trim()) throw fail('Vercel returned an empty response for the project — nothing was stored.');
  let p;
  try { p = JSON.parse(raw); } catch { throw fail(`Vercel returned something that is not JSON (${raw.length} bytes) — nothing was stored.`); }
  if (!p || typeof p !== 'object' || typeof p.id !== 'string' || !p.id) throw fail('Vercel returned JSON that is not a project (no id) — nothing was stored.');
  const link = p.link && typeof p.link === 'object' ? p.link : {};
  const hooks = Array.isArray(link.deployHooks) ? link.deployHooks.filter((h) => h && typeof h === 'object') : [];
  return {
    id: p.id, name: p.name, autoExposeSystemEnvs: p.autoExposeSystemEnvs === true,
    link: { type: link.type, org: link.org, repo: link.repo, productionBranch: link.productionBranch },
    hooks: hooks.map((h) => ({ id: h.id, name: h.name, ref: h.ref, url: h.url, createdAt: h.createdAt ?? 0 })),
  };
}

/** Every hook with this name and branch, oldest first. */
export const matchingHooks = (hooks, name = HOOK_NAME, ref = 'main') =>
  hooks.filter((h) => h.name === name && h.ref === ref).sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));

/** What has to happen, from what exists. */
export function plan({ hookExists, secretExists, restore = false }) {
  if (hookExists && secretExists && !restore) return 'already-set';
  if (hookExists) return 'store-existing';
  return 'create-and-store';
}

/**
 * Make sure the project exposes system env vars, has the publish hook, and the repo has the secret.
 *   project      Vercel project name or id      team         Vercel scope (hosting.json vercelTeam)
 *   githubOwner  the agency GitHub org          branch       production branch (hosting.json productionBranch)
 *   repo         optional "owner/name" the project must be connected to
 *   check        report only, change nothing (code 1 when something is missing)
 *   restore      store the existing hook's URL even if the secret exists (e.g. a secret stored empty by hand)
 *   vercel(args, outFile) → { status, stderr }   stdout goes ONLY to outFile
 *   gh(args, { stdinFile }) → { status, stdout, stderr }
 * Returns { code, action, repo, message }. Throws an Error with a plain message on any failure.
 */
export async function ensurePublishHook({
  project, team, githubOwner, branch = 'main', repo: expectRepo = null, check = false, restore = false,
  vercel, gh, log = console.log, tmpRoot = tmpdir(),
}) {
  if (!project) throw fail('no Vercel project given — run inside a linked client repo (npm run vercel:setup) or pass --project <name>.');
  const dir = mkdtempSync(join(tmpRoot, 'vercel-hook-'));
  chmodSync(dir, 0o700);
  let n = 0;
  const out = () => join(dir, `response-${++n}.json`);
  const api = (args, what) => {
    const file = out();
    const r = vercel(['api', ...args, '--scope', team, '--raw'], file);
    if (r.status !== 0) throw vercelFailure(r.stderr, what, { team, project });
    return existsSync(file) ? readFileSync(file, 'utf8') : '';
  };
  const getProject = () => parseProject(api([`/v9/projects/${encodeURIComponent(project)}`], `read project "${project}"`));
  try {
    let p = getProject();
    const { type, org, repo: repoName } = p.link;
    if (type !== 'github' || !org || !repoName)
      throw fail(`Vercel project "${p.name}" is not connected to a GitHub repo — run npm run vercel:setup (it connects git) first.`);
    if (String(org).toLowerCase() !== String(githubOwner).toLowerCase())
      throw fail(`Vercel project "${p.name}" is connected to ${org}/${repoName}, not a repo under ${githubOwner} — refusing to store a secret outside the agency organization.`);
    const repo = `${org}/${repoName}`;
    if (expectRepo && expectRepo.toLowerCase() !== repo.toLowerCase())
      throw fail(`Vercel project "${p.name}" is connected to ${repo}, not ${expectRepo} — check the project name.`);
    log(`· Vercel project ${p.name} → GitHub ${repo}`);
    const todo = [];

    // System environment variables (VERCEL_GIT_COMMIT_SHA etc.) — "Tell search engines" needs them (§28).
    if (p.autoExposeSystemEnvs) log('· "Automatically expose System Environment Variables" is on');
    else if (check) todo.push('"Automatically expose System Environment Variables" is OFF');
    else {
      const after = parseProject(api([`/v9/projects/${encodeURIComponent(p.id)}`, '-X', 'PATCH', '-F', 'autoExposeSystemEnvs=true'], 'turn on "Automatically expose System Environment Variables"'));
      if (!after.autoExposeSystemEnvs) throw fail('Vercel accepted the change but "Automatically expose System Environment Variables" is still off — turn it on by hand: Vercel → Project → Settings → Environment Variables.');
      log('· turned on "Automatically expose System Environment Variables" (takes effect from the next deployment)');
    }

    // The repo secret: exists or not (GitHub never shows its value).
    const secretExists = () => {
      const r = gh(['api', `repos/${repo}/actions/secrets/${SECRET_NAME}`]);
      if (r.status === 0) return true;
      if (/HTTP 404/.test(r.stderr ?? '')) return false;
      throw fail(`could not read the Actions secrets of ${repo} (${redact((r.stderr ?? '').trim().split('\n').pop() || `exit ${r.status}`)}) — your gh login needs admin access to the repo.`);
    };
    const hasSecret = secretExists();
    let hooks = matchingHooks(p.hooks, HOOK_NAME, branch);
    if (hooks.length > 1) log(`! ${hooks.length} deploy hooks named "${HOOK_NAME}" (${branch}) exist; using the oldest. Remove the extras by hand in Vercel → Settings → Git → Deploy Hooks.`);
    const action = plan({ hookExists: hooks.length > 0, secretExists: hasSecret, restore });

    if (action === 'already-set') {
      if (!isHookUrl(hooks[0].url)) throw fail(`the existing hook "${HOOK_NAME}" has no valid https://api.vercel.com/ URL in Vercel's response — check Vercel → Settings → Git → Deploy Hooks.`);
      const message = todo.length ? `deploy hook and secret already set; ${todo.join('; ')}` : `already set — deploy hook "${HOOK_NAME}" (${branch}) exists and ${repo} has the Actions secret ${SECRET_NAME}; nothing changed`;
      return { code: todo.length ? 1 : 0, action, repo, message };
    }
    if (check) {
      todo.push(action === 'store-existing' ? `${repo} has no Actions secret ${SECRET_NAME} (the hook exists)` : `no deploy hook "${HOOK_NAME}" (${branch}) and no secret ${SECRET_NAME}${hasSecret ? ' (a secret exists, but no hook it could point to)' : ''}`);
      return { code: 1, action, repo, message: `${todo.join('; ')} — run npm run vercel:hook to fix` };
    }

    if (action === 'create-and-store') {
      api([`/v1/projects/${encodeURIComponent(p.id)}/deploy-hooks`, '-X', 'POST', '-f', `name=${HOOK_NAME}`, '-f', `ref=${branch}`], `create the deploy hook "${HOOK_NAME}"`);
      p = getProject(); // read back from Vercel instead of trusting the POST body
      hooks = matchingHooks(p.hooks, HOOK_NAME, branch);
      if (!hooks.length) throw fail(`Vercel accepted the request but project "${p.name}" shows no hook "${HOOK_NAME}" (${branch}) — nothing was stored. Check Vercel → Settings → Git → Deploy Hooks.`);
      log(`· created deploy hook "${HOOK_NAME}" (branch ${branch})`);
    }
    const url = hooks[0].url;
    if (!isHookUrl(url)) throw fail(`the hook URL in Vercel's response is not a https://api.vercel.com/ URL — nothing was stored.`);

    const valueFile = join(dir, 'hook-url');
    writeFileSync(valueFile, url, { mode: 0o600, flag: 'wx' });
    const set = gh(['secret', 'set', SECRET_NAME, '--app', 'actions', '-R', repo], { stdinFile: valueFile });
    if (set.status !== 0) throw fail(`could not store the Actions secret ${SECRET_NAME} in ${repo} (${redact((set.stderr ?? '').trim().split('\n').pop() || `exit ${set.status}`)}) — your gh login needs admin access to the repo.`);
    if (!secretExists()) throw fail(`gh reported success but ${repo} still has no Actions secret ${SECRET_NAME}.`);
    const how = action === 'create-and-store' ? 'created the hook and stored' : `stored the existing hook${hasSecret ? ' again' : ''}`;
    return { code: todo.length ? 1 : 0, action, repo, message: `${how} as the Actions secret ${SECRET_NAME} in ${repo} — the URL was never printed` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
