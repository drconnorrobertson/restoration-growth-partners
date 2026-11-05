/**
 * End-to-end §29 test: build the starter with FIXTURE posts (tests/blog/fixtures/posts — two past, one
 * future, one draft; never client content) and prove from the built output that:
 *   · the future and draft posts are absent from every page, the index, sitemap, RSS, llms.txt and
 *     every link anywhere in the output;
 *   · a past post renders with BlogPosting + BreadcrumbList, and FAQPage only when it shows FAQs,
 *     built from the same questions it shows;
 *   · validate:built passes on the real output, and FAILS once a link to the future post is added.
 *   · postbuild and validate:built FAIL when a non-draft post has no Ready QA record (§29 QA record;
 *     fixture records in tests/blog/fixtures/qa).
 *   · related posts are filled from other published posts when the post's own are not live yet;
 *   · every post shows the company byline + About box (author/publisher = the Organization, no Person), and
 *     the 3-H2 post has an "In this article" TOC whose links resolve; breaking either fails the checks.
 * Run: npm run test:blog (builds into tests/blog/.tmp/, never touches dist/).
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkBlogBuild } from '../../scripts/lib/blog-checks.mjs';
import { buildToc } from '../../src/utils/blog-toc.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const TMP = join(ROOT, 'tests/blog/.tmp');
const DIST = join(TMP, 'dist');
const POSTS = join(ROOT, 'tests/blog/fixtures/posts');
const QA = join(ROOT, 'tests/blog/fixtures/qa'); // §29 QA records for the three non-draft fixture posts
const env = { ...process.env, BLOG_POSTS_DIR: POSTS, BLOG_QA_DIR: QA, BLOG_BUILD_TIME: '2026-10-13T12:00:00Z' };

const PAST = ['what-to-do-after-a-burst-pipe', 'how-long-does-structural-drying-take'];
const FUTURE = 'when-to-replace-wet-drywall';
const DRAFT = 'ceiling-leak-what-to-do';
const HIDDEN = [FUTURE, DRAFT];

const read = (rel) => readFileSync(join(DIST, rel), 'utf8');
const sh = (cmd, args, extra = {}) => spawnSync(cmd, args, { cwd: ROOT, env: { ...env, ...extra }, encoding: 'utf8' });
function* walk(dir) { for (const e of readdirSync(dir)) { const p = join(dir, e); if (statSync(p).isDirectory()) yield* walk(p); else yield p; } }
const jsonLd = (html) => [...html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)]
  .flatMap((m) => { const d = JSON.parse(m[1]); return Array.isArray(d['@graph']) ? d['@graph'] : [d]; });
const ofType = (nodes, t) => nodes.filter((n) => [n['@type']].flat().includes(t));
const text = (html) => html.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

before(() => {
  rmSync(TMP, { recursive: true, force: true });
  const b = sh('npx', ['astro', 'build', '--config', 'tests/blog/astro-test.config.mjs']);
  assert.equal(b.status, 0, `astro build failed:\n${b.stdout}\n${b.stderr}`);
  const p = sh('node', ['--experimental-strip-types', 'postbuild.mjs', DIST]);
  assert.equal(p.status, 0, `postbuild failed:\n${p.stdout}\n${p.stderr}`);
  assert.match(p.stdout, /blog 2\/4 posts live at [^,]+, 1 automatic cover\(s\)/);
});

test('past posts are built; the future and draft posts are not', () => {
  for (const s of PAST) assert.ok(existsSync(join(DIST, 'blog', s, 'index.html')), `${s} built`);
  for (const s of HIDDEN) assert.ok(!existsSync(join(DIST, 'blog', s)), `${s} must not be built`);
});

test('the blog index lists only published posts', () => {
  const html = read('blog/index.html');
  for (const s of PAST) assert.ok(html.includes(`/blog/${s}/`));
  for (const s of HIDDEN) assert.ok(!html.includes(s), `index must not mention ${s}`);
  assert.ok(!html.includes('Replace Wet Drywall'), 'future title absent from the index');
});

test('sitemap, RSS and llms.txt carry no unpublished post', () => {
  const sitemap = read('sitemap-0.xml');
  const rss = read('blog/rss.xml');
  const llms = read('llms.txt');
  for (const s of PAST) { assert.ok(sitemap.includes(`/blog/${s}/`)); assert.ok(rss.includes(`/blog/${s}/`)); }
  for (const s of HIDDEN) for (const [name, body] of [['sitemap', sitemap], ['rss', rss], ['llms.txt', llms]]) assert.ok(!body.includes(s), `${name} must not mention ${s}`);
});

test('no file anywhere in the build references an unpublished post', () => {
  for (const f of walk(DIST)) {
    if (!/\.(html|xml|txt|json|js|css)$/.test(f)) continue;
    const body = readFileSync(f, 'utf8');
    for (const s of HIDDEN) assert.ok(!body.includes(`/blog/${s}`), `${f} references /blog/${s}`);
  }
});

test('related lists show live posts only; a body link to the future post is plain text', () => {
  const html = read(`blog/${PAST[0]}/index.html`);
  const links = html.match(/<aside[^>]*data-blog-links[\s\S]*?<\/aside>/)[0];
  assert.ok(links.includes(`/blog/${PAST[1]}/`), 'live related post listed');
  assert.ok(links.includes('/water-damage-restoration/'), 'parent hub linked');
  assert.ok(!links.includes(FUTURE));
  assert.match(text(html), /Wet drywall is its own decision: when to replace wet drywall\./, 'anchor text kept');
  assert.ok(html.includes(`href="/blog/${PAST[1]}/"`), 'body link to a live post stays a link');
});

test('a past post has BlogPosting, BreadcrumbList and — with visible FAQs — one matching FAQPage', () => {
  const html = read(`blog/${PAST[0]}/index.html`);
  const nodes = jsonLd(html);
  const [post] = ofType(nodes, 'BlogPosting');
  assert.ok(post, 'BlogPosting present');
  assert.equal(post.headline, 'What to Do After a Burst Pipe: The First Hour');
  assert.equal(post.datePublished, '2026-01-07T06:00:00Z');
  assert.equal(post['@id'], `https://example.com/blog/${PAST[0]}/#article`);
  // Company author (owner decision 2026-10-14): author AND publisher = the Organization (same @id), with name, url, logo.
  for (const who of [post.author, post.publisher]) {
    assert.equal(who['@type'], 'Organization');
    assert.equal(who['@id'], 'https://example.com/#organization');
    assert.equal(who.name, 'Example Restoration Co.');
    assert.equal(who.url, 'https://example.com/');
    assert.match(who.logo.url, /^https:\/\/example\.com\/_astro\/logo\.[^/]+\.png$/);
  }
  assert.equal(ofType(nodes, 'Person').length, 0, 'no Person anywhere');
  assert.deepEqual(ofType(nodes, 'Organization').find((n) => n['@id'] === post.author['@id']).logo, post.author.logo, 'the sitewide Organization node carries the same logo');
  assert.match(post.image, /^https:\/\/example\.com\/_astro\/.+\.jpg$/);
  assert.equal(ofType(nodes, 'WebPage')[0].mainEntity['@id'], post['@id']);

  const crumbs = ofType(nodes, 'BreadcrumbList');
  assert.equal(crumbs.length, 1);
  assert.deepEqual(crumbs[0].itemListElement.map((i) => [i.name, i.item]), [
    ['Home', 'https://example.com/'], ['Blog', 'https://example.com/blog/'], [post.headline, `https://example.com/blog/${PAST[0]}/`],
  ]);

  const faqs = ofType(nodes, 'FAQPage');
  assert.equal(faqs.length, 1, 'exactly one FAQPage');
  const fixture = JSON.parse(readFileSync(join(POSTS, `${PAST[0]}.json`), 'utf8'));
  assert.deepEqual(faqs[0].mainEntity.map((q) => [q.name, q.acceptedAnswer.text]), fixture.faqs.map((f) => [f.question, f.answer]));
  for (const f of fixture.faqs) assert.ok(text(html).includes(f.question), `FAQ "${f.question}" visible on the page`);
  assert.ok(html.includes('data-section="faq"'));
});

test('a post without FAQs has no FAQPage and dateModified from updatedDate', () => {
  const nodes = jsonLd(read(`blog/${PAST[1]}/index.html`));
  assert.equal(ofType(nodes, 'FAQPage').length, 0);
  assert.equal(ofType(nodes, 'BlogPosting')[0].dateModified, '2026-08-04T14:30:00Z');
});

test('automatic cover (§29): a published post without heroImage gets cover files used by og/twitter/JSON-LD and its /blog/ card', async () => {
  const [photo, noPhoto] = PAST; // PAST[0] has a heroImage, PAST[1] has none
  const url = `https://example.com/blog/${noPhoto}/cover.png`;
  for (const f of ['cover.png', 'cover-480.webp', 'cover-960.webp']) assert.ok(existsSync(join(DIST, 'blog', noPhoto, f)), `${f} built`);
  const png = readFileSync(join(DIST, 'blog', noPhoto, 'cover.png'));
  assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [1200, 630], '1200×630');
  const html = read(`blog/${noPhoto}/index.html`);
  assert.ok(html.includes(`<meta property="og:image" content="${url}">`));
  assert.ok(html.includes(`<meta name="twitter:image" content="${url}">`));
  assert.equal(ofType(jsonLd(html), 'BlogPosting')[0].image, url);
  const card = read('blog/index.html').match(new RegExp(`<li[^>]*>(?:(?!</li>)[\\s\\S])*/blog/${noPhoto}/(?:(?!</li>)[\\s\\S])*</li>`))[0];
  assert.match(card, new RegExp(`<img[^>]*src="/blog/${noPhoto}/cover-480\\.webp"[^>]*alt=""[^>]*aria-hidden="true"`));
  // The page's own banner is unchanged: no cover image in the post page body.
  assert.ok(!html.replace(/<head>[\s\S]*<\/head>/, '').includes('cover.png'));
  // A post WITH a photo keeps it; unpublished posts get no cover.
  assert.ok(!existsSync(join(DIST, 'blog', photo, 'cover.png')));
  assert.match(read(`blog/${photo}/index.html`), /<meta property="og:image" content="https:\/\/example\.com\/_astro\/[^"]+\.jpg">/);
  for (const s of HIDDEN) assert.ok(!existsSync(join(DIST, 'blog', s)), `${s}: no cover`);
});

test('company author (owner decision 2026-10-14): logo + "By {company}" byline and an About box after the article', () => {
  for (const s of PAST) {
    const html = read(`blog/${s}/index.html`);
    const byline = html.match(/<p[^>]*data-byline[\s\S]*?<\/p>/)[0];
    assert.match(byline, /<img[^>]*\salt(="")?\s[^>]*aria-hidden="true"/, `${s}: byline logo (decorative — the name is next to it)`);
    assert.match(text(byline), /By Example Restoration Co\. Published/, `${s}: byline text (no glued words)`);
    const about = html.match(/<section[^>]*data-blog-author[\s\S]*?<\/section>/)[0];
    assert.match(about, /<img[^>]*>/);
    assert.match(text(about), /About Example Restoration Co\. Emergency restoration for homes and businesses/, 'name + snippet (site.blog.about empty → site.footerBlurb)');
    assert.ok(about.includes('href="/about/"') && about.includes('href="/contact/"'), 'About and Contact links');
    // After the body, before the related links block and the FAQs.
    const at = html.indexOf(about);
    const lastH2 = buildToc(JSON.parse(readFileSync(join(POSTS, `${s}.json`), 'utf8')).html).headings.at(-1).id;
    assert.ok(at > html.indexOf(` id="${lastH2}"`), 'after the last body H2');
    assert.ok(at < html.indexOf('data-blog-links'), 'before the related links');
    assert.ok(!html.includes('Person'), 'no person byline or schema');
  }
});

test('"In this article" TOC: 3+ body H2s → nav with one link per H2, each resolving to a unique id; fewer → none', () => {
  const html = read(`blog/${PAST[0]}/index.html`);
  const navs = html.match(/<nav[^>]*data-toc[\s\S]*?<\/nav>/g);
  assert.equal(navs.length, 1);
  assert.match(navs[0], /^<nav[^>]*aria-label="In this article"/);
  const ids = [...navs[0].matchAll(/href="#([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(ids, ['what-to-do-after-a-burst-pipe-step-by-step', 'document-before-you-clean', 'insurance-and-whats-covered']);
  for (const id of ids) assert.equal((html.match(new RegExp(` id="${id}"`, 'g')) ?? []).length, 1, `#${id} once`);
  assert.match(text(navs[0]), /In this article What to Do After a Burst Pipe, Step by Step Document Before You Clean Insurance &amp; What’s Covered/);
  // Placed after the byline / hero image, before the first H2.
  assert.ok(html.indexOf('data-byline') < html.indexOf('data-toc') && html.indexOf('data-toc') < html.indexOf('<h2 id='));
  assert.ok(!read(`blog/${PAST[1]}/index.html`).includes('data-toc'), 'a 2-H2 post has no TOC');
});

