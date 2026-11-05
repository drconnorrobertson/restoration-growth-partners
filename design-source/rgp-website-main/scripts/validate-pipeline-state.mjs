#!/usr/bin/env node
/**
 * validate-pipeline-state.mjs — the checklist enforcer (owner decision 2026-09-11).
 *
 * Reads artifacts/pipeline-state.yaml (schemas/pipeline-state.yaml) and fails when:
 *   - a stage is running ahead of an open gate (any earlier stage not terminal)
 *   - a gated stage is `approved` without approved_by + approved_at + a verbatim approval_quote
 *     + evidence files that exist on disk — the agent may never approve on its own
 *   - reality disagrees with the checklist:
 *       copy artifacts exist            → 3_briefs must be approved (Gate 2)
 *       design-recipe.yaml is Approved  → 5_design must be approved (Gate 4) with the gate4 packet
 *       client pages exist in dist/     → 5_design must be approved (Gate 4) — no build before visual sign-off
 *       client artifacts exist          → the state file must exist at all
 *
 * Usage: node scripts/validate-pipeline-state.mjs [artifactsDir] [--board] [--dist <dir>]
 *   --board prints the status board only (npm run status). Exit 1 on errors.
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const BOARD = argv.includes('--board');
const distArg = argv.includes('--dist') ? argv[argv.indexOf('--dist') + 1] : null;
const positional = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--dist');
const dir = positional[0] ? resolve(positional[0]) : join(ROOT, 'artifacts');
const isExamples = dir.endsWith(join('artifacts', 'examples'));
const DIST = distArg ? resolve(distArg) : (isExamples ? null : join(ROOT, 'dist'));
// evidence paths are relative to the client repo root (the parent of artifacts/); the fixture's root is starter/
const REPO_ROOT = isExamples ? resolve(dir, '..', '..') : dirname(dir);
let state; let stages = {};

const ORDER = ['1_intake', '3_briefs', '4_copy', '5_design', '6_build', '6b_linking', '7_review', '8_launch'];
const GATED = new Set(['1_intake', '3_briefs', '4_copy', '5_design', '7_review', '8_launch']);
const TERMINAL = (k, s) => (GATED.has(k) ? s === 'approved' : s === 'complete');
const errors = []; const warnings = [];
const err = (m) => errors.push(m); const warn = (m) => warnings.push(m);
const isBlank = (v) => v === undefined || v === null || String(v).trim() === '';

// ---- what reality looks like --------------------------------------------------
const copyDir = join(dir, 'copy');
const hasCopy = existsSync(copyDir) && readdirSync(copyDir).some((f) => /\.ya?ml$/.test(f) && f !== 'messaging-pack.yaml');
const hasPageMap = existsSync(join(dir, 'active-page-map.yaml'));
let recipeApproved = false;
if (existsSync(join(dir, 'design-recipe.yaml'))) {
  try { recipeApproved = parse(readFileSync(join(dir, 'design-recipe.yaml'), 'utf8'))?.meta?.status === 'Approved'; } catch { /* validate:artifacts reports it */ }
}
let clientPagesBuilt = 0;
if (DIST && existsSync(DIST)) {
  const walk = (d) => { for (const e of readdirSync(d)) { const p = join(d, e); if (statSync(p).isDirectory()) walk(p); else if (e === 'index.html') {
    const rel = p.slice(DIST.length + 1);
    if (rel.startsWith('templates/')) continue;
    if (rel === 'index.html' && readFileSync(p, 'utf8').includes('data-starter-directory')) continue;
    clientPagesBuilt++;
  } } };
  walk(DIST);
}

// ---- the state file -------------------------------------------------------------
const statePath = join(dir, 'pipeline-state.yaml');
if (!existsSync(statePath)) {
  if (hasCopy || hasPageMap || clientPagesBuilt > 0)
    err(`client artifacts exist (page map: ${hasPageMap}, copy: ${hasCopy}, built pages: ${clientPagesBuilt}) but artifacts/pipeline-state.yaml is missing — the conductor creates it at kickoff; no stage runs without it`);
  else console.log('validate-pipeline-state: no pipeline-state.yaml and no client artifacts — starter/template context, nothing to check.');
  finish();
}
try { state = parse(readFileSync(statePath, 'utf8')); } catch (e) { err(`pipeline-state.yaml failed to parse: ${e.message}`); finish(); }
stages = state?.stages ?? {};

for (const k of ORDER) if (!stages[k]) err(`stages.${k} missing — the checklist must list every stage in order`);
for (const k of Object.keys(stages)) if (!ORDER.includes(k)) warn(`unknown stage key "${k}"`);

