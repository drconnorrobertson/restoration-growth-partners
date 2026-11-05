/**
 * "In this article" TOC rules (src/utils/blog-toc.mjs) and the built-page check (checkPostPage in
 * scripts/lib/blog-checks.mjs) — owner decisions 2026-10-14. No build needed. Run: npm run test:blog.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOC_MIN_H2, buildToc, countH2, slugifyHeading } from '../../src/utils/blog-toc.mjs';
import { checkPostPage } from '../../scripts/lib/blog-checks.mjs';

test('slugs are ASCII, lowercase, hyphenated and never empty', () => {
  assert.equal(slugifyHeading('What’s Covered — & What Isn’t?'), 'whats-covered-and-what-isnt');
  assert.equal(slugifyHeading('Café Moisture: 3 Signs'), 'cafe-moisture-3-signs');
  assert.equal(slugifyHeading('???'), 'section');
  const long = slugifyHeading('How Long Structural Drying Takes in a Typical Home After a Burst Pipe Floods the Basement');
  assert.ok(long.length <= 60 && !long.endsWith('-'), long);
});

test('every non-empty H2 gets a stable id, unique within the page; existing and reserved ids are respected', () => {
  const body = '<h2>Stop the Water</h2><p>a</p><h2 class="x">Stop the <em>Water</em></h2><h2 id="kept">Kept</h2><h2> </h2><h2>Request Service</h2><p id="stop-the-water-3">x</p><h2>Stop the water</h2>';
  const a = buildToc(body, { reserved: ['request-service'] });
  assert.deepEqual(a.headings, [
    { id: 'stop-the-water', text: 'Stop the Water' },
    { id: 'stop-the-water-2', text: 'Stop the Water' },
    { id: 'kept', text: 'Kept' },
    { id: 'request-service-2', text: 'Request Service' },
    { id: 'stop-the-water-4', text: 'Stop the water' },
  ]);
  assert.ok(a.html.includes('<h2 class="x" id="stop-the-water-2">Stop the <em>Water</em></h2>'));
  assert.ok(a.html.includes('<h2> </h2>'), 'empty heading untouched');
  assert.equal(countH2(body), 5);
  assert.deepEqual(buildToc(body, { reserved: ['request-service'] }), a, 'deterministic');
});

test('the TOC shows only with 3+ H2s', () => {
  assert.equal(TOC_MIN_H2, 3);
  assert.equal(buildToc('<h2>A</h2><h2>B</h2>').show, false);
  assert.equal(buildToc('<h2>A</h2><h2>B</h2><h2>C</h2>').show, true);
});

const page = ({ toc = true, about = true, byline = true, ids = ['a', 'b', 'c'] } = {}) => `<head><meta property="og:site_name" content="Acme &amp; Sons"></head>
${byline ? '<p data-byline><span><img src="/l.png" alt="" aria-hidden="true"> <span>By Acme &amp; Sons</span></span> <span>Published May 6, 2026</span></p>' : ''}
${toc ? `<nav aria-label="In this article" data-toc><p>In this article</p><ol>${ids.map((i) => `<li><a href="#${i}">${i}</a></li>`).join('')}</ol></nav>` : ''}
<h2 id="a">A</h2><h2 id="b">B</h2><h2 id="c">C</h2>
${about ? '<section data-blog-author><img src="/l.png" alt=""><div><h2 id="about-company">About Acme &amp; Sons</h2><p>Approved company snippet about the work the company does.</p></div></section>' : ''}`;

test('checkPostPage passes a complete page and names each defect', () => {
  assert.deepEqual(checkPostPage(page(), { where: '/blog/x/', bodyH2: 3 }), []);
  assert.deepEqual(checkPostPage(page({ toc: false }), { where: '/blog/x/', bodyH2: 2 }), [], 'no TOC under 3 H2s');
  assert.match(checkPostPage(page(), { bodyH2: 2 }).join(), /has an "In this article" TOC but the body has only 2/);
  assert.match(checkPostPage(page({ toc: false }), { bodyH2: 3 }).join(), /has 0 "In this article" TOC/);
  assert.match(checkPostPage(page({ ids: ['a', 'b', 'zzz'] }), { bodyH2: 3 }).join(), /"#zzz" does not resolve/);
  assert.match(checkPostPage(page({ ids: ['a', 'b'] }), { bodyH2: 3 }).join(), /lists 2 link\(s\) but the body has 3/);
  assert.match(checkPostPage(page({ about: false }), { bodyH2: 3 }).join(), /no "About Acme & Sons" box/);
  assert.match(checkPostPage(page({ byline: false }), { bodyH2: 3 }).join(), /no company byline/);
  assert.match(checkPostPage(page(), { bodyH2: 3, companyName: 'Other Co' }).join(), /does not say "By Other Co"/);
});