test('a broken TOC link, a missing About box or a missing TOC fails validate:built and the build check', () => {
  const bad = join(TMP, 'bad-toc');
  rmSync(bad, { recursive: true, force: true });
  cpSync(DIST, join(bad, 'dist'), { recursive: true });
  cpSync(join(TMP, '.astro'), join(bad, '.astro'), { recursive: true });
  const page = join(bad, 'dist', 'blog', PAST[0], 'index.html');
  writeFileSync(page, readFileSync(page, 'utf8').replace(' id="document-before-you-clean"', '').replace(/<section[^>]*data-blog-author[\s\S]*?<\/section>/, ''));
  const other = join(bad, 'dist', 'blog', PAST[1], 'index.html');
  writeFileSync(other, readFileSync(other, 'utf8').replace(/<p[^>]*data-byline[\s\S]*?<\/p>/, ''));
  const direct = checkBlogBuild({ dist: join(bad, 'dist'), postsDir: POSTS });
  const all = direct.errors.join('\n');
  assert.match(all, /TOC link "#document-before-you-clean" does not resolve to exactly one H2 id/);
  assert.match(all, new RegExp(`/blog/${PAST[0]}/: no "About Example Restoration Co\\." box`));
  assert.match(all, new RegExp(`/blog/${PAST[1]}/: no company byline`));
  const r = sh('node', ['scripts/validate-built-html.mjs', join(bad, 'dist')]);
  assert.equal(r.status, 1, 'validate:built must fail');
  assert.match(r.stderr, /TOC link "#document-before-you-clean"/);
  // A 3-H2 post whose TOC was dropped fails too.
  writeFileSync(page, readFileSync(join(DIST, 'blog', PAST[0], 'index.html'), 'utf8').replace(/<nav[^>]*data-toc[\s\S]*?<\/nav>/, ''));
  assert.match(checkBlogBuild({ dist: join(bad, 'dist'), postsDir: POSTS }).errors.join('\n'), /the body has 3 H2s but the page has 0 "In this article" TOC/);
});