ORDER.forEach((k, i) => {
  const s = stages[k]; if (!s) return;
  const valid = GATED.has(k) ? ['not_started', 'in_progress', 'awaiting_gate', 'approved', 'blocked'] : ['not_started', 'in_progress', 'complete', 'blocked'];
  if (!valid.includes(s.status)) err(`${k}: status "${s.status}" invalid (${valid.join(' | ')})`);

  // no running ahead of an open gate
  if (s.status !== 'not_started') {
    const open = ORDER.slice(0, i).filter((p) => stages[p] && !TERMINAL(p, stages[p].status));
    if (open.length) err(`${k} is ${s.status} but ${open.join(', ')} ${open.length > 1 ? 'are' : 'is'} not approved/complete — no stage runs ahead of an open gate`);
  }

  // every evidence path must be INSIDE the client repo (owner decision 2026-10-13): build documents saved next to the
  // repo (../01-INTAKE.md) exist only on the builder's computer — the check passed there and failed for everyone else.
  for (const ev of Array.isArray(s.evidence) ? s.evidence : []) {
    if (/^https?:\/\//.test(String(ev))) continue;
    const rel = relative(REPO_ROOT, resolve(REPO_ROOT, String(ev).replace(/\*.*$/, '')));
    if (rel.startsWith('..') || isAbsolute(rel)) err(`${k}: evidence "${ev}" is outside the client repo — save build documents inside it (docs/intake/, docs/pipeline/, docs/source-inputs/), never in the folder next to it (CORE_CONTRACTS §25)`);
  }

  // an approval is a human act with evidence
  if (s.status === 'approved') {
    for (const f of ['approved_by', 'approved_at', 'approval_quote'])
      if (isBlank(s[f])) err(`${k}: approved but ${f} is empty — only a human approves; record who, when, and their words verbatim`);
    if (!isBlank(s.approval_quote) && String(s.approval_quote).trim().length < 8) err(`${k}: approval_quote "${s.approval_quote}" is too short to be a real approval`);
    if (!Array.isArray(s.evidence) || s.evidence.length === 0) err(`${k}: approved with no evidence paths`);
    for (const ev of s.evidence ?? []) {
      if (/^https?:\/\//.test(String(ev))) continue;              // preview URLs are fine
      const p = resolve(REPO_ROOT, String(ev).replace(/\*.*$/, '')); // allow globs by checking the parent
      if (!existsSync(p)) err(`${k}: evidence "${ev}" does not exist on disk`);
    }
  }
  if (s.status === 'complete' && (!Array.isArray(s.evidence) || s.evidence.length === 0)) err(`${k}: complete with no evidence paths`);
  if (s.status === 'blocked' && isBlank(s.blocked_by)) err(`${k}: blocked without blocked_by`);
});

// ---- reality vs checklist --------------------------------------------------------
if (hasCopy && stages['3_briefs']?.status !== 'approved')
  err(`copy artifacts exist in artifacts/copy/ but 3_briefs is "${stages['3_briefs']?.status}" — copy is written only from approved briefs (Gate 2)`);
if (recipeApproved && stages['5_design']?.status !== 'approved')
  err(`design-recipe.yaml is Approved but 5_design is "${stages['5_design']?.status}" — the recipe is approved at Gate 4, from screenshots, by a human`);
if (clientPagesBuilt > 0 && stages['5_design']?.status !== 'approved')
  err(`${clientPagesBuilt} client page(s) built in dist/ but 5_design is "${stages['5_design']?.status}" — NO client page is assembled before Gate 4 (visual approval)`);
if (state?.meta?.current_stage && !ORDER.includes(state.meta.current_stage)) err(`meta.current_stage "${state.meta.current_stage}" is not a stage key`);

finish();

function finish() {
  if (state) {
    console.log(`\nPIPELINE STATUS — ${state.meta?.client || '(client not set)'}  ·  current: ${state.meta?.current_stage || '?'}`);
    for (const k of ORDER) {
      const s = stages[k] ?? { status: 'MISSING' };
      const mark = TERMINAL(k, s.status) ? '✅' : s.status === 'awaiting_gate' ? '🛑' : s.status === 'in_progress' ? '🔄' : s.status === 'blocked' ? '⛔' : '·';
      const who = s.status === 'approved' ? ` — ${s.approved_by} ${s.approved_at}: "${String(s.approval_quote).slice(0, 60)}"` : s.status === 'blocked' ? ` — blocked by ${s.blocked_by}` : '';
      console.log(`  ${mark} ${k.padEnd(11)} ${String(s.status).padEnd(13)} ${GATED.has(k) ? `(${s.gate ?? 'gate'})` : '(no gate)'}${who}`);
    }
    if (DIST) console.log(`  reality: page map ${hasPageMap ? 'yes' : 'no'} · copy artifacts ${hasCopy ? 'yes' : 'no'} · recipe Approved ${recipeApproved ? 'yes' : 'no'} · client pages built ${clientPagesBuilt}`);
    console.log('');
  }
  if (BOARD && errors.length === 0) process.exit(0);
  warnings.forEach((w) => console.warn(`  WARN  ${w}`));
  errors.forEach((e) => console.error(`  ERROR ${e}`));
  console.log(`validate-pipeline-state: ${errors.length} error(s), ${warnings.length} warning(s)`);
  process.exit(errors.length ? 1 : 0);
}
