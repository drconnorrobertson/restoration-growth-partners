/**
 * Blog build checks (§29) — run by postbuild.mjs (so `npm run build`, and therefore every Vercel deploy,
 * fails) and by validate:built. Judges the built output against the post files at the time the build
 * ran (recorded by the blogSchedule integration):
 *
 *   · a draft or not-yet-due post must not have been built;
 *   · a due, non-draft post must have been built;
 *   · NOTHING in the output may reference an unpublished post's URL — no page link, sitemap entry,
 *     RSS item, llms.txt line, JSON, nav or related list. Post bodies reduce such links to text until
 *     the target is live (unwrapUnpublishedLinks); anything else that links one is a defect;
 *   · every published post WITHOUT heroImage has its automatic cover files (cover.png 1200×630 +
 *     cover-*.webp card crops), and its og:image, twitter:image, BlogPosting image and /blog/ card use
 *     them; a post with a heroImage keeps its photo; an unpublished post has no cover file;
 *   · every published post page has the company byline (logo + "By {company}") and the "About {company}"
 *     box (logo + name + snippet) after the article body, and — when its body has 3+ H2s — exactly one
 *     "In this article" TOC (nav[data-toc] with aria-label) listing every body H2 whose links all resolve to
 *     an H2 id that occurs once on the page; with fewer than 3 H2s, no TOC (owner decisions 2026-10-14).
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { isPublished, loadPostFiles, postPath } from '../../src/utils/blog-schedule.mjs';
import { buildInfoPath } from '../../src/integrations/blog-schedule.mjs';
import { COVER_FILES } from '../../src/utils/blog-cover.mjs';
import { TOC_MIN_H2, countH2, decodeEntities } from '../../src/utils/blog-toc.mjs';

const TEXT = /\.(html?|xml|txt|json|webmanifest|rss|js|css)$/i;

function* files(dir) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) yield* files(p);
    else yield p;
  }
}

/** The time this output was built at; falls back to now (with a note) for output built before §29. */
export function recordedBuildTime(dist) {
  const f = buildInfoPath(dist.replace(/\/$/, ''));
  if (existsSync(f)) {
    const t = new Date(JSON.parse(readFileSync(f, 'utf8')).buildTime);
    if (!Number.isNaN(t.getTime())) return { at: t, source: f };
  }
  return { at: new Date(), source: null };
}

/** The outer HTML of the first element carrying `attr` (e.g. "data-toc"), nesting-aware; '' when absent. */
export function elementWith(html, attr) {
  const open = new RegExp(`<([a-z][a-z0-9]*)\\b[^>]*\\s${attr}(?:[\\s=>/][^>]*)?>`, 'i').exec(html);
  if (!open) return '';
  const tag = open[1].toLowerCase();
  const re = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'gi');
  re.lastIndex = open.index + open[0].length;
  let depth = 1;
  for (let m; (m = re.exec(html));) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) return html.slice(open.index, m.index + m[0].length);
  }
  return html.slice(open.index);
}