test('a missing cover, or og:image not pointing at it, fails validate:built and the build check', () => {
  const bad = join(TMP, 'bad-cover');
  rmSync(bad, { recursive: true, force: true });
  cpSync(DIST, join(bad, 'dist'), { recursive: true });
  cpSync(join(TMP, '.astro'), join(bad, '.astro'), { recursive: true });
  rmSync(join(bad, 'dist', 'blog', PAST[1], 'cover.png'));
  const page = join(bad, 'dist', 'blog', PAST[1], 'index.html');
  writeFileSync(page, readFileSync(page, 'utf8').replace(/(<meta name="twitter:image" content=")[^"]+/, '$1https://example.com/og-default.png'));
  const direct = checkBlogBuild({ dist: join(bad, 'dist'), postsDir: POSTS });
  assert.ok(direct.errors.some((e) => e.includes(`/blog/${PAST[1]}/cover.png missing`)), direct.errors.join('\n'));
  assert.ok(direct.errors.some((e) => e.includes('twitter:image is "https://example.com/og-default.png"')), direct.errors.join('\n'));
  const r = sh('node', ['scripts/validate-built-html.mjs', join(bad, 'dist')]);
  assert.equal(r.status, 1, 'validate:built must fail');
  assert.match(r.stderr, /cover\.png missing/);
});

