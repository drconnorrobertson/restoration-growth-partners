/**
 * Blog scheduling rules (CORE_CONTRACTS §29) — ONE implementation shared by the Astro pages, postbuild,
 * validate:built and the publish workflow script, so "is this post live?" has one answer everywhere.
 * Plain .mjs (like seo.mjs) so `node scripts/*.mjs` can import it without a TypeScript loader.
 *
 * Astro builds static HTML, so a post goes live by being BUILT: a post whose publishDate is still in the
 * future at build time produces no page and appears in no list, feed, sitemap or link. The weekly
 * GitHub Actions workflow (.github/workflows/publish-scheduled-posts.yml) rebuilds the site once a
 * post's publishDate has passed.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const BLOG_PATH = '/blog/';
export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const postPath = (slug) => `${BLOG_PATH}${slug}/`;

/**
 * The single time a build is evaluated at. The `blogSchedule` integration (astro.config.mjs) sets
 * BLOG_BUILD_TIME once when the build starts, so every page of one build agrees on which posts are
 * live. Tests set it to a fixed instant. Never set it in Vercel: a frozen time stops posts publishing.
 */
const MODULE_LOADED = new Date();
export function buildTime() {
  const fixed = process.env.BLOG_BUILD_TIME;
  if (fixed) {
    const d = new Date(fixed);
    if (Number.isNaN(d.getTime())) throw new Error(`[blog] BLOG_BUILD_TIME "${fixed}" is not a date`);
    return d;
  }
  return MODULE_LOADED;
}

/** THE publish rule: not a draft, and publishDate at or before `at`. */
export function isPublished(post, at = buildTime()) {
  if (!post || post.draft) return false;
  const d = new Date(post.publishDate);
  return !Number.isNaN(d.getTime()) && d.getTime() <= at.getTime();
}

/** Newest first; ties broken by slug so the order is deterministic. */
export const byNewest = (a, b) => new Date(b.publishDate) - new Date(a.publishDate) || String(a.slug).localeCompare(String(b.slug));

/**
 * THE publish slot — the same for every client (owner decision 2026-10-14): Wednesday 06:00 UTC, one post
 * per Wednesday. The weekly workflow runs at that time; dates are shown in UTC (06:00 UTC is still
 * Wednesday everywhere in the US). Not a per-site setting.
 */
export const PUBLISH_SLOT = Object.freeze({ day: 'wednesday', time: '06:00' });
export const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/** Calendar date of an instant in UTC, e.g. "October 14, 2026". */
export function formatPostDate(iso) {
  return new Date(iso).toLocaleDateString('en-US', { timeZone: 'UTC', year: 'numeric', month: 'long', day: 'numeric' });
}

/** UTC weekday ("wednesday"), date ("2026-10-14"), time ("06:00") and seconds of an instant. */
export function utcParts(iso) {
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return {
    weekday: WEEKDAYS[d.getUTCDay()],
    date: d.toISOString().slice(0, 10),
    time: `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`,
    seconds: pad(d.getUTCSeconds()),
  };
}

const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1);

/** The next `count` publish slots strictly after `from`, as "2026-10-14T06:00:00Z" — for messages and the copywriter. */
export function nextSlots(from, count = 1) {
  const out = [];
  for (let d = 0; out.length < count && d < 400; d++) {
    const iso = `${new Date(from.getTime() + d * 86400000).toISOString().slice(0, 10)}T${PUBLISH_SLOT.time}:00Z`;
    if (utcParts(iso).weekday === PUBLISH_SLOT.day && new Date(iso) > from) out.push(iso);
  }
  return out;
}

