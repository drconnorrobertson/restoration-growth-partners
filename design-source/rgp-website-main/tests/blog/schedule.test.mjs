/**
 * Unit tests for the §29 scheduling rules (src/utils/blog-schedule.mjs) — the ONE helper every page,
 * check and the publish script use. Run: npm run test:blog
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isPublished, validatePosts, unwrapUnpublishedLinks, blogLinkSlugs, nextSlots, PUBLISH_SLOT } from '../../src/utils/blog-schedule.mjs';
import { scheduleProblem, WORKFLOW_FILE } from '../../scripts/publish-due-posts.mjs';

const parents = new Map([['water-damage-restoration', { url: '/water-damage-restoration/', label: 'Water Damage Restoration' }]]);
const opts = { parents };
const post = (over = {}) => ({ id: 'a-post', slug: 'a-post', publishDate: '2026-10-07T06:00:00Z', parent: 'water-damage-restoration', related: [], html: '<h2>A</h2>', draft: false, ...over });

test('isPublished: due at the exact publish instant, not a millisecond before; drafts never', () => {
  const p = post();
  assert.equal(isPublished(p, new Date('2026-10-07T06:00:00.000Z')), true);
  assert.equal(isPublished(p, new Date('2026-10-07T05:59:59.999Z')), false);
  assert.equal(isPublished({ ...p, draft: true }, new Date('2030-01-01T00:00:00Z')), false);
  assert.equal(isPublished({ ...p, publishDate: 'not a date' }, new Date()), false);
});

test('the publish slot is the same for every client: Wednesday 06:00 UTC', () => {
  assert.deepEqual({ ...PUBLISH_SLOT }, { day: 'wednesday', time: '06:00' });
  assert.deepEqual(nextSlots(new Date('2026-10-14T06:00:00Z'), 2), ['2026-10-21T06:00:00Z', '2026-10-28T06:00:00Z'], 'strictly after');
  assert.deepEqual(nextSlots(new Date('2026-10-26T00:00:00Z'), 2), ['2026-10-28T06:00:00Z', '2026-11-04T06:00:00Z'], 'no daylight-saving shift in UTC');
});

test('validatePosts: a clean set passes', () => {
  const a = post({ related: ['b-post'] });
  const b = post({ id: 'b-post', slug: 'b-post', publishDate: '2026-12-02T06:00:00+00:00', related: ['a-post'], html: '<p><a href="/blog/a-post/">a</a></p>' });
  assert.deepEqual(validatePosts([a, b], opts).errors, []);
});

test('validatePosts: every broken reference fails', () => {
  const errs = (p, others = []) => validatePosts([p, ...others], opts).errors.join('\n');
  assert.match(errs(post({ parent: 'no-such-page' })), /parent "no-such-page" is not a page_id/);
  assert.match(errs(post({ related: ['missing-post'] })), /related post "missing-post" does not exist/);
  assert.match(errs(post({ related: ['a-post'] })), /related lists the post itself/);
  assert.match(errs(post({ html: '<a href="/blog/typo-slug/">x</a>' })), /body links \/blog\/typo-slug\//);
  assert.match(errs(post({ id: 'other-name' })), /file name must be the slug/);
  assert.match(errs(post({ updatedDate: '2026-10-01T06:00:00Z' })), /updatedDate is before publishDate/);
  assert.match(errs(post(), [post({ id: 'a-post' })]), /duplicate slug "a-post"/);
});

test('weekly slot: wrong weekday, wrong time or a non-UTC offset fails, with the next valid slot in the message', () => {
  const errs = (p) => validatePosts([p], opts).errors.join('\n');
  assert.match(errs(post({ publishDate: '2026-10-06T06:00:00Z' })), /publishDate 2026-10-06T06:00:00Z is Tuesday 2026-10-06 06:00 UTC; posts publish on Wednesday at 06:00 UTC — e\.g\. 2026-10-07T06:00:00Z/);
  assert.match(errs(post({ publishDate: '2026-10-07T07:00:00Z' })), /is Wednesday 2026-10-07 07:00 UTC/);
  assert.match(errs(post({ publishDate: '2026-10-07T06:00:30Z' })), /posts publish on Wednesday at 06:00 UTC/);
  assert.match(errs(post({ publishDate: '2026-10-07T01:00:00-05:00' })), /is not written in UTC — use "Z", e\.g\. 2026-10-07T06:00:00Z/, 'right instant, wrong notation');
  assert.equal(errs(post({ publishDate: '2026-10-06T09:00:00Z', draft: true })), '', 'drafts are not on the schedule yet');
});

test('weekly slot: two posts on the same Wednesday fail, published or not', () => {
  const e = validatePosts([post(), post({ id: 'b-post', slug: 'b-post' })], opts).errors.join('\n');
  assert.match(e, /2 posts are scheduled for 2026-10-07 \(a-post, b-post\) — one post per Wednesday/);
  const far = validatePosts([post({ publishDate: '2099-01-07T06:00:00Z' }), post({ id: 'b-post', slug: 'b-post', publishDate: '2099-01-07T06:00:00Z' })], opts).errors.join('\n');
  assert.match(far, /2 posts are scheduled for 2099-01-07/, 'future dates are checked too');
});

test('weekly slot: scheduleFrom exempts migrated history only', () => {
  const o = { ...opts, scheduleFrom: '2026-10-01' };
  assert.deepEqual(validatePosts([post({ publishDate: '2024-07-19T09:00:00-05:00' }), post({ id: 'b-post', slug: 'b-post', publishDate: '2024-07-19T09:00:00-05:00' })], o).errors, []);
  assert.match(validatePosts([post({ publishDate: '2026-10-08T06:00:00Z' })], o).errors.join(), /is Thursday/);
});

test('links to unpublished posts in a body become plain text; live and other links stay', () => {
  const html = '<p>See <a href="/blog/live-one/">live</a>, <a class="x" href="https://example.com/blog/later-one/#faq">later</a> and <a href="/water-damage-restoration/">hub</a>.</p>';
  const out = unwrapUnpublishedLinks(html, new Set(['live-one']), 'https://example.com');
  assert.equal(out, '<p>See <a href="/blog/live-one/">live</a>, later and <a href="/water-damage-restoration/">hub</a>.</p>');
  assert.deepEqual(blogLinkSlugs(html, 'https://example.com'), ['live-one', 'later-one']);
});

test('the workflow template is the one weekly run, Wednesday 06:00 UTC; any other schedule is rejected', () => {
  const text = readFileSync(new URL(`../../${WORKFLOW_FILE}`, import.meta.url), 'utf8');
  assert.equal(scheduleProblem(text), null);
  const entry = (cron, tz) => `on:\n  schedule:\n    - cron: '${cron}'\n${tz ? `      timezone: '${tz}'\n` : ''}  workflow_dispatch:\n`;
  assert.equal(scheduleProblem(entry('0 6 * * 3')), null);
  assert.equal(scheduleProblem(entry('0 6 * * 3', 'UTC')), null);
  assert.match(scheduleProblem(entry('0 6 * * 2')), /runs '0 6 \* \* 2' in UTC; it needs one weekly run, cron '0 6 \* \* 3' in UTC/);
  assert.match(scheduleProblem(entry('50 5 * * 3')), /it needs/, 'before the posts are due');
  assert.match(scheduleProblem(entry('0 6 * * 3', 'America/Chicago')), /in America\/Chicago/, 'no per-client timezone');
  assert.match(scheduleProblem(entry('0 6 * * 3') + `    - cron: '0 18 * * 3'\n`), /has 2 schedule entries/);
});