test('validate:built passes on the fixture build', () => {
  const r = sh('node', ['scripts/validate-built-html.mjs', DIST]);
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /blog schedule \(2\/4 posts live, none unpublished linked, company author \+ TOC checked on 2, 3 Ready QA record\(s\)\)/);
});

test('a deliberate link to the future post fails validate:built and the build check', () => {
  const bad = join(TMP, 'bad');
  rmSync(bad, { recursive: true, force: true });
  cpSync(DIST, join(bad, 'dist'), { recursive: true });
  cpSync(join(TMP, '.astro'), join(bad, '.astro'), { recursive: true }); // the build-time record
  const page = join(bad, 'dist', 'blog', PAST[1], 'index.html');
  writeFileSync(page, readFileSync(page, 'utf8').replace('</article>', `<p><a href="/blog/${FUTURE}/">Coming soon</a></p></article>`));

  const r = sh('node', ['scripts/validate-built-html.mjs', join(bad, 'dist')]);
  assert.equal(r.status, 1, 'validate:built must fail');
  assert.match(r.stderr, new RegExp(`reference unpublished post /blog/${FUTURE}/ \\(scheduled 2099-01-07T06:00:00Z\\): blog/${PAST[1]}/index.html`));
  assert.match(r.stderr, new RegExp(`dead internal link "/blog/${FUTURE}/"`));

  const direct = checkBlogBuild({ dist: join(bad, 'dist'), postsDir: POSTS });
  assert.equal(direct.errors.length, 1, 'postbuild (npm run build) fails on the same link');
});

