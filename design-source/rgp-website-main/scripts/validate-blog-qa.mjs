#!/usr/bin/env node
/**
 * validate:blog-qa (part of `npm run check`) — CORE_CONTRACTS §29 "QA record": every blog post with
 * draft:false has docs/blog/qa/{slug}.md with "Verdict: Ready" (or "Ready after fixes") and "Reviewer:"
 * in its first lines. Drafts are exempt. postbuild.mjs runs the same check (scripts/lib/blog-qa.mjs).
 *
 * Usage: node scripts/validate-blog-qa.mjs [--posts <dir>] [--qa <dir>]
 *   defaults: $BLOG_POSTS_DIR or src/content/posts; $BLOG_QA_DIR or docs/blog/qa (relative to the current folder — npm runs it from the repo root).
 * Exit 1 naming each missing or failing slug.
 */
import { QA_DIR, checkQaRecords } from './lib/blog-qa.mjs';

const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const postsDir = arg('--posts') ?? process.env.BLOG_POSTS_DIR ?? 'src/content/posts';
const qaDir = arg('--qa') ?? process.env.BLOG_QA_DIR ?? QA_DIR;

const { errors, checked, drafts } = checkQaRecords({ postsDir, qaDir });
if (errors.length) {
  for (const e of errors) console.error(`✗ blog QA record: ${e}`);
  console.error(`\n✗ validate:blog-qa failed — ${errors.length} of ${checked} non-draft post(s) lack a passing QA record. Write the record (docs/blog/qa/README.md) or keep the post a draft.`);
  process.exit(1);
}
console.log(`✓ validate:blog-qa passed — ${checked ? `${checked} non-draft post(s), each with a Ready QA record` : 'no non-draft posts'}${drafts ? ` (${drafts} draft(s) exempt)` : ''}.`);