/** Slugs of /blog/{slug}/ links in a chunk of HTML (relative or on the site's own origin). */
export function blogLinkSlugs(html, origin = '') {
  const out = [];
  const host = origin.replace(/\/$/, '');
  for (const m of String(html).matchAll(/<a\b[^>]*?\bhref=(["'])([^"']*)\1/gi)) {
    let href = m[2];
    if (host && href.startsWith(host)) href = href.slice(host.length);
    const s = href.match(/^\/blog\/([^/?#]+)\/?(?:[?#].*)?$/)?.[1];
    if (s) out.push(s);
  }
  return out;
}

/**
 * Post bodies may link to posts that are scheduled but not live yet (a Cluster Lead publishes first and
 * links to its Supporting posts — blog-mode brief rules). Until the target is published, the link is
 * rendered as its plain anchor text; the rebuild that publishes the target turns it into a link.
 * Links to slugs that do not exist at all are a build error (validatePosts), never silently dropped.
 */
export function unwrapUnpublishedLinks(html, publishedSlugs, origin = '') {
  const host = origin.replace(/\/$/, '');
  return String(html).replace(/<a\b([^>]*?)\bhref=(["'])([^"']*)\2([^>]*)>([\s\S]*?)<\/a>/gi, (whole, _a, _q, href, _b, inner) => {
    const path = host && href.startsWith(host) ? href.slice(host.length) : href;
    const s = path.match(/^\/blog\/([^/?#]+)\/?(?:[?#].*)?$/)?.[1];
    return s && !publishedSlugs.has(s) ? inner : whole;
  });
}

/**
 * Cross-reference and schedule rules the content schema cannot express (it sees one file at a time).
 * Returns { errors, warnings }; the blog routes throw on any error, so a bad post fails `npm run build`.
 * EVERY post is checked on EVERY build — published or not — so a mistake in a post scheduled weeks ahead
 * fails the build the day its file is committed.
 *   posts:        [{ id, slug, publishDate, updatedDate?, parent, related[], html, draft }]
 *   parents:      Map(page_id -> { url, label }) — the approved page map (or site.services in the starter)
 *   scheduleFrom: site.blog.scheduleFrom — posts published before it (migrated history) skip the slot rules
 */
export function validatePosts(posts, { parents, scheduleFrom = '' }) {
  const errors = [];
  const warnings = [];
  const slugs = new Set();
  for (const p of posts) {
    if (slugs.has(p.slug)) errors.push(`duplicate slug "${p.slug}"`);
    slugs.add(p.slug);
  }
  for (const p of posts) {
    const where = `${p.id ?? p.slug}.json`;
    if (p.id && p.id !== p.slug) errors.push(`${where}: file name must be the slug ("${p.slug}.json")`);
    if (!parents.has(p.parent)) errors.push(`${where}: parent "${p.parent}" is not a page_id in the page map (${[...parents.keys()].join(', ') || 'no pages'})`);
    const seen = new Set();
    for (const r of p.related ?? []) {
      if (r === p.slug) errors.push(`${where}: related lists the post itself`);
      else if (!slugs.has(r)) errors.push(`${where}: related post "${r}" does not exist`);
      if (seen.has(r)) errors.push(`${where}: related post "${r}" listed twice`);
      seen.add(r);
    }
    for (const s of blogLinkSlugs(p.html)) if (!slugs.has(s)) errors.push(`${where}: body links /blog/${s}/, which is not a post`);
    if (p.updatedDate && new Date(p.updatedDate) < new Date(p.publishDate)) errors.push(`${where}: updatedDate is before publishDate`);
  }
  // The weekly slot (owner decisions 2026-10-14): every non-draft post at Wednesday 06:00 UTC, written in
  // UTC ("Z" or "+00:00"), and one post per Wednesday. Drafts are not scheduled yet.
  const from = scheduleFrom ? new Date(scheduleFrom) : null;
  const byDate = new Map();
  for (const p of posts) {
    if (p.draft || !p.publishDate || Number.isNaN(new Date(p.publishDate).getTime())) continue;
    if (from && new Date(p.publishDate) < from) continue;
    const where = `${p.id ?? p.slug}.json`;
    const u = utcParts(p.publishDate);
    const next = nextSlots(new Date(new Date(p.publishDate).getTime() - 86400000))[0];
    if (!/(Z|\+00:00)$/.test(p.publishDate)) errors.push(`${where}: publishDate ${p.publishDate} is not written in UTC — use "Z", e.g. ${next}`);
    else if (u.weekday !== PUBLISH_SLOT.day || u.time !== PUBLISH_SLOT.time || u.seconds !== '00')
      errors.push(`${where}: publishDate ${p.publishDate} is ${cap(u.weekday)} ${u.date} ${u.time} UTC; posts publish on ${cap(PUBLISH_SLOT.day)} at ${PUBLISH_SLOT.time} UTC — e.g. ${next}`);
    byDate.set(u.date, [...(byDate.get(u.date) ?? []), p.slug]);
  }
  for (const [date, list] of byDate) if (list.length > 1) errors.push(`${list.length} posts are scheduled for ${date} (${[...list].sort().join(', ')}) — one post per ${cap(PUBLISH_SLOT.day)}; move all but one to a later ${cap(PUBLISH_SLOT.day)}`);
  return { errors, warnings };
}

/** Plain-node read of the post files, for scripts that run outside Astro (postbuild, validators, workflow). */
export function loadPostFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((f) => {
    const data = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    return { ...data, id: f.replace(/\.json$/, '') };
  });
}