test('a non-draft post without a passing QA record fails postbuild (npm run build) and validate:built (§29 QA record)', () => {
  const bad = join(TMP, 'qa-missing');
  rmSync(bad, { recursive: true, force: true });
  cpSync(DIST, join(bad, 'dist'), { recursive: true });
  cpSync(join(TMP, '.astro'), join(bad, '.astro'), { recursive: true });
  const qa = join(bad, 'qa');
  cpSync(QA, qa, { recursive: true });
  rmSync(join(qa, `${PAST[0]}.md`)); // a published post with no record
  writeFileSync(join(qa, `${FUTURE}.md`), 'Verdict: Needs answer\nReviewer: QA\n'); // a scheduled post whose QA is not Ready
  const p = sh('node', ['--experimental-strip-types', 'postbuild.mjs', join(bad, 'dist')], { BLOG_QA_DIR: qa });
  assert.equal(p.status, 1, 'postbuild must fail');
  assert.match(p.stderr, new RegExp(`post "${PAST[0]}" has draft:false but no QA record`));
  assert.match(p.stderr, new RegExp(`post "${FUTURE}" has draft:false but its QA record .* says "Verdict: Needs answer"`));
  assert.ok(!p.stderr.includes(DRAFT), 'the draft is exempt');
  const r = sh('node', ['scripts/validate-built-html.mjs', join(bad, 'dist')], { BLOG_QA_DIR: qa });
  assert.equal(r.status, 1, 'validate:built must fail');
  assert.match(r.stderr, /blog QA record: post "what-to-do-after-a-burst-pipe" has draft:false but no QA record/);
});

