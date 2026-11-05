/**
 * search-remote.mjs — `npm run gsc` / `npm run bing` in a client repo (CORE_CONTRACTS §28; owner decision
 * 2026-10-21: the agency Search Console and Bing keys are GitHub organization secrets, nobody holds them).
 *
 * Same commands and output as before, but the API work runs in the workflow "Search engines"
 * (.github/workflows/search-engines.yml in agent-website-builder), the same pattern as leadrouter:setup:
 *   gh workflow run (with a unique run_label) → find the run → gh run watch → print its output →
 *   download its `result` artifact → write artifacts/launch/<evidence>.json here.
 * `verify` is two runs: verify-prepare returns the verification file (public by design), which is written into
 * public/ here (a client's own Bing code is kept); once it is live on the site, the verify run confirms it.
 * Needs only the `gh` login with write access to agent-website-builder (GitHub team website-team).
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';

export const SYSTEM_REPO = process.env.SEARCH_ENGINES_REPO || 'Restoration-Growth-Partners/agent-website-builder';
export const WORKFLOW = 'search-engines.yml';
export const COMMANDS = { gsc: ['status', 'verify', 'submit', 'inspect'], bing: ['status', 'verify', 'submit'] };
export const EVIDENCE_FILE = { gsc: 'search-console.json', bing: 'bing-webmaster.json' };
export const MAX_INSPECT_URLS = 20;

/** Command-line → what the central workflow is asked to do. Throws with a plain message on bad input. */
export function planRemote(tool, argv) {
  const cmds = COMMANDS[tool];
  if (!cmds) throw new Error(`unknown tool "${tool}"`);
  const [cmd = 'status', ...rest] = argv;
  if (!cmds.includes(cmd)) throw new Error(`unknown command "${cmd}" — use one of: ${cmds.join(', ')}`);
  const flags = rest.filter((a) => a.startsWith('--'));
  const urls = rest.filter((a) => !a.startsWith('--'));
  const allowed = tool === 'gsc' && cmd === 'submit' ? ['--check'] : [];
  const bad = flags.find((f) => !allowed.includes(f));
  if (bad) throw new Error(`unknown option ${bad}${allowed.length ? ` (only ${allowed.join(', ')})` : ''}`);
  if (urls.length && !(tool === 'gsc' && cmd === 'inspect')) throw new Error(`${cmd} takes no URLs`);
  if (urls.length > MAX_INSPECT_URLS) throw new Error(`at most ${MAX_INSPECT_URLS} URLs per inspect`);
  for (const u of urls) {
    let parsed = null;
    try { parsed = new URL(u); } catch { /* reported below */ }
    if (!parsed || !/^https?:$/.test(parsed.protocol) || /[\s,]/.test(u)) throw new Error(`"${u}" is not a full page URL (https://…)`);
  }
  return { cmd, action: `${tool}-${cmd}${flags.includes('--check') ? '-check' : ''}`, urls };
}

/** public/BingSiteAuth.xml with `code` added (other users' codes kept), or null when it already lists it. */
export function mergeBingAuth(existingXml, code) {
  const existing = [...String(existingXml ?? '').matchAll(/<user>([^<]+)<\/user>/g)].map((m) => m[1].trim());
  if (existing.includes(code)) return null;
  const users = [...existing, code].map((u) => `\t<user>${u}</user>`).join('\n');
  return `<?xml version="1.0"?>\n<users>\n${users}\n</users>\n`;
}

/** Merge a run's evidence into the local file (the helper-only verify-prepare entry is dropped). */
export function saveEvidence(path, remote) {
  if (!remote) return;
  const { 'verify-prepare': _prepare, ...rest } = remote;
  mkdirSync(join(path, '..'), { recursive: true });
  const prev = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {};
  writeFileSync(path, JSON.stringify({ ...prev, ...rest }, null, 2));
}

