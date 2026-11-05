#!/usr/bin/env node
/**
 * vercel-hook-setup.mjs — `npm run vercel:hook` (also run by `npm run vercel:setup`). CORE_CONTRACTS §25, §29.
 * Gives the client's Vercel project the deploy hook the weekly blog publisher needs and stores it as the client
 * repo's GitHub Actions secret VERCEL_DEPLOY_HOOK_URL; turns on "Automatically expose System Environment Variables".
 * Nobody sees the hook URL: it goes from Vercel's response file (mode 600, private temp dir) straight into
 * `gh secret set` on stdin, after it is checked to be a https://api.vercel.com/ URL. Safe to rerun ("already set").
 *
 * Usage (from the client repo root):
 *   npm run vercel:hook                         the project in .vercel/project.json (made by vercel:setup)
 *   npm run vercel:hook -- --project <name|id>  any project in the agency scope (e.g. an older live site)
 *   npm run vercel:hook -- --check              report only; exit 1 when anything is missing
 *   npm run vercel:hook -- --restore            store the existing hook again (a secret saved wrong by hand)
 *   [--repo <owner/name>]                       fail unless the project is connected to this repo
 * Needs: `vercel login` as a Member or Owner of the agency team (Developer gets 403), and a `gh` login with admin
 * on the client repo (the shared company login from hosting.json when it is signed in on this machine).
 */
import { readFileSync, existsSync, openSync, closeSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { ensurePublishHook } from './lib/vercel-hook.mjs';

const argv = process.argv.slice(2);
const opt = (k) => { const i = argv.indexOf(k); return i > -1 ? argv[i + 1] : undefined; };
const hosting = JSON.parse(readFileSync('hosting.json', 'utf8'));
const linked = existsSync('.vercel/project.json') ? JSON.parse(readFileSync('.vercel/project.json', 'utf8')) : null;
const project = opt('--project') ?? linked?.projectId;

// gh acts as the shared company login when it is signed in here (as repo:setup does), else the active login.
// The token only ever travels in the child's environment.
const env = { ...process.env };
if (!env.GH_TOKEN) {
  const t = spawnSync('gh', ['auth', 'token', '--user', hosting.githubUser], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  if (t.status === 0 && t.stdout?.trim()) env.GH_TOKEN = t.stdout.trim();
}

const vercel = (args, outFile) => {
  const fd = openSync(outFile, 'w', 0o600);
  try {
    const r = spawnSync('vercel', args, { stdio: ['ignore', fd, 'pipe'], encoding: 'utf8', env: process.env });
    if (r.error) return { status: 1, stderr: `vercel CLI not found (npm i -g vercel): ${r.error.message}` };
    return { status: r.status, stderr: r.stderr };
  } finally { closeSync(fd); }
};
const gh = (args, { stdinFile } = {}) => {
  const fd = stdinFile ? openSync(stdinFile, 'r') : 'ignore';
  try {
    const r = spawnSync('gh', args, { stdio: [fd, 'pipe', 'pipe'], encoding: 'utf8', env });
    if (r.error) return { status: 1, stdout: '', stderr: `gh CLI not found: ${r.error.message}` };
    return r;
  } finally { if (typeof fd === 'number') closeSync(fd); }
};

try {
  const r = await ensurePublishHook({
    project, team: hosting.vercelTeam, githubOwner: hosting.githubOwner, branch: hosting.productionBranch,
    repo: opt('--repo') ?? null, check: argv.includes('--check'), restore: argv.includes('--restore'), vercel, gh,
  });
  console.log(`${r.code ? '✗' : '✓'} ${r.message}`);
  process.exit(r.code);
} catch (e) {
  console.error(`✗ deploy hook setup — ${e.message}`);
  console.error('  Manual fallback (only if this keeps failing): an Owner/Member creates the hook in Vercel → Project → Settings → Git → Deploy Hooks (name publish-scheduled-posts, branch main) and pastes it straight into GitHub → repo → Settings → Secrets and variables → Actions → VERCEL_DEPLOY_HOOK_URL — never into chat, a file or a commit.');
  process.exit(1);
}
