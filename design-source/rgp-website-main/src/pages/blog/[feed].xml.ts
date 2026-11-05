/**
 * /blog/rss.xml (§29; a [feed] param so the file is skipped when nothing is published) — PUBLISHED posts only, from the same blogData() as the pages, so a scheduled post
 * is never announced early. Built only when at least one post is published.
 */
import rss from '@astrojs/rss';
import type { APIContext, GetStaticPaths } from 'astro';
import { site } from '../../data/site';
import { blogData } from '../../utils/blog';

export const getStaticPaths = (async () => ((await blogData()).published.length ? [{ params: { feed: 'rss' } }] : [])) satisfies GetStaticPaths;

export async function GET(context: APIContext) {
  const { published } = await blogData();
  return rss({
    title: `${site.name} Blog`,
    description: site.blog.description,
    site: context.site ?? site.siteUrl,
    items: published.map((p) => ({ title: p.title, description: p.description, link: p.url, pubDate: new Date(p.publishDate) })),
  });
}
