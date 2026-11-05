/**
 * Unit tests for the developer review page (scripts/blog-review.mjs → renderReviewPage, Stage F step 5).
 * The all-published build it runs first is the real build; here only the page is tested. Run: npm run test:blog
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderReviewPage, wordCount } from '../../scripts/blog-review.mjs';

const post = (slug, publishDate, over = {}) => ({ slug, publishDate, title: `Title ${slug}`, description: `About ${slug}`, parent: 'water-damage-restoration', html: '<h2>H</h2><p>One two <a href="/water-damage-restoration/">three</a>.</p>', faqs: [{ question: 'Q <1>?', answer: 'A & B' }], draft: true, ...over });
const input = () => ({
  posts: [post('later-post', '2026-11-04T06:00:00Z'), post('first-post', '2026-10-21T06:00:00Z')],
  qa: new Map([['first-post', 'Verdict: Ready after fixes\nReviewer: QA-W01\n\n## What QA fixed\n- Removed an unsupported EPA claim']]),
  covers: new Map([['first-post', 'covers/first-post.png']]),
  schedule: [{ slug: 'first-post', row_id: 'BLG-WTR-001', primary_keyword: 'first keyword' }],
  skipped: [{ row_id: 'BLG-STM-020', slug: 'hurricane-prep', reason: 'inland client' }],
  siteUrl: 'https://www.example.com/',
});

test('every post, in date order, with its cover, QA verdict + record, FAQs, schedule row and the skipped topics', () => {
  const html = renderReviewPage(input());
  assert.ok(html.indexOf('id="first-post"') < html.indexOf('id="later-post"'), 'sorted by publishDate');
  assert.match(html, /src="covers\/first-post\.png"/);
  assert.match(html, /<div class="thumb none">no cover<\/div>/, 'a missing cover is shown, not hidden');
  assert.match(html, /<span class="b ok">Ready after fixes<\/span>/);
  assert.match(html, /<span class="b no">No QA record<\/span>/);
  assert.match(html, /Removed an unsupported EPA claim/);
  assert.match(html, /1 of 2 have a Ready QA record/);
  assert.match(html, /BLG-WTR-001/);
  assert.match(html, /keyword “first keyword”/);
  assert.match(html, /BLG-STM-020<\/b> hurricane-prep — inland client/);
  assert.match(html, /<summary>Q &lt;1&gt;\?<\/summary><p>A &amp; B<\/p>/, 'FAQ text is escaped');
  assert.match(html, /href="https:\/\/www\.example\.com\/water-damage-restoration\/" target="_blank"/, 'body links open the live site');
  assert.match(html, /October 21, 2026 → November 4, 2026/);
});

test('deterministic: the same input gives the same bytes', () => {
  assert.equal(renderReviewPage(input()), renderReviewPage(input()));
});

test('wordCount counts body words only', () => {
  assert.equal(wordCount('<h2>Two words</h2><p>and&nbsp;three more</p>'), 5);
});
