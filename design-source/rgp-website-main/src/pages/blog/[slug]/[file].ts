/**
 * Automatic blog cover files (§29): /blog/{slug}/cover.png (1200×630 — og:image, twitter:image, BlogPosting
 * image) and /blog/{slug}/cover-{480,960}.webp (the 16:9 /blog/ card thumbnail, a left crop of the same
 * render). Built for every PUBLISHED post WITHOUT heroImage — drafts and future posts get nothing, because
 * the list comes from blogData() (the one publish rule). Drawn by src/utils/blog-cover.mjs.
 */
import type { APIRoute, GetStaticPaths } from 'astro';
import { blogData, type Post } from '../../../utils/blog';
import { COVER_FILES, renderCover } from '../../../utils/blog-cover.mjs';

export const getStaticPaths = (async () => {
  const { published, coverOf } = await blogData();
  return published.filter((post) => coverOf(post)).flatMap((post) => COVER_FILES.map((file) => ({ params: { slug: post.slug, file }, props: { post } })));
}) satisfies GetStaticPaths;

export const GET: APIRoute = async ({ props, params }) => {
  const { coverInput } = await blogData();
  const cover = await renderCover(coverInput((props as { post: Post }).post));
  const file = params.file!;
  const body = file === 'cover.png' ? cover.png : cover.cards[Number(file.match(/^cover-(\d+)\.webp$/)![1])];
  return new Response(new Uint8Array(body), { headers: { 'Content-Type': file.endsWith('.png') ? 'image/png' : 'image/webp' } });
};
