#!/usr/bin/env node
/**
 * Stop before pushing or creating workflow files when the GitHub login lacks the "workflow" permission (§25).
 * Usage: npm run gh:workflow-check [-- --user <login>]    (default: the active gh account)
 * Exit 0 = the login can push workflow files (or its scopes cannot be read — warning printed); 1 = it cannot, with
 * the one command that fixes it. Called first by scripts/repo-setup.sh; run it yourself before pushing a change to
 * `.github/workflows/` in any client repo. Logic + tests: scripts/lib/gh-workflow-scope.mjs.
 */
import { spawnSync } from 'node:child_process';
import { readAuthStatus, checkWorkflowScope } from './lib/gh-workflow-scope.mjs';

const args = process.argv.slice(2);
const i = args.indexOf('--user');
const login = i >= 0 ? args[i + 1] : undefined;
if (i >= 0 && !login) { console.error('✗ --user needs a GitHub login'); process.exit(2); }

const run = (a) => {
  const r = spawnSync('gh', a, { encoding: 'utf8' });
  if (r.error) { console.error('✗ gh CLI required — install it, then run: gh auth login -h github.com -s workflow'); process.exit(1); }
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
};

const result = checkWorkflowScope(readAuthStatus(run), { login });
if (!result.ok) { console.error(`✗ ${result.message}`); process.exit(1); }
if (result.warning) console.log(`! ${result.warning}`);
else console.log(`· ${result.account} can add and change workflow files`);
