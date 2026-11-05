#!/usr/bin/env node
/**
 * Post-build — CORE_CONTRACTS §21: /sitemap.xml, robots.txt, and /llms.txt.
 *
 * All three are DERIVED from the finished build and from src/data/site.ts, so they cannot drift
 * from what actually shipped. Runs automatically inside `npm run build`; a client build configures
 * NOTHING here — `site.siteUrl` and `site.previewMode` drive everything.
 *
 * - @astrojs/sitemap emits sitemap-index.xml; §21 requires /sitemap.xml itself to be a REAL XML
 *   endpoint (never a redirect shell or meta-refresh page), so the index is copied to /sitemap.xml.
 * - robots.txt follows site.previewMode: Disallow-all pre-launch; Allow + Disallow /templates/ live.
 * - /llms.txt (llmstxt.org format): business facts from site.ts — approved copy only, never
 *   invented — and links ONLY to routes that exist in dist/, discovered after the build.
 * - §29 blog schedule: FAILS the build when a scheduled/draft post was built, a due post was not, or
 *   anything in the output references an unpublished post (scripts/lib/blog-checks.mjs), or a post with
 *   draft:false has no passing QA record in docs/blog/qa/{slug}.md (scripts/lib/blog-qa.mjs, §29 QA record),
 *   or a published post page lacks the company byline / About box, or (3+ body H2s) an "In this article" TOC
 *   whose links all resolve to H2 ids on the page.
 * - §28 /search-manifest.json: every sitemap URL → a fingerprint of the page's meaningful HTML, plus the commit
 *   (scripts/lib/search-manifest.mjs). After each production deploy, "Tell search engines" (search-notify.yml)
 *   compares it with the last announced one and sends only the changed pages to IndexNow.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { site } from './src/data/site.ts';
import { cities } from './src/data/cities.ts';
import { checkBlogBuild } from './scripts/lib/blog-checks.mjs';
import { QA_DIR, checkQaRecords } from './scripts/lib/blog-qa.mjs';
import { MANIFEST_FILE, buildManifest } from './scripts/lib/search-manifest.mjs';
import { serviceAreasSection } from './scripts/lib/llms-service-areas.mjs';

// Output folder: `dist` for every real build; the blog tests pass their own (tests/blog).
const dist = process.argv[2] || 'dist';
const index = join(dist, 'sitemap-index.xml');
if (!existsSync(index)) {
  console.error('[postbuild] FAIL: sitemap-index.xml missing — did the sitemap integration run? (astro.config `site` must be set)');
  process.exit(1);
}
// Origin: site.siteUrl, else the origin the sitemap was built with (astro.config `site`).
const ORIGIN = (
  site.siteUrl ?? readFileSync(index, 'utf8').match(/<loc>(https?:\/\/[^/<]+)/)?.[1] ?? 'https://example.com'
).replace(/\/$/, '');

// --- §21: /sitemap.xml as a real XML file --------------------------------------------------
writeFileSync(join(dist, 'sitemap.xml'), readFileSync(index));
const children = readdirSync(dist).filter((f) => /^sitemap-\d+\.xml$/.test(f));
const urls = children.reduce(
  (n, f) => n + (readFileSync(join(dist, f), 'utf8').match(/<loc>/g) ?? []).length,
  0,
);

// --- robots.txt, from the same single launch switch the pages use (§17) --------------------
const preview = site.previewMode === true;
writeFileSync(
  join(dist, 'robots.txt'),
  preview
    ? `# PRE-LAUNCH: site.previewMode is true, so every page is noindex,nofollow.\n` +
      `# Set site.previewMode to false and rebuild to launch; this file regenerates every build.\n` +
      `User-agent: *\nDisallow: /\n\nSitemap: ${ORIGIN}/sitemap.xml\n`
    : `User-agent: *\nAllow: /\n\n` +
      `# Internal component-preview routes: noindex,nofollow and excluded from the sitemap (§17).\n` +
      `Disallow: /templates/\n\nSitemap: ${ORIGIN}/sitemap.xml\n`,
);

// --- IndexNow key file (§28 launch step) ---------------------------------------------------------
// IndexNow proves site ownership with a text file named after the key, at the root, containing
// the key. The key comes from site.indexNow.key; `npm run indexnow:submit` uses the same value.
const indexNowKey = site.indexNow?.key ?? '';
if (indexNowKey) {
  if (!/^[A-Za-z0-9-]{8,128}$/.test(indexNowKey)) {
    console.error('[postbuild] FAIL: site.indexNow.key must be 8–128 letters, digits, or dashes (IndexNow spec)');
    process.exit(1);
  }
  writeFileSync(join(dist, `${indexNowKey}.txt`), indexNowKey);
}

// --- §28 search manifest (post-deploy "Tell search engines" job) --------------------------------------
// Fingerprints of the finished pages (scripts/lib/search-manifest.mjs). It names the commit so the post-deploy job
// can wait until the production domain serves THIS build (Vercel sets VERCEL_GIT_COMMIT_SHA when "Automatically
// expose System Environment Variables" is on — the default). Public by design: URLs + hashes, nothing secret.
const searchManifest = buildManifest({
  dist,
  origin: ORIGIN,
  commit: process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA || null,
  deploymentId: process.env.VERCEL_DEPLOYMENT_ID || null,
  previewMode: preview,
  indexNowKey,
});
writeFileSync(join(dist, MANIFEST_FILE), JSON.stringify(searchManifest.manifest));
for (const u of searchManifest.missing) console.warn(`[postbuild] ⚠ search manifest: ${u} is in the sitemap but no built page was found for it`);

// --- /llms.txt -----------------------------------------------------------------------------
const built = (route) => existsSync(join(dist, route.replace(/^\//, ''), 'index.html'));
const titleOf = (route) => {
  const f = join(dist, route.replace(/^\//, ''), 'index.html');
  if (!existsSync(f)) return null;
  const m = readFileSync(f, 'utf8').match(/<title>([^<]*)<\/title>/);
  return m ? m[1].split('|')[0].trim().replace(/&amp;/g, '&') : null;
};
const childrenOf = (route) => {
  const dir = join(dist, route.replace(/^\//, ''));
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(dir, d.name, 'index.html')))
    .map((d) => `${route}${d.name}/`);
};
const link = (route, label) => `- [${label ?? titleOf(route) ?? route}](${ORIGIN}${route})`;

let llms = `# ${site.name}\n\n> ${site.footerBlurb}\n\n`;
if (site.legalName && site.legalName !== site.name) llms += `Legal name: ${site.legalName}\n`;
llms += `Phone: ${site.phoneDisplay}\n`;
for (const loc of site.locations) llms += `Location: ${loc.name}${loc.legalName && loc.legalName !== loc.name ? ` (${loc.legalName})` : ''} — ${loc.address} — ${loc.phone}\n`;
llms += `Availability: ${site.emergencyAvailability}\n\n`;

const services = site.services.filter((s) => built(s.url));
if (services.length) {
  llms += `## Services\n\n`;
  for (const s of services) {
    llms += `${link(s.url, s.label)}\n`;
    for (const c of childrenOf(s.url)) {
      const t = titleOf(c);
      if (t) llms += `  - [${t}](${ORIGIN}${c})\n`;
    }
  }
  llms += '\n';
}

// City hubs in each city's own state; the city-service claim only where those pages exist (scripts/lib/llms-service-areas.mjs).
const { text: serviceAreas, hubs } = serviceAreasSection({ cities, origin: ORIGIN, built, childrenOf, link });
llms += serviceAreas;

const company = ['/about/', '/contact/', '/reviews/', '/blog/'].filter(built);
if (company.length) {
  llms += `## Company\n\n`;
  for (const r of company) llms += `${link(r)}\n`;
  llms += '\n';
}

llms += `## Optional\n\n- [Sitemap](${ORIGIN}/sitemap.xml)\n`;
for (const r of ['/privacy-policy/', '/terms/'].filter(built)) llms += `${link(r)}\n`;
writeFileSync(join(dist, 'llms.txt'), llms);

// --- §29 blog schedule ------------------------------------------------------------------------
const blog = checkBlogBuild({ dist, postsDir: process.env.BLOG_POSTS_DIR ?? 'src/content/posts', companyName: site.name });
for (const n of blog.notes) console.warn(`[postbuild] ⚠ blog: ${n}`);
// §29 QA record: every post with draft:false has docs/blog/qa/{slug}.md with "Verdict: Ready" + "Reviewer:".
const qa = checkQaRecords({ postsDir: process.env.BLOG_POSTS_DIR ?? 'src/content/posts', qaDir: process.env.BLOG_QA_DIR ?? QA_DIR });
if (blog.errors.length || qa.errors.length) {
  for (const e of blog.errors) console.error(`[postbuild] FAIL: blog: ${e}`);
  for (const e of qa.errors) console.error(`[postbuild] FAIL: blog QA record: ${e}`);
  process.exit(1);
}

const llmsLinks = llms.split('\n').filter((l) => /^\s*- \[/.test(l)).length;
console.log(
  `[postbuild] sitemap.xml (${children.length} child, ${urls} URLs) · ` +
    `robots.txt (${preview ? 'PRE-LAUNCH Disallow /' : 'LIVE Allow /, templates disallowed'}) · ` +
    `llms.txt (${llmsLinks} links, ${hubs.length} city hubs, ${services.length} service hubs) · ` +
    `IndexNow key file ${indexNowKey ? 'written' : 'not set (site.indexNow.key)'} · ` +
    `search-manifest.json (${Object.keys(searchManifest.manifest.pages).length} pages${searchManifest.manifest.commit ? `, commit ${searchManifest.manifest.commit.slice(0, 7)}` : ', no commit'}) · ` +
    `blog ${blog.posts ? `${blog.published}/${blog.posts} posts live at ${blog.buildTime}, ${blog.covers} automatic cover(s), company author + TOC on ${blog.pagesChecked} post page(s), no links to unpublished posts, ${qa.checked} non-draft post(s) with a Ready QA record` : 'no posts'}`,
);
