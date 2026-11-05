/**
 * Blog QA records (CORE_CONTRACTS §29 → "QA record", owner decision 2026-10-14).
 *
 * Every post with `draft: false` must have a QA record at docs/blog/qa/{slug}.md (client repo root) whose
 * first QA_HEAD_LINES lines include
 *
 *   Verdict: Ready            (or: Verdict: Ready after fixes)
 *   Reviewer: <who reviewed>  (e.g. "QA subagent, Sonnet 5.5 high")
 *
 * Drafts are exempt. Any other verdict (e.g. "Needs answer") means the post is not approvable yet.
 * Run by `npm run check` (scripts/validate-blog-qa.mjs), postbuild.mjs (so `npm run build`,
 * `npm run check:built` and every Vercel deploy) and validate:built. Plain node, no dependencies.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadPostFiles } from '../../src/utils/blog-schedule.mjs';

export const QA_DIR = 'docs/blog/qa';
export const QA_HEAD_LINES = 10;
export const READY_VERDICTS = Object.freeze(['Ready', 'Ready after fixes']);

/** Value of "Name: value" among `lines` (markdown emphasis, list/heading/quote markers tolerated), or null. */
function field(lines, name) {
  const re = new RegExp(`^(?:[-*>#]\\s*)*${name}\\s*:\\s*(.*)$`, 'i');
  for (const raw of lines) {
    const m = raw.replace(/[*_`]/g, '').trim().match(re);
    if (m) return m[1].trim();
  }
  return null;
}

/** The parsed head of a QA record: { verdict, reviewer } (null when the line is absent). */
export function parseQaRecord(text) {
  const head = String(text ?? '').split(/\r?\n/).slice(0, QA_HEAD_LINES);
  return { verdict: field(head, 'Verdict'), reviewer: field(head, 'Reviewer') };
}

/** null when the record approves publishing; otherwise a plain sentence saying what is wrong. */
export function qaRecordProblem(text) {
  const { verdict, reviewer } = parseQaRecord(text);
  const problems = [];
  const ok = READY_VERDICTS.map((v) => v.toLowerCase());
  if (verdict === null) problems.push(`has no "Verdict:" line in its first ${QA_HEAD_LINES} lines`);
  else if (!ok.includes(verdict.replace(/\.$/, '').trim().toLowerCase())) problems.push(`says "Verdict: ${verdict}" — only ${READY_VERDICTS.map((v) => `"${v}"`).join(' or ')} may be published`);
  if (!reviewer) problems.push(`has no "Reviewer:" line (with a name) in its first ${QA_HEAD_LINES} lines`);
  return problems.length ? problems.join(' and ') : null;
}

/**
 * Check every non-draft post in `postsDir` against `qaDir`. Returns { errors, checked, drafts } — one
 * error per missing or failing slug, naming it.
 */
export function checkQaRecords({ postsDir, qaDir = QA_DIR }) {
  const errors = [];
  let checked = 0;
  let drafts = 0;
  for (const p of loadPostFiles(postsDir)) {
    if (p.draft === true) { drafts++; continue; }
    checked++;
    const slug = p.slug ?? p.id;
    const file = join(qaDir, `${slug}.md`);
    if (!existsSync(file)) {
      errors.push(`post "${slug}" has draft:false but no QA record ${file} — run the QA review (copywriter blog mode) or set draft:true (§29 QA record)`);
      continue;
    }
    const why = qaRecordProblem(readFileSync(file, 'utf8'));
    if (why) errors.push(`post "${slug}" has draft:false but its QA record ${file} ${why} (§29 QA record)`);
  }
  return { errors, checked, drafts };
}
