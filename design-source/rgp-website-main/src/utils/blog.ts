/**
 * Blog data for the Astro pages (§29). Every blog route, the RSS feed and every related-post list reads
 * posts through blogData(), which applies the ONE publish rule (isPublished, src/utils/blog-schedule.mjs)
 * at the ONE build time — so a scheduled post cannot leak into any list, link or feed.
 *
 * It also fails the build on broken cross-references: a parent that is not in the page map, a related
 * slug or body link to a post that does not exist, or a publishDate that is not Wednesday 06:00 UTC /
 * shares its Wednesday with another post (validatePosts). Every post is validated on every build, whether it is published yet or not.
 */
import { existsSync, readFileSync } from 'node:fs';
import { getCollection, type CollectionEntry } from 'astro:content';
import { parse as parseYaml } from 'yaml';
import { site } from '../data/site';
import { titleCase } from './seo.mjs';
import { buildTime, byNewest, isPublished, postPath, unwrapUnpublishedLinks, validatePosts } from './blog-schedule.mjs';
import { coverLabel, coverUrls, domainOf, readThemeColors } from './blog-cover.mjs';
import { fillRelated } from './blog-related.mjs';

export type Post = CollectionEntry<'posts'>['data'] & { id: string; url: string };
export interface ParentPage { url: string; label: string }

/**
 * Parent pages a post may name: the client's approved page map (artifacts/active-page-map.yaml, every
 * page_id) when it exists; in the starter, which has no page map, the site.services hubs.
 */
function loadParents(): Map<string, ParentPage> {
  const labels = new Map(site.services.map((s) => [s.url, s.label]));
  const mapFile = 'artifacts/active-page-map.yaml';
  if (existsSync(mapFile)) {
    const pages = (parseYaml(readFileSync(mapFile, 'utf8'))?.pages ?? []) as { page_id?: string; url?: string; primary_keyword?: string }[];
    return new Map(
      pages.filter((p) => p.page_id && p.url).map((p) => [String(p.page_id), { url: String(p.url), label: labels.get(String(p.url)) ?? titleCase(p.primary_keyword || String(p.page_id).replace(/-/g, ' ')) }]),
    );
  }
  return new Map(site.services.map((s) => [s.id, { url: s.url, label: s.label }]));
}

let cached: Promise<ReturnType<typeof assemble>> | undefined;

function assemble(entries: CollectionEntry<'posts'>[]) {
  const now = buildTime();
  const all: Post[] = entries.map((e) => ({ ...e.data, id: e.id, url: postPath(e.data.slug) }));
  const parents = loadParents();
  // ALL posts are validated on every build — drafts and future posts included — so a broken post fails
  // the build the day it is committed, not the day it is due.
  const { errors, warnings } = validatePosts(all, { parents, scheduleFrom: site.blog.scheduleFrom });
  if (errors.length) throw new Error(`[blog] ${errors.length} post error(s) — fix the post files (§29):\n  - ${errors.join('\n  - ')}`);
  for (const w of warnings) console.warn(`[blog] ⚠ ${w}`);

  const published = all.filter((p) => isPublished(p, now)).sort(byNewest);
  const live = new Set(published.map((p) => p.slug));
  const bySlug = new Map(published.map((p) => [p.slug, p]));
  return {
    now,
    published,
    parents,
    /**
     * Related posts that are live, in the brief's order (scheduled ones are simply absent) — filled up to 3
     * with other published posts when fewer are live: same parent hub first, then any, newest first
     * (fillRelated, src/utils/blog-related.mjs — owner decision 2026-10-14: never an empty list).
     */
    relatedOf: (p: Post): Post[] =>
      fillRelated({
        chosen: p.related.map((s) => bySlug.get(s)).filter((x): x is Post => Boolean(x)),
        pool: published,
        key: (q: Post) => q.slug,
        self: p.slug,
        sameGroup: (q: Post) => q.parent === p.parent,
      }),
    /** Body HTML with links to scheduled posts reduced to their text until those posts go live. */
    bodyOf: (p: Post) => unwrapUnpublishedLinks(p.html, live, site.siteUrl),
    parentOf: (p: Post) => parents.get(p.parent)!,
    /**
     * The automatic cover (§29) — only for a post WITHOUT heroImage (a post with a photo keeps its photo).
     * URLs of the files src/pages/blog/[slug]/[file].ts renders: og = 1200×630 PNG, card = 16:9 WebP widths.
     */
    coverOf: (p: Post) => (p.heroImage ? undefined : coverUrls(p.url)),
    /** Everything the cover is drawn from: the post title + parent, and the site's brand. Nothing else. */
    coverInput: (p: Post) => {
      const parent = parents.get(p.parent)!;
      return {
        title: p.title,
        label: coverLabel({ id: p.parent, label: parent.label }, site.blog.cover.labels),
        brandName: site.name,
        domain: domainOf(site.siteUrl),
        ...readThemeColors('src/styles/theme.css'),
        logo: site.blog.cover.logo,
        fonts: site.blog.cover.font ? { display: site.blog.cover.font } : undefined,
      };
    },
  };
}

export function blogData() {
  cached ??= getCollection('posts').then(assemble);
  return cached;
}