/** Build with a modified copy of the fixture posts; returns the combined build output and exit status. */
function buildWith(name, edit) {
  const tmp = join(TMP, name);
  const posts = join(tmp, 'posts');
  mkdirSync(posts, { recursive: true });
  const files = Object.fromEntries(readdirSync(POSTS).map((f) => [f, JSON.parse(readFileSync(join(POSTS, f), 'utf8'))]));
  // Image paths are relative to the post file: re-point them from the copied folder.
  for (const data of Object.values(files)) if (data.heroImage) data.heroImage = relative(posts, resolve(POSTS, data.heroImage));
  edit(files);
  for (const [f, data] of Object.entries(files)) writeFileSync(join(posts, f), JSON.stringify(data));
  const r = sh('npx', ['astro', 'build', '--config', 'tests/blog/astro-test.config.mjs'], { BLOG_POSTS_DIR: posts, BLOG_TEST_TMP: `${tmp}/` });
  return { status: r.status, out: `${r.stdout}\n${r.stderr}` };
}

test('a broken cross-reference fails the build itself (parent not in the page map, related slug missing)', () => {
  const r = buildWith('crossref', (f) => Object.assign(f[`${PAST[1]}.json`], { parent: 'not-a-page', related: ['no-such-post'] }));
  assert.notEqual(r.status, 0, 'build must fail');
  assert.match(r.out, /parent "not-a-page" is not a page_id in the page map/);
  assert.match(r.out, /related post "no-such-post" does not exist/);
});

test('a broken FUTURE post fails today\'s build — every post is validated on every build, published or not', () => {
  const r = buildWith('future-broken', (f) => Object.assign(f[`${FUTURE}.json`], { parent: 'not-a-page' }));
  assert.notEqual(r.status, 0, 'build must fail although the post is not due until 2099');
  assert.match(r.out, new RegExp(`${FUTURE}\\.json: parent "not-a-page"`));
});

test('a post that is not on the weekly slot (Wednesday 06:00 UTC) fails the build, with the next valid slot', () => {
  const r = buildWith('wrong-weekday', (f) => { f[`${FUTURE}.json`].publishDate = '2099-01-06T06:00:00Z'; }); // a Tuesday
  assert.notEqual(r.status, 0);
  assert.match(r.out, new RegExp(`${FUTURE}\\.json: publishDate 2099-01-06T06:00:00Z is Tuesday 2099-01-06 06:00 UTC; posts publish on Wednesday at 06:00 UTC — e\\.g\\. 2099-01-07T06:00:00Z`));
  const late = buildWith('wrong-time', (f) => { f[`${FUTURE}.json`].publishDate = '2099-01-07T09:00:00Z'; });
  assert.notEqual(late.status, 0);
  assert.match(late.out, /is Wednesday 2099-01-07 09:00 UTC; posts publish on Wednesday at 06:00 UTC/);
  const local = buildWith('not-utc', (f) => { f[`${FUTURE}.json`].publishDate = '2099-01-07T00:00:00-06:00'; }); // same instant, local offset
  assert.notEqual(local.status, 0);
  assert.match(local.out, /publishDate 2099-01-07T00:00:00-06:00 is not written in UTC — use "Z", e\.g\. 2099-01-07T06:00:00Z/);
});

test('related posts are never empty: a post whose related posts are all unpublished shows other published posts', () => {
  const r = buildWith('related-fill', (f) => { f[`${PAST[1]}.json`].related = [FUTURE]; });
  assert.equal(r.status, 0, r.out);
  const html = readFileSync(join(TMP, 'related-fill', 'dist', 'blog', PAST[1], 'index.html'), 'utf8');
  const links = html.match(/<aside[^>]*data-blog-links[\s\S]*?<\/aside>/)[0];
  assert.ok(links.includes(`href="/blog/${PAST[0]}/"`), 'the only other published post fills the list');
  assert.ok(!links.includes(FUTURE) && !links.includes(DRAFT) && !links.includes(`href="/blog/${PAST[1]}/"`), 'never unpublished, never itself');
});

test('two posts on the same Wednesday fail the build', () => {
  const r = buildWith('same-date', (f) => {
    f['second-future-post.json'] = { ...f[`${FUTURE}.json`], slug: 'second-future-post', title: 'A Second Post on the Same Date', related: [] };
  });
  assert.notEqual(r.status, 0);
  assert.match(r.out, /2 posts are scheduled for 2099-01-07 \(second-future-post, when-to-replace-wet-drywall\) — one post per Wednesday/);
});