const gh = (args) => spawnSync('gh', args, { encoding: 'utf8' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** One run of the central workflow. Returns { exit, evidence, url }; prints the run's own output. */
export async function runCentral({ tool, action, origin, urls = [], fail }) {
  const runLabel = `${action}-${randomBytes(5).toString('hex')}`;
  const started = gh(['workflow', 'run', WORKFLOW, '-R', SYSTEM_REPO, '-f', `site_url=${origin}`, '-f', `action=${action}`,
    '-f', `urls=${urls.join(' ')}`, '-f', `run_label=${runLabel}`]);
  if (started.status !== 0) fail(`could not start the "Search engines" workflow: ${started.stderr.trim()} — you need write access to ${SYSTEM_REPO} (GitHub team website-team)`);
  let run;
  for (let i = 0; i < 30 && !run; i++) {
    await sleep(3000);
    const list = JSON.parse(gh(['run', 'list', '-R', SYSTEM_REPO, '--workflow', WORKFLOW, '--limit', '20', '--json', 'databaseId,displayTitle,url']).stdout || '[]');
    run = list.find((x) => x.displayTitle.includes(runLabel));
  }
  if (!run) fail(`the "Search engines" run did not start — look at https://github.com/${SYSTEM_REPO}/actions/workflows/${WORKFLOW}`);
  console.log(`  · ${action} running on GitHub (keys stay there): ${run.url}`);
  const watched = spawnSync('gh', ['run', 'watch', String(run.databaseId), '-R', SYSTEM_REPO, '--exit-status', '--interval', '5'], { encoding: 'utf8' });
  const dir = mkdtempSync(join(tmpdir(), 'search-engines-'));
  try {
    gh(['run', 'download', String(run.databaseId), '-R', SYSTEM_REPO, '-n', 'result', '-D', dir]);
    const read = (f) => (existsSync(join(dir, f)) ? readFileSync(join(dir, f), 'utf8') : null);
    const output = read('output.txt');
    if (output) process.stdout.write(output.endsWith('\n') ? output : `${output}\n`);
    else console.error(`  ✗ the run left no output — open ${run.url}`);
    const exitInfo = read('exit.json') ? JSON.parse(read('exit.json')) : null;
    const evidence = read(EVIDENCE_FILE[tool]) ? JSON.parse(read(EVIDENCE_FILE[tool])) : null;
    return { exit: Number.isInteger(exitInfo?.exit) ? exitInfo.exit : (watched.status === 0 ? 0 : 1), evidence, url: run.url };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The client-repo side of `npm run gsc` / `npm run bing`. Never returns (exits with the run's exit code). */
export async function runRemote(tool, argv) {
  let name = `${tool} ${argv[0] ?? 'status'}`;
  const fail = (msg, code = 1) => { console.error(`✗ ${name} — ${msg}`); process.exit(code); };
  let plan;
  try { plan = planRemote(tool, argv); } catch (e) { fail(e.message); }
  name = `${tool} ${plan.cmd}`;
  if (process.env.GITHUB_ACTIONS) {
    fail(tool === 'gsc'
      ? 'no Google keys in this workflow — the organization secrets GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET and GOOGLE_TOKEN_JSON are not available to this repo (owner: `npm run search:connect`)'
      : 'BING_WEBMASTER_API_KEY is not set in this workflow');
  }
  const { site } = await import(pathToFileURL(resolve('src/data/site.ts')).href);
  const origin = String(site.siteUrl ?? '').replace(/\/$/, '');
  if (!/^https?:\/\/[^/]+$/.test(origin) || /example\.com$/.test(new URL(origin).hostname)) fail(`site.siteUrl is "${site.siteUrl}" — set the client's production URL first`);
  if (plan.cmd === 'submit' && site.previewMode) {
    fail(`site.previewMode is true — a noindexed site is not submitted. Launch first${tool === 'gsc' ? ' (previewMode false, validate:launch, deploy)' : ''}.`);
  }
  if (gh(['auth', 'status']).status !== 0) fail('not logged in to GitHub — run: gh auth login (with your agency GitHub account)');

  const evidencePath = join('artifacts', 'launch', EVIDENCE_FILE[tool]);
  const run = (action) => runCentral({ tool, action, origin, urls: plan.urls, fail });
  const finish = (r) => { saveEvidence(evidencePath, r.evidence); process.exit(r.exit); };
  if (plan.cmd !== 'verify') finish(await run(plan.action));

  // verify: 1. what the site must publish → public/ here   2. live? → the verify run
  const prep = await run(`${tool}-verify-prepare`);
  if (prep.exit !== 0) finish(prep);
  const p = prep.evidence?.['verify-prepare'] ?? {};
  const local = (data) => saveEvidence(evidencePath, { ...prep.evidence, verify: { ...data, at: new Date().toISOString() } });
  let path, liveUrl, expect;
  if (tool === 'gsc') {
    if (!/^google[0-9a-z]+\.html$/i.test(p.file ?? '') || p.content !== `google-site-verification: ${p.file}`) fail('the workflow returned no usable verification file — open the run page above');
    path = `public/${p.file}`;
    if (!existsSync(path) || readFileSync(path, 'utf8').trim() !== p.content) { writeFileSync(path, `${p.content}\n`); console.log(`Wrote ${path}.`); }
    liveUrl = `${origin}/${p.file}`;
    expect = p.content;
  } else {
    if (p.verified) { local({ verified: true }); console.log(`✓ bing verify — ${origin}/ is already verified`); process.exit(0); }
    if (!/^[A-Za-z0-9]+$/.test(p.code ?? '')) fail('the workflow returned no usable Bing authentication code — open the run page above');
    path = 'public/BingSiteAuth.xml';
    const next = mergeBingAuth(existsSync(path) ? readFileSync(path, 'utf8') : '', p.code);
    if (next) { writeFileSync(path, next); console.log(`Wrote ${path}.`); }
    liveUrl = `${origin}/BingSiteAuth.xml`;
    expect = p.code;
  }
  // redirect: 'manual' — Google needs the file served directly; a clean-URL or slash redirect fails it.
  const res = await fetch(liveUrl, { redirect: 'manual', headers: { 'cache-control': 'no-cache' } }).catch(() => null);
  if (tool === 'gsc' && res && res.status >= 300 && res.status < 400) fail(`${liveUrl} redirects (${res.status} → ${res.headers.get('location')}) — Google needs the file served directly; check vercel.json cleanUrls/trailingSlash`);
  const live = res?.ok ? await res.text() : '';
  if (!live.includes(expect)) {
    local(tool === 'gsc' ? { identifier: p.identifier, file: path, live: false } : { file: path, live: false });
    fail(`${liveUrl} is not live${tool === 'bing' ? ' with the agency code' : ''} yet. Commit ${path} and push (main auto-deploys), wait for the deploy, then run \`npm run ${tool} -- verify\` again. Keep the file in the repo permanently.`, 3);
  }
  finish(await run(`${tool}-verify`));
}
