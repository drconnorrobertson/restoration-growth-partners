/**
 * Related posts are never empty (src/utils/blog-related.mjs, owner decision 2026-10-14): the post's own
 * published related posts first; under 3, filled with other PUBLISHED posts — same group first, then any,
 * newest first — never the post itself, never twice, never unpublished. No build needed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RELATED_MIN, fillRelated } from '../../src/utils/blog-related.mjs';

// The pool is what the site passes: PUBLISHED posts only, newest first.
const pool = [
  { slug: 'new-mold', group: 'mold' },
  { slug: 'new-water', group: 'water' },
  { slug: 'self', group: 'water' },
  { slug: 'old-fire', group: 'fire' },
  { slug: 'old-water', group: 'water' },
  { slug: 'oldest-storm', group: 'storm' },
];
const run = (chosen, extra = {}) =>
  fillRelated({ chosen, pool, key: (p) => p.slug, self: 'self', sameGroup: (p) => p.group === 'water', ...extra }).map((p) => p.slug);

test('own related posts that are live come first, in their order; nothing added when there are 3+', () => {
  assert.equal(RELATED_MIN, 3);
  const own = [{ slug: 'oldest-storm' }, { slug: 'old-fire' }, { slug: 'new-mold' }, { slug: 'old-water' }];
  assert.deepEqual(run(own), ['oldest-storm', 'old-fire', 'new-mold', 'old-water']);
});

test('none of the own related posts live (all scheduled) → 3 published posts: same group first, then newest', () => {
  assert.deepEqual(run([]), ['new-water', 'old-water', 'new-mold']);
});

test('one live own related post → filled to 3, no duplicates, never the post itself', () => {
  assert.deepEqual(run([{ slug: 'old-water' }]), ['old-water', 'new-water', 'new-mold']);
});

test('only one other post published → that post (never empty); nothing published but the post → empty', () => {
  const one = fillRelated({ chosen: [], pool: [{ slug: 'self' }, { slug: 'legacy' }], key: (p) => p.slug, self: 'self' });
  assert.deepEqual(one.map((p) => p.slug), ['legacy']);
  assert.deepEqual(fillRelated({ chosen: [], pool: [{ slug: 'self' }], key: (p) => p.slug, self: 'self' }), []);
});

test('deterministic: same input, same output', () => {
  assert.deepEqual(run([]), run([]));
});