const visible = (h) => decodeEntities(h.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();

/**
 * Company author + "In this article" TOC on one built post page (owner decisions 2026-10-14).
 *   html:        the built page
 *   bodyH2:      number of non-empty H2s in the post file's body (countH2) — the TOC lists exactly these
 *   companyName: the company (default: the page's og:site_name)
 */
export function checkPostPage(html, { where = '', bodyH2, companyName } = {}) {
  const errors = [];
  const name = companyName || decodeEntities(html.match(/<meta[^>]*property="og:site_name"[^>]*content="([^"]*)"/)?.[1] ?? '');
  const byline = elementWith(html, 'data-byline');
  if (!byline) errors.push(`${where}: no company byline (data-byline) — every post shows the logo + "By {company}" + date (§29 company author)`);
  else {
    if (!/<img\b/i.test(byline)) errors.push(`${where}: the byline has no company logo (§29 company author)`);
    if (!visible(byline).includes(`By ${name}`)) errors.push(`${where}: the byline does not say "By ${name}" (§29 company author)`);
  }
  const about = elementWith(html, 'data-blog-author');
  if (!about) errors.push(`${where}: no "About ${name}" box (data-blog-author) after the article (§29 company author)`);
  else {
    if (!/<img\b/i.test(about)) errors.push(`${where}: the About box has no company logo (§29 company author)`);
    const text = visible(about);
    if (!text.includes(`About ${name}`)) errors.push(`${where}: the About box does not name the company ("About ${name}") (§29 company author)`);
    else if (text.replace(`About ${name}`, '').trim().length < 40) errors.push(`${where}: the About box has no company snippet (§29 company author)`);
  }

  const tocs = [...html.matchAll(/<[a-z][a-z0-9]*\b[^>]*\sdata-toc(?:[\s=>/][^>]*)?>/gi)];
  if (bodyH2 < TOC_MIN_H2) {
    if (tocs.length) errors.push(`${where}: has an "In this article" TOC but the body has only ${bodyH2} H2(s) — the TOC is shown with ${TOC_MIN_H2}+ (§29 TOC)`);
    return errors;
  }
  if (tocs.length !== 1) {
    errors.push(`${where}: the body has ${bodyH2} H2s but the page has ${tocs.length} "In this article" TOC(s) — expected exactly 1 (§29 TOC)`);
    return errors;
  }
  const toc = elementWith(html, 'data-toc');
  if (!/^<nav\b[^>]*\saria-label="[^"]+"/i.test(toc)) errors.push(`${where}: the TOC must be a <nav> with an aria-label (§29 TOC)`);
  const targets = [...toc.matchAll(/<a\b[^>]*\shref="#([^"]+)"/gi)].map((m) => decodeEntities(m[1]));
  if (targets.length !== bodyH2) errors.push(`${where}: the TOC lists ${targets.length} link(s) but the body has ${bodyH2} H2s (§29 TOC)`);
  if (new Set(targets).size !== targets.length) errors.push(`${where}: the TOC links the same heading twice (§29 TOC)`);
  const aboutAt = about ? html.indexOf(about) : -1;
  for (const id of targets) {
    const esc = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const count = (html.match(new RegExp(`\\sid="${esc}"`, 'g')) ?? []).length;
    const h2 = new RegExp(`<h2\\b[^>]*\\sid="${esc}"`).exec(html);
    if (count !== 1 || !h2) errors.push(`${where}: TOC link "#${id}" does not resolve to exactly one H2 id on the page (${count} element(s) with that id${h2 ? '' : ', none an H2'}) (§29 TOC)`);
    else if (aboutAt >= 0 && h2.index > aboutAt) errors.push(`${where}: the About box comes before the heading "#${id}" — it belongs after the article body (§29 company author)`);
  }
  return errors;
}

/**
 * coverFiles: the cover files every published post without heroImage must have (sites with 4:3 cards add THUMB_FILES).
 * companyName: the company for the byline/About-box check (default: each page's og:site_name).
 */
export function checkBlogBuild({ dist, postsDir, coverFiles = COVER_FILES, companyName }) {
  const errors = [];
  const notes = [];
  const posts = loadPostFiles(postsDir);
  if (!posts.length) return { errors, notes, posts: 0, published: 0 };
  const { at, source } = recordedBuildTime(dist);
  if (!source) notes.push(`no blog build record next to ${dist} — judged against the current time`);

  const built = (slug) => existsSync(join(dist, 'blog', slug, 'index.html'));
  const unpublished = [];
  let published = 0;
  for (const p of posts) {
    const live = isPublished(p, at);
    if (live) published++;
    if (live && !built(p.slug)) errors.push(`post "${p.slug}" was due at ${p.publishDate} but ${postPath(p.slug)} is not in the build (§29)`);
    if (!live) {
      if (built(p.slug)) errors.push(`post "${p.slug}" is ${p.draft ? 'a draft' : `scheduled for ${p.publishDate}`} but ${postPath(p.slug)} was built (§29)`);
      unpublished.push(p);
    }
  }

  // Automatic covers (§29): every published post WITHOUT heroImage has its cover files, and its og:image,
  // twitter:image and BlogPosting image — and its /blog/ card — use them. A post with a photo keeps the
  // photo; an unpublished post has no cover file.
  const indexPages = [join(dist, 'blog', 'index.html'), ...(existsSync(join(dist, 'blog')) ? readdirSync(join(dist, 'blog')).filter((d) => /^\d+$/.test(d)).map((d) => join(dist, 'blog', d, 'index.html')) : [])].filter(existsSync).map((f) => readFileSync(f, 'utf8'));
  let covers = 0;
  let pagesChecked = 0;
  for (const p of posts) {
    const dir = join(dist, 'blog', p.slug);
    const where = postPath(p.slug);
    if (!isPublished(p, at)) {
      for (const f of coverFiles) if (existsSync(join(dir, f))) errors.push(`${where}${f} exists but the post is not published (§29 cover)`);
      continue;
    }
    if (!built(p.slug)) continue;
    const html = readFileSync(join(dir, 'index.html'), 'utf8');
    errors.push(...checkPostPage(html, { where, bodyH2: countH2(p.html), companyName }));
    pagesChecked++;
    const og = html.match(/<meta[^>]*property="og:image"[^>]*content="([^"]+)"/)?.[1] ?? '';
    const tw = html.match(/<meta[^>]*name="twitter:image"[^>]*content="([^"]+)"/)?.[1] ?? '';
    const ld = [...html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)].flatMap((m) => { try { const d = JSON.parse(m[1]); return Array.isArray(d['@graph']) ? d['@graph'] : [d]; } catch { return []; } });
    const postingImage = [ld.find((n) => [n['@type']].flat().includes('BlogPosting'))?.image].flat()[0];
    const imageUrl = typeof postingImage === 'object' ? postingImage?.url : postingImage;
    const coverUrl = `${where}cover.png`;
    if (p.heroImage) {
      if (existsSync(join(dir, 'cover.png'))) errors.push(`${coverUrl} was built although the post has a heroImage — a post with a photo keeps its photo (§29 cover)`);
      if (og.endsWith(coverUrl)) errors.push(`${where}: og:image is the automatic cover although the post has a heroImage (§29 cover)`);
      continue;
    }
    covers++;
    for (const f of coverFiles) {
      const file = join(dir, f);
      if (!existsSync(file)) { errors.push(`${where}${f} missing — every published post without heroImage gets an automatic cover (§29)`); continue; }
      const b = readFileSync(file);
      if (f.endsWith('.png')) {
        const ok = b.length > 24 && b.readUInt32BE(0) === 0x89504e47 && b.readUInt32BE(16) === 1200 && b.readUInt32BE(20) === 630;
        if (!ok) errors.push(`${where}${f} is not a 1200×630 PNG (§29 cover)`);
      } else if (!(b.length > 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP')) errors.push(`${where}${f} is not a WebP image (§29 cover)`);
    }
    const abs = (u) => /^https?:\/\/[^/]+\//.test(u) && u.endsWith(coverUrl);
    if (!abs(og)) errors.push(`${where}: og:image is "${og}" — it must be the absolute URL of ${coverUrl} (§29 cover)`);
    if (!abs(tw)) errors.push(`${where}: twitter:image is "${tw}" — it must be the absolute URL of ${coverUrl} (§29 cover)`);
    if (!abs(String(imageUrl ?? ''))) errors.push(`${where}: BlogPosting image is "${imageUrl ?? ''}" — it must be the absolute URL of ${coverUrl} (§29 cover)`);
    const card = indexPages.find((h) => h.includes(`href="${where}"`));
    if (card !== undefined && !card.includes(`${where}cover-`)) errors.push(`${where}: its /blog/ index card does not show the cover (${where}cover-*.webp) (§29 cover)`);
  }

  if (unpublished.length) {
    const patterns = unpublished.map((p) => [p, new RegExp(`/blog/${p.slug}(?=[/"'#?<\\s)\\]]|$)`)]);
    const hits = new Map(); // slug -> Set(files)
    for (const f of files(dist)) {
      if (!TEXT.test(f)) continue;
      const body = readFileSync(f, 'utf8');
      if (!body.includes('/blog/')) continue;
      for (const [p, re] of patterns) {
        if (re.test(body)) {
          if (!hits.has(p.slug)) hits.set(p.slug, new Set());
          hits.get(p.slug).add(relative(dist, f));
        }
      }
    }
    const byslug = new Map(unpublished.map((p) => [p.slug, p]));
    for (const [slug, where] of hits) {
      const p = byslug.get(slug);
      const list = [...where];
      errors.push(`${list.length} file(s) reference unpublished post ${postPath(slug)} (${p.draft ? 'draft' : `scheduled ${p.publishDate}`}): ${list.slice(0, 5).join(', ')}${list.length > 5 ? ', …' : ''} — remove the link; posts go live only through the schedule (§29)`);
    }
  }
  return { errors, notes, posts: posts.length, published, covers, pagesChecked, buildTime: at.toISOString() };
}
