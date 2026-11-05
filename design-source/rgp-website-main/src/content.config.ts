/**
 * Content collections (Astro 7 content layer).
 *
 * posts — the client's blog (CORE_CONTRACTS §29). ONE JSON file per post in src/content/posts/, named
 * after its slug: `{slug}.json`. `html` is the approved post body (Final Page Copy in blog mode,
 * converted to HTML; body only — the H1, byline, FAQ section and related links come from the
 * template). The shape is the C&B legacy shape (JSON + html) with the scheduling and linking fields
 * added, so migrated posts map field by field.
 *
 * The schema is strict: an unknown or misspelled field fails the build. Cross-references (parent page
 * in the page map, related slugs, /blog/ links in the body, the Wednesday 06:00 UTC slot, one post per Wednesday)
 * are checked in src/utils/blog.ts → validatePosts(), which also fails the build.
 *
 * BLOG_POSTS_DIR overrides the folder for the blog tests only (tests/blog/fixtures/posts).
 */
import { defineCollection } from 'astro:content';
import { z } from 'astro/zod';
import { glob } from 'astro/loaders';

const slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'lowercase words joined by hyphens').refine((s) => !/^\d+$/.test(s), 'a slug cannot be only digits (those are /blog/{n}/ pagination URLs)');
/** ISO date-time with an explicit zone, e.g. "2026-10-14T06:00:00Z". publishDate must be a Wednesday 06:00 UTC slot (checked at build). */
const dateTime = z.iso.datetime({ offset: true, message: 'use an ISO date-time in UTC, e.g. 2026-10-14T06:00:00Z' });

const posts = defineCollection({
  loader: glob({
    pattern: '*.json',
    base: process.env.BLOG_POSTS_DIR ?? './src/content/posts',
    // id = file name, so validatePosts can require file name === slug (the default would use data.slug).
    generateId: ({ entry }) => entry.replace(/\.json$/, ''),
  }),
  schema: ({ image }) =>
    z
      .object({
        /** Headline = the H1 and the root of the <title> ("{Headline} | {Brand}", §28). Contains the primary keyword. */
        title: z.string().min(1).max(60),
        /** Meta description, ≤ 160 characters, contains the primary keyword (§28). */
        description: z.string().min(1).max(160),
        /** URL is /blog/{slug}/ — from the primary keyword, no dates or IDs (§28). Must equal the file name. */
        slug,
        /** Goes live at the first build at or after this instant (§29). */
        publishDate: dateTime,
        /** Set only for a real content revision; feeds dateModified. */
        updatedDate: dateTime.optional(),
        /**
         * Not shown: the byline, About box and BlogPosting author are ALWAYS the company (site.name; owner
         * decision 2026-10-14 — no person). Kept optional so existing post files stay valid.
         */
        author: z.string().min(1).optional(),
        /** page_id of the parent service/hub page in artifacts/active-page-map.yaml (starter: a site.services id). */
        parent: z.string().min(1),
        /** Cluster name from the Restoration Blogs tab / brief header. */
        cluster: z.string().min(1),
        /** Slugs of the related posts from the brief (Cluster Lead + 2–3 siblings). Unpublished ones are hidden until live. */
        related: z.array(slug).max(8).default([]),
        /** FAQs rendered on the page by FAQSection, which emits FAQPage JSON-LD from this same array (§22). */
        faqs: z.array(z.object({ question: z.string().min(1), answer: z.string().min(1) }).strict()).optional(),
        /** Optional hero image: a path relative to this JSON file, e.g. "../../assets/blog/flooded-basement.jpg". */
        heroImage: image().optional(),
        heroImageAlt: z.string().min(1).optional(),
        /** Optional one-line hero intro (approved copy). */
        intro: z.string().min(1).optional(),
        /** Drafts are never built, whatever their date. */
        draft: z.boolean().default(false),
        /** Approved post body as HTML, starting at the first H2. */
        html: z.string().min(1),
      })
      .strict()
      .refine((p) => !p.heroImage || p.heroImageAlt, { message: 'heroImageAlt is required with heroImage', path: ['heroImageAlt'] }),
});

export const collections = { posts };
