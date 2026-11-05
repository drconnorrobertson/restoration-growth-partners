/**
 * Unit tests for the §29 QA-record rule (scripts/lib/blog-qa.mjs + scripts/validate-blog-qa.mjs, run by
 * `npm run check`; postbuild runs the same check). Every post with draft:false needs docs/blog/qa/{slug}.md
 * whose first lines say "Verdict: Ready" (or "Ready after fixes") and "Reviewer: …". Drafts are exempt.
 * Run: npm run test:blog
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { QA_HEAD_LINES, checkQaRecords, parseQaRecord, qaRecordProblem } from '../../scripts/lib/blog-qa.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

test('a Ready record passes; markdown emphasis and list markers are tolerated', () => {
  assert.equal(qaRecordProblem('Verdict: Ready\nReviewer: QA subagent (Sonnet 5.5, high)\n'), null);
  assert.equal(qaRecordProblem('# QA record — a-post\n\n**Verdict:** Ready after fixes\n- **Reviewer:** QA-W01\n'), null);
  assert.equal(qaRecordProblem('verdict: ready after fixes.\nreviewer: J. Smith'), null, 'case and a trailing period do not matter');
  assert.deepEqual(parseQaRecord('Verdict: Ready\nReviewer: QA-W02'), { verdict: 'Ready', reviewer: 'QA-W02' });
});

test('any other verdict, a missing verdict or a missing/empty reviewer fails, naming the problem', () => {
  assert.match(qaRecordProblem('Verdict: Needs answer\nReviewer: QA'), /says "Verdict: Needs answer" — only "Ready" or "Ready after fixes" may be published/);
  assert.match(qaRecordProblem('Verdict: Ready — but check the phone number\nReviewer: QA'), /says "Verdict: Ready — but check/, 'a qualified verdict is not Ready');
  assert.match(qaRecordProblem('Reviewer: QA'), /no "Verdict:" line/);
  assert.match(qaRecordProblem('Verdict: Ready\nReviewer:'), /no "Reviewer:" line/);
  assert.match(qaRecordProblem(''), /no "Verdict:" line.* and has no "Reviewer:" line/);
});

test(`the verdict and reviewer must be in the first ${QA_HEAD_LINES} lines`, () => {
  const late = `${'filler\n'.repeat(QA_HEAD_LINES)}Verdict: Ready\nReviewer: QA\n`;
  assert.match(qaRecordProblem(late), /no "Verdict:" line in its first/);
});

function site(posts, records) {
  const dir = mkdtempSync(join(tmpdir(), 'blog-qa-'));
  const postsDir = join(dir, 'src/content/posts');
  const qaDir = join(dir, 'docs/blog/qa');
  mkdirSync(postsDir, { recursive: true });
  mkdirSync(qaDir, { recursive: true });
  for (const [slug, draft] of Object.entries(posts)) writeFileSync(join(postsDir, `${slug}.json`), JSON.stringify({ slug, draft, publishDate: '2026-10-21T06:00:00Z' }));
  for (const [slug, text] of Object.entries(records)) writeFileSync(join(qaDir, `${slug}.md`), text);
  writeFileSync(join(qaDir, 'README.md'), '# not a record');
  return { postsDir, qaDir };
}

test('checkQaRecords: drafts are exempt; each missing or failing non-draft slug is named', () => {
  const dirs = site(
    { 'ready-post': false, 'fixed-post': false, 'missing-post': false, 'pending-post': false, 'draft-post': true },
    { 'ready-post': 'Verdict: Ready\nReviewer: QA', 'fixed-post': 'Verdict: Ready after fixes\nReviewer: QA', 'pending-post': 'Verdict: Needs answer\nReviewer: QA' },
  );
  const r = checkQaRecords(dirs);
  assert.equal(r.checked, 4);
  assert.equal(r.drafts, 1);
  assert.equal(r.errors.length, 2, r.errors.join('\n'));
  assert.match(r.errors[0], /post "missing-post" has draft:false but no QA record .*missing-post\.md/);
  assert.match(r.errors[1], /post "pending-post" has draft:false but its QA record .* says "Verdict: Needs answer"/);
  assert.ok(!r.errors.join('\n').includes('draft-post'));
});

test('a post with no draft field is not a draft (the schema default is false) and needs a record', () => {
  const dirs = site({}, {});
  writeFileSync(join(dirs.postsDir, 'no-flag.json'), JSON.stringify({ slug: 'no-flag' }));
  assert.match(checkQaRecords(dirs).errors.join('\n'), /post "no-flag" has draft:false but no QA record/);
});

test('validate:blog-qa (npm run check) exits 1 naming the slug, and 0 when every record is Ready', () => {
  const bad = site({ 'missing-post': false, 'draft-post': true }, {});
  const r = spawnSync('node', ['scripts/validate-blog-qa.mjs', '--posts', bad.postsDir, '--qa', bad.qaDir], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /post "missing-post" has draft:false but no QA record/);
  const good = site({ 'ready-post': false, 'draft-post': true }, { 'ready-post': 'Verdict: Ready\nReviewer: QA' });
  const ok = spawnSync('node', ['scripts/validate-blog-qa.mjs', '--posts', good.postsDir, '--qa', good.qaDir], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /1 non-draft post\(s\), each with a Ready QA record \(1 draft\(s\) exempt\)/);
});
