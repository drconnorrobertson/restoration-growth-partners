#!/usr/bin/env node
/**
 * validate-built-html.mjs — layer-2 validator against the BUILT site (dist/).
 *
 * Catches the failure class that only exists in the assembled artifact, where
 * two upstream authorities are each correct in isolation (added 2026-08-28
 * after the pilot rendered duplicate process sections on all four parent hubs:
 * §12 mandates the shared post-body process section, the master briefs mandate
 * an in-article process H2, and nothing reconciled them).
 *
 * Checks per page:
 *   1. §12 precedence — a page never carries two process narratives:
 *      - the shared process section (data-section="process") mounted more than once
 *      - the shared process section present AND an in-article H2 naming a process
 *   2. §7 banned / placeholder language in rendered VISIBLE text (attribute
 *      text like input placeholders is ignored — only what a visitor reads).
 *   3. §15 dead internal links — every internal <a href="/..."> must resolve to
 *      a built route or file in dist/ (404.html exempt — its links are the shell's). Added 2026-08-28 after a build shipped
 *      mega-menu and service-area links to ~50 city hubs that did not exist yet,
 *      404ing on every page. Never wire nav to routes that are not built.
 *
 *   5. §18 images — every <img> on a production page has width, height, and alt (alt=""
 *      only when aria-hidden/presentational); no raw .jpg/.png/.gif outside the optimized
 *      /_astro/ output (agency assets under /logos/ are the documented exception); any image
 *      inside the hero (data-page-hero) or marked fetchpriority="high" is never lazy-loaded —
 *      the LCP image must load eagerly.
 *   6. §11 forms — every production page carries the shared request form
 *      (data-component="request-service") and at least one tap-to-call tel: link.
 *   7. §26 site identity — every production page links favicon-32/192 + apple-touch-icon and carries
 *      og:image, each resolving to a built file; while public/site-identity.json says the set is the
 *      starter placeholder: WARN in preview, FAIL with --launch. Added 2026-09-14 after a site launched
 *      with no favicon at all — the rule existed only as a QA checklist line.
 *   8. §28 page SEO — every production page has exactly one <h1>; a <title> of at most 60 characters
 *      and a meta description of at most 160, neither empty nor duplicated anywhere on the site; an
 *      absolute self canonical equal to og:url; and JSON-LD that parses, with every LocalBusiness
 *      carrying a name and a street address. When the client's artifacts/active-page-map.yaml gives a
 *      page a primary_keyword, its title, meta description, H1, and first H2 must each contain that
 *      keyword and the page's city. Added 2026-09-30 after an audit of all 119 master briefs found 80
 *      titles over 60 characters and 89 descriptions over 160, with nothing checking either.
 *      §22 additions (2026-10-05): a page that shows FAQs (FAQSection or an H2 naming FAQs) has exactly
 *      one FAQPage, and every question in it is visible; every inner page has one BreadcrumbList from
 *      the homepage to itself whose links all resolve to built pages.
 *   9. Launch only (--launch): the IndexNow key file is in the build and PostHog loads on every page
 *      (§28 launch steps; site.indexNow.key and site.posthog.projectKey). Every lead form posts to
 *      hosting.json leadRouter.url + /submit with a client id, and artifacts/launch/lead-delivery.md exists (§27).
 *  10. §28 PageSpeed + Agentic Browsing hygiene — the static form of the Lighthouse findings that
 *      recurred across client sites' PageSpeed fix logs (2026-10), so they fail here before launch
 *      instead of in PageSpeed after it. Runs on template routes too (they render the shared components).
 *      - Agent accessibility tree / Accessibility: focusable content inside aria-hidden (not inert);
 *        aria-label on a generic element (div/span/p) with no role; links and buttons with no
 *        accessible name; form fields with no label; duplicate ids; positive tabindex; role=img SVGs
 *        and iframes with no name; html lang, charset, a zoomable viewport.
 *      - WebMCP: a form with toolname must have tooldescription (and vice versa), unique tool names,
 *        and a name + toolparamdescription on every agent-fillable field; lead forms must be tools.
 *      - SEO: generic link text ("learn more", "read more", "click here"…), javascript: links.
 *      - Performance: third-party or Leaflet stylesheets in <head>; parser-blocking <script src>;
 *        Elfsight/Leaflet loaded in the initial HTML; unused preconnects; iframes not lazy; videos
 *        that download during load.
 *      - §19 script placement table (scripts/lib/script-placement-checks.mjs, added 2026-10-28): GA4/GTM loader
 *        in <head>, immediate (async; never a timer, load/first-input listener, approach observer or
 *        non-JS type like text/partytown); LeadConnector call tracking (number_pool.js/user_session.js) a
 *        plain <script defer src> at the end of <body>, never injected; no google-site-verification /
 *        msvalidate.01 <meta> (verification is by file, §28). Chat widgets at page load (Distance and the
 *        other known vendors; call-tracking scripts are not chat) stay a WARNING — §19 keeps page-load chat
 *        an accepted risk recorded in artifacts/perf/accepted-risks.yaml.
 *      - Turnstile (§11): no page loads challenges.cloudflare.com/turnstile/v0/api.js in a <script src> or
 *        hints that origin at load; a page with a widget carries BaseLayout's on-interaction loader
 *        (scripts/lib/turnstile-checks.mjs). Added 2026-10-15: api.js on every page view was a mobile
 *        speed cost on every client site, for a form most visitors never touch.
 *      - Forms (§11/§27, scripts/lib/form-checks.mjs, added 2026-10-28 with the Careers + Partner forms): no form asks
 *        for sensitive personal data (a field or label like a driver's licence/permit NUMBER, SSN, date of birth,
 *        bank/card/account number); every lead form carries the router contract fields and one of the three standard
 *        form_types (request_service, career_application, partner_enquiry) matching its data-form-type; file uploads
 *        only as a careers form's résumé / cover letter in a multipart post. Launch adds: every lead form posts to the
 *        router with a client id AND a spam-check widget; a Careers/Partner form is connected (leadrouter:setup).
 *      - Production pages only: HTML weight (warn 150 KB, fail 300 KB), element count (warn 1,500,
 *        fail 3,000), links inside hidden subtrees (warn 150, fail 400), the unoptimized CSS hero
 *        background (warn; fail with --launch).
 *      - Site-wide: fonts over 80 KB or not woff2, images over 400 KB, raster logos over 100 KB, and
 *        llms.txt in the shape Lighthouse's llms-txt audit passes (an H1, a link, 50+ characters).
 *  11. §29 blog schedule — no draft or future-dated post was built, every due post was, and nothing in
 *      the output (pages, sitemap, RSS, llms.txt, JSON) references an unpublished post's /blog/ URL
 *      (scripts/lib/blog-checks.mjs; postbuild runs the same check so the build itself fails), and every
 *      post with draft:false has a passing QA record docs/blog/qa/{slug}.md (scripts/lib/blog-qa.mjs), and
 *      every published post page has the company byline + About box and, with 3+ body H2s, an "In this
 *      article" TOC whose links all resolve to H2 ids on the page.
 *  12. §30 agency footer credit — every production page (404 included) carries exactly one visible
 *      footer credit reading "Website Design, Development, & AI SEO by Restoration Growth Partners", its
 *      one link to the agency homepage followed (no nofollow/sponsored/ugc/noreferrer)
 *      (scripts/lib/agency-credit-checks.mjs). Added 2026-10-20 (owner decision).
 *  13. §28 search manifest — /search-manifest.json exists, is valid, and lists exactly the sitemap's URLs, each with
 *      a page fingerprint (postbuild.mjs, scripts/lib/search-manifest.mjs); with --launch it must not say previewMode.
 *      The post-deploy "Tell search engines" job reads it to send IndexNow only the changed pages. Added 2026-10-26.
 *   4. §17 index state — /templates/ routes and 404.html must ALWAYS be noindex; every other
 *      page must be indexable at launch. Pre-launch, site.previewMode noindexes
 *      the whole site (one switch, never per-page markup) — that's a WARNING in
 *      default mode and an ERROR with --launch (`npm run validate:launch`), which
 *      also requires /robots.txt, /sitemap.xml, and /llms.txt in the build (§21). Added 2026-08-28
 *      after a build pasted noindex into 54 page files with no rule mandating it
 *      and no stage removing it — the site could have launched invisible.
 *
 * Usage: node scripts/validate-built-html.mjs [distDir] [--launch]
 * Run AFTER `astro build` — `npm run check:built` does both; `npm run
 * validate:launch` is the pre-launch gate.
 * /templates/ preview routes are checked ONLY for required noindex.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, basename } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { checkBlogBuild } from './lib/blog-checks.mjs';
import { QA_DIR, checkQaRecords } from './lib/blog-qa.mjs';
import { checkTurnstileLoading } from './lib/turnstile-checks.mjs';
import { checkLeadForms } from './lib/form-checks.mjs';
import { checkScriptPlacement } from './lib/script-placement-checks.mjs';
import { checkAgencyCredit } from './lib/agency-credit-checks.mjs';
import { findUkSpellings, readExceptions, usEnglishMessage } from './lib/us-english.mjs';
import { MANIFEST_FILE, builtSitemapUrls, parseManifest } from './lib/search-manifest.mjs';
import { SEO_LIMITS, containsPhrase, decodeEntities, locationLabel, allowedTitles, suggestTitleRule, KEYWORD_PAGE_TYPES, LOCAL_PAGE_TYPES } from '../src/utils/seo.mjs';

const argv = process.argv.slice(2);
const LAUNCH = argv.includes('--launch');
const DIST = argv.find((a) => !a.startsWith('--')) || 'dist';

// §28: the client's approved page map (never the starter's examples/ fixtures) supplies each page's
// primary keyword and city, so the built page can be checked against the rule it was built from.
const pageMapPath = join(DIST, '..', 'artifacts', 'active-page-map.yaml');
let pageMap = null;
let pageMapError = null;
if (existsSync(pageMapPath)) {
  try { pageMap = parseYaml(readFileSync(pageMapPath, 'utf8')); }
  catch (e) { pageMapError = e.message; }
}
const mapPages = new Map((pageMap?.pages ?? []).filter((p) => p?.url).map((p) => [p.url, p]));
const titlesSeen = new Map(); // title -> [pages]
const metasSeen = new Map();  // description -> [pages]

// Keep in sync with BANNED in validate-artifacts.mjs (§7).
const BANNED = [
  'service architecture', 'approved rollout', 'source reserved',
  'review source reserved', 'widget-ready', 'launch input', 'proof plan',
  'city-service pages are deferred', 'lorem ipsum', 'placeholder', 'todo:',
];

// Starter demo data that must never reach a client page. Warn in preview mode (the starter's own
// 404 carries it by design); FAIL with --launch. Added 2026-09-11 after 617 client pages were built
// with "Example Restoration Co." in the header and footer.
// §7 US English proper-noun exceptions (artifacts/us-english-exceptions.txt in the client repo).
const US_EXCEPTIONS = readExceptions(join(DIST, '..'));

const PLACEHOLDERS = ['example restoration co', '(555) 000-1234', 'example city', 'northtown', 'southville', 'example county', 'example logo'];
const placeholderPages = new Map(); // phrase -> Set(pages)

let errors = 0;
let warnings = 0;
const err = (file, msg) => { errors++; console.error(`  ✗ ${file}: ${msg}`); };
const warn = (msg) => { warnings++; console.warn(`  ⚠ ${msg}`); };

if (!existsSync(DIST)) {
  console.error(`✗ ${DIST}/ not found — run \`npm run build\` first (or \`npm run check:built\`).`);
  process.exit(1);
}
if (pageMapError) err('artifacts/active-page-map.yaml', `failed to parse — ${pageMapError} (§28 keyword checks need it)`);

/** §28 location for a page-map page: its own city for city pages, else the root-service target area. */
const pageCity = (p) => String(p.city || pageMap?.meta?.primary_service_page_target_area || '').replace(/,\s*[A-Z]{2}$/, '').trim();
const textOf = (fragment) => decodeEntities(stripTagsLite(fragment)).replace(/\s+/g, ' ').trim();
function stripTagsLite(s) { return String(s).replace(/<[^>]+>/g, ' '); }

function* htmlFiles(dir) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) yield* htmlFiles(p);
    else if (entry.endsWith('.html')) yield p;
  }
}

const stripTags = (s) => s.replace(/<[^>]+>/g, ' ');

// --- §15: index everything the build produced, so links can be resolved -----
const routes = new Set(); // page URLs, '/foo/' style
const built = new Set();  // every emitted file, '/logos/x.png' style
function* allFiles(dir) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) yield* allFiles(p);
    else yield p;
  }
}
for (const f of allFiles(DIST)) {
  const rel = '/' + relative(DIST, f).split('\\').join('/');
  built.add(rel);
  if (rel.endsWith('/index.html')) routes.add(rel.slice(0, -'index.html'.length));
  else if (rel.endsWith('.html')) routes.add(rel);
}
const resolves = (href) => {
  const h = href.replace(/[?#].*$/, '');
  if (h === '' || h === '/') return true;
  return routes.has(h) || routes.has(h.endsWith('/') ? h : `${h}/`) || built.has(h);
};
const EXTERNAL = /^(https?:)?\/\/|^(tel:|mailto:|sms:|javascript:|#)/;
const deadLinks = new Map(); // href -> Set of pages linking it
const noindexPages = [];

// --- 10. §28 PageSpeed + Agentic Browsing hygiene -----------------------------------------------
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
// axe aria-prohibited-attr: aria-label/labelledby are not allowed on these roles (generic elements).
const GENERIC_TAGS = new Set(['div', 'span', 'p', 'b', 'i', 'u', 's', 'em', 'strong', 'small', 'code', 'del', 'ins', 'sub', 'sup', 'pre']);
const NAMELESS_ROLES = new Set(['generic', 'presentation', 'none', 'paragraph', 'caption', 'code', 'deletion', 'emphasis', 'insertion', 'strong', 'subscript', 'superscript']);
// Lighthouse link-text (SEO) blocklist, English.
const GENERIC_LINK_TEXT = new Set(['click here', 'click this', 'go', 'here', 'information', 'learn more', 'more', 'more info', 'more information', 'right here', 'read more', 'see more', 'start', 'this']);
const UNLABELED_INPUT_TYPES = new Set(['hidden', 'submit', 'button', 'reset', 'image']);
// Must never be in the initial HTML: each component injects it on approach.
const LAZY_ONLY = [
  [/elfsightcdn\.com\/platform\.js|apps\.elfsight\.com\/p\/platform\.js/, 'Elfsight platform.js', 'ReviewSection injects it when a widget nears the viewport (§16)'],
  [/leaflet[^"']*\.(js|css)/i, 'Leaflet', 'the map components import it when a map nears the viewport (§15)'],
];
const BUDGET = { htmlWarn: 150 * 1024, htmlFail: 300 * 1024, elementsWarn: 1500, elementsFail: 3000, hiddenLinksWarn: 150, hiddenLinksFail: 400 };

function parseAttrs(s) {
  const a = {};
  for (const m of s.matchAll(/([^\s=/"'>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) a[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? '';
  return a;
}
const describe = (tag, a) => `<${tag}${a.id ? ` id="${a.id}"` : ''}${a.class ? ` class="${a.class.slice(0, 50)}${a.class.length > 50 ? '…' : ''}"` : ''}${a.href ? ` href="${a.href.slice(0, 50)}"` : ''}>`;
const isFocusable = (tag, a) => {
  if ('tabindex' in a) return Number(a.tabindex) >= 0;
  if ('disabled' in a && ['button', 'input', 'select', 'textarea'].includes(tag)) return false;
  if (tag === 'a' || tag === 'area') return 'href' in a;
  if (tag === 'input') return a.type !== 'hidden';
  if (tag === 'video' || tag === 'audio') return 'controls' in a;
  return ['button', 'select', 'textarea', 'iframe', 'summary'].includes(tag) || a.contenteditable === '' || a.contenteditable === 'true';
};
// Tailwind `hidden` with no responsive display utility = display:none at every width.
const classHidden = (c = '') => /(^|\s)hidden(\s|$)/.test(c) && !/\b(sm|md|lg|xl|2xl):(block|flex|grid|inline|inline-block|inline-flex|table|contents)\b/.test(c);

/**
 * Walks the page with an element stack (Astro output is well-formed). Returns stats for the budgets.
 * `report(msg)` is an error, `soft(msg)` a warning; both are de-duplicated per page.
 */
function hygiene(file, html, { production }) {
  const seen = new Set();
  const report = (msg) => { if (!seen.has(msg)) { seen.add(msg); err(file, msg); } };
  const soft = (msg) => { if (!seen.has(msg)) { seen.add(msg); warn(`${file}: ${msg}`); } };

  // Document basics (Accessibility html-has-lang, meta-viewport; Best Practices charset/doctype).
  if (!/^\s*<!doctype html>/i.test(html)) report('missing <!doctype html> (Best Practices)');
  if (!/<meta\s+charset=/i.test(html)) report('missing <meta charset> (Best Practices)');
  if (!/<html\b[^>]*\blang="[a-z]{2}/i.test(html)) report('<html> has no lang attribute (Accessibility html-has-lang)');
  const viewport = html.match(/<meta[^>]*name="viewport"[^>]*content="([^"]*)"/i)?.[1];
  if (!viewport) report('missing <meta name="viewport"> (mobile rendering)');
  else if (/user-scalable\s*=\s*(no|0)/i.test(viewport) || Number(viewport.match(/maximum-scale\s*=\s*([\d.]+)/i)?.[1] ?? 5) < 5)
    report(`viewport "${viewport}" blocks zoom (Accessibility meta-viewport)`);

  // Render-blocking and eager third parties (Performance).
  for (const [, attrs] of html.matchAll(/<link\b([^>]*)>/gi)) {
    const a = parseAttrs(attrs);
    const rel = (a.rel ?? '').toLowerCase();
    if (rel === 'stylesheet' && a.media !== 'print') {
      if (/^(https?:)?\/\//.test(a.href ?? '')) report(`third-party stylesheet ${a.href} blocks first paint — self-host it or load it from the component that needs it (§28)`);
      for (const [re, what, how] of LAZY_ONLY) if (re.test(a.href ?? '')) report(`${what} stylesheet linked in the initial HTML (${a.href}) — render-blocking; ${how}`);
    }
  }
  for (const [, attrs] of html.matchAll(/<script\b([^>]*)>/gi)) {
    const a = parseAttrs(attrs);
    if (!a.src) continue;
    if (!('async' in a) && !('defer' in a) && a.type !== 'module') report(`parser-blocking <script src="${a.src}"> — add defer (or async) (§28)`);
    for (const [re, what, how] of LAZY_ONLY) if (re.test(a.src)) report(`${what} loaded in the initial HTML (${a.src}) — ${how}`);
  }
  // Preconnect / dns-prefetch must point at an origin the initial HTML actually requests (the hint's
  // own href is one match, so one match = unused). Origins only a lazy widget uses count as unused.
  const hints = [...html.matchAll(/<link\b[^>]*rel="(preconnect|dns-prefetch)"[^>]*>/gi)];
  for (const [tag] of hints) {
    const origin = tag.match(/href="((?:https?:)?\/\/[^/"]+)/i)?.[1]?.replace(/^\/\//, 'https://').toLowerCase();
    if (!origin) continue;
    const count = [...html.matchAll(new RegExp(`(?:src|href|srcset|poster|data-src)="${origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'gi'))].length;
    if (count <= 1) report(`unused preconnect/dns-prefetch to ${origin} — nothing in the initial HTML loads from it (PageSpeed "unused preconnect") (§28)`);
  }
  if (hints.length > 4) soft(`${hints.length} preconnect/dns-prefetch hints — Lighthouse recommends at most 4`);
  // Turnstile: api.js only on first lead-form interaction, never at load; no hints to its origin (§11/§28).
  for (const msg of checkTurnstileLoading(html)) report(msg);
  // Forms: no sensitive personal data, router contract + standard form_type on every lead form, uploads careers-only (§11/§27).
  for (const msg of checkLeadForms(html)) report(msg);
  // §19 script placement table: GA/GTM never delayed, call tracking defer at the end of <body>, verification
  // by file only (errors); chat at page load (warning — §19 keeps it an accepted risk). Chat vendors live in the lib.
  { const placement = checkScriptPlacement(html); for (const msg of placement.errors) report(msg); for (const msg of placement.warnings) soft(msg); }
  if (html.includes('data-unoptimized-hero-background')) {
    const msg = 'hero background is a raw CSS url() string — pass an imported image so HeroImage serves AVIF/WebP at the right size (§18; PageSpeed flagged unoptimized hero posters)';
    if (production && LAUNCH) report(msg); else if (production) soft(msg);
  }

  // Element walk.
  const stack = [{ tag: '#root', a: {}, ariaHidden: false, inert: false, gone: false, form: null }];
  const ids = new Map();
  const labelFor = new Set();
  const needsLabel = []; // [id, descriptor]
  const labelledby = []; // ids referenced by aria-labelledby
  const toolNames = new Map();
  let elements = 0;
  let hiddenLinks = 0;
  const re = /<!--[\s\S]*?-->|<(script|style|template|textarea)\b([^>]*)>([\s\S]*?)<\/\1\s*>|<\/([a-zA-Z][\w:-]*)\s*>|<([a-zA-Z][\w:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>|([^<]+)/g;
  const close = (tag) => {
    const i = stack.findLastIndex((n) => n.tag === tag);
    if (i <= 0) return;
    while (stack.length > i) {
      const n = stack.pop();
      if (n.acc !== undefined) checkName(n);
    }
  };
  const addText = (t) => { for (const n of stack) if (n.acc !== undefined && !stack.at(-1).ariaHidden) n.acc += ` ${t}`; };
  function checkName(n) {
    if (n.ariaHidden || n.gone) return;
    const text = decodeEntities(n.acc).replace(/\s+/g, ' ').trim();
    const name = (n.a['aria-label'] ?? '').trim() || (n.a['aria-labelledby'] ? '(labelledby)' : '') || (n.a.title ?? '').trim() || text;
    if (!name) report(`${describe(n.tag, n.a)} has no accessible name — add visible text or aria-label (Accessibility/agent tree ${n.tag === 'a' ? 'link-name' : 'button-name'})`);
    if (n.tag === 'a' && GENERIC_LINK_TEXT.has(text.toLowerCase().replace(/[.…→›»\s]+$/u, '')))
      report(`link text "${text}" is generic — name the destination, e.g. "Water damage restoration details" (SEO link-text)`);
  }
  for (const m of html.matchAll(re)) {
    const [whole, rawTag, rawAttrs, rawBody, closeTag, openTag, openAttrs, text] = m;
    if (whole.startsWith('<!--')) continue;
    if (text !== undefined) { if (text.trim()) addText(text); continue; }
    if (closeTag) { close(closeTag.toLowerCase()); continue; }
    const tag = (rawTag ?? openTag).toLowerCase();
    const a = parseAttrs(rawAttrs ?? openAttrs ?? '');
    const parent = stack.at(-1);
    elements++;
    const node = {
      tag, a,
      ariaHidden: parent.ariaHidden || a['aria-hidden'] === 'true',
      inert: parent.inert || 'inert' in a,
      gone: parent.gone || 'hidden' in a || /display\s*:\s*none/i.test(a.style ?? '') || classHidden(a.class),
      form: tag === 'form' ? (a.toolname || a.tooldescription ? a : null) : parent.form,
    };
    if (a.id) ids.set(a.id, (ids.get(a.id) ?? 0) + 1);
    if (a['aria-labelledby']) labelledby.push(...a['aria-labelledby'].split(/\s+/));
    if (tag === 'label' && a.for) labelFor.add(a.for);
    const d = describe(tag, a);

    if (isFocusable(tag, a) && node.ariaHidden && !node.inert && !node.gone)
      report(`${d} is focusable inside aria-hidden="true" — add inert to the hidden container (Accessibility/agent tree aria-hidden-focus)`);
    if (GENERIC_TAGS.has(tag) && (a['aria-label'] || a['aria-labelledby']) && (!a.role || NAMELESS_ROLES.has(a.role)))
      report(`${d} has aria-label but no role — give it a role (e.g. role="group"/"region") or move the label (Accessibility/agent tree aria-prohibited-attr)`);
    if (Number(a.tabindex) > 0) report(`${d} has tabindex="${a.tabindex}" — positive tabindex breaks focus order (agent tree tabindex)`);
    if ((a.role === 'presentation' || a.role === 'none') && isFocusable(tag, a)) report(`${d} is focusable but role="${a.role}" (agent tree presentation-role-conflict)`);
    if (tag === 'svg' && a.role === 'img' && !a['aria-label'] && !a['aria-labelledby'] && !html.slice(m.index, html.indexOf('</svg>', m.index)).includes('<title'))
      report(`${d} role="img" has no aria-label or <title> (agent tree svg-img-alt)`);
    if (tag === 'a' && /^javascript:/i.test(a.href ?? '')) report(`${d} uses a javascript: link — not crawlable (SEO crawlable-anchors)`);
    if (tag === 'iframe') {
      if (!a.title) report(`${d} iframe has no title (Accessibility frame-title)`);
      if (a.loading !== 'lazy') report(`${d} iframe is not loading="lazy" — embeds (maps, video) download during load (§28)`);
    }
    if (tag === 'video') {
      const hasSrc = Boolean(a.src) || /<source\b[^>]*\ssrc=/i.test(rawBody ?? html.slice(m.index, html.indexOf('</video>', m.index)));
      if (hasSrc && ('autoplay' in a || !['none', 'metadata'].includes(a.preload)))
        report(`${d} video downloads during page load — use Hero backgroundVideo (source attached after load, skipped for reduced motion/data saver) or preload="none" (§28)`);
      if (!a.poster) soft(`${d} video has no poster image`);
    }
    if (production && tag === 'a' && node.gone) hiddenLinks++;

    // Form labels + WebMCP fields.
    const field = (tag === 'input' && !UNLABELED_INPUT_TYPES.has(a.type ?? 'text')) || tag === 'select' || tag === 'textarea';
    if (field && !node.gone) {
      const inLabel = stack.some((n) => n.tag === 'label');
      if (!a['aria-label'] && !a['aria-labelledby'] && !a.title && !inLabel) {
        if (a.id) needsLabel.push([a.id, d]);
        else report(`${d} form field has no label (Accessibility/agent tree label)`);
      }
    }
    if (field && parent.form) {
      if (!a.name) report(`${d} field in WebMCP form "${parent.form.toolname}" has no name — agents cannot fill it (webmcp-schema-validity)`);
      if (!a.toolparamdescription) report(`${d} field in WebMCP form "${parent.form.toolname}" has no toolparamdescription — Lighthouse scores it 0.5, not a pass (webmcp-schema-validity)`);
    }
    if (tag === 'form') {
      const hasName = Boolean(a.toolname), hasDesc = Boolean(a.tooldescription);
      if (hasName !== hasDesc) report(`${d} has ${hasName ? 'toolname without tooldescription' : 'tooldescription without toolname'} (webmcp-schema-validity)`);
      if ('data-lead-form' in a && !hasName) report(`${d} lead form is not a WebMCP tool — add toolname + tooldescription (RequestServicePanel does; §28 Agentic Browsing)`);
      if (hasName && !/^[a-z][a-z0-9_]{0,63}$/.test(a.toolname)) report(`toolname "${a.toolname}" — use lower_snake_case, 64 characters max (§28)`);
      if (hasName) toolNames.set(a.toolname, (toolNames.get(a.toolname) ?? 0) + 1);
    }

    if ((tag === 'a' && 'href' in a) || tag === 'button') node.acc = '';
    if (tag === 'img' && a.alt && !node.ariaHidden) addText(a.alt);
    if (a['aria-label'] && tag !== 'a' && tag !== 'button' && !node.ariaHidden) addText(a['aria-label']);
    if (rawTag) continue; // script/style/template/textarea bodies are not markup
    if (VOID.has(tag) || /\/\s*$/.test(openAttrs ?? '')) { if (node.acc !== undefined) checkName(node); continue; }
    stack.push(node);
  }
  while (stack.length > 1) { const n = stack.pop(); if (n.acc !== undefined) checkName(n); }

  for (const [id, n] of ids) if (n > 1) report(`id="${id}" is used ${n}× — ids must be unique (label targeting, agent tree duplicate-id-aria)`);
  for (const [id, d] of needsLabel) if (!labelFor.has(id)) report(`${d} form field has no <label for="${id}"> (Accessibility/agent tree label)`);
  for (const id of labelledby) if (!ids.has(id)) report(`aria-labelledby points at missing id "${id}" (agent tree aria-valid-attr-value)`);
  for (const [name, n] of toolNames) if (n > 1) report(`WebMCP toolname "${name}" is used by ${n} forms on the page — each mount needs its own (RequestServicePanel derives it from idPrefix)`);

  if (production) {
    const kb = (n) => `${Math.round(n / 1024)} KB`;
    const bytes = Buffer.byteLength(html);
    if (bytes > BUDGET.htmlFail) report(`HTML is ${kb(bytes)} (limit ${kb(BUDGET.htmlFail)}) — move long lists (directories, every-city links) to their own pages (§28)`);
    else if (bytes > BUDGET.htmlWarn) soft(`HTML is ${kb(bytes)} — over the ${kb(BUDGET.htmlWarn)} budget (§28)`);
    if (elements > BUDGET.elementsFail) report(`${elements} elements (limit ${BUDGET.elementsFail}) — PageSpeed "excessive DOM size" slows every interaction (§28)`);
    else if (elements > BUDGET.elementsWarn) soft(`${elements} elements — over the ${BUDGET.elementsWarn} budget (§28)`);
    if (hiddenLinks > BUDGET.hiddenLinksFail) report(`${hiddenLinks} links inside hidden elements — a hidden directory still costs download, parse and phone-tracking scan time; render it on its own page (§28; one client site had 4,246)`);
    else if (hiddenLinks > BUDGET.hiddenLinksWarn) soft(`${hiddenLinks} links inside hidden elements (§28)`);
  }
}

let checked = 0;
let postHogPages = 0;
for (const filePath of htmlFiles(DIST)) {
  const file = relative(DIST, filePath);
  const html = readFileSync(filePath, 'utf8');
  // Google's Search Console ownership file (`npm run gsc -- verify`) is not a page: it must contain
  // exactly its own verification line and nothing the page checks expect (§28).
  if (/^google[0-9a-f]{8,}\.html$/.test(file)) {
    if (html.trim() !== `google-site-verification: ${file}`) err(file, `Search Console verification file must contain exactly "google-site-verification: ${file}" (§28)`);
    continue;
  }
  const noindexed = /<meta(?=[^>]*name="robots")[^>]*noindex[^>]*>/i.test(html);
  if (file.startsWith('templates/')) {
    // approval surfaces: ALWAYS noindex, before and after launch (§17)
    if (!noindexed) err(file, 'template preview route missing noindex,nofollow (§17)');
    // They render the shared components, so component-level PageSpeed/agent defects surface here
    // before any client page exists (§28).
    hygiene(file, html, { production: false });
    continue;
  }
  // The starter's own root is a directory of preview routes, not a production page; a client
  // build replaces src/pages/index.astro, so this marker never reaches a client site.
  if (html.includes('data-starter-directory')) continue;
  checked++;
  // 404.html is noindex on purpose, before and after launch (src/pages/404.astro): it must never be
  // indexed, so it is required to be noindex instead of counted against the launch gate (§17).
  if (file === '404.html') { if (!noindexed) err(file, '404 page must be noindex (§17)'); }
  else if (noindexed) noindexPages.push(file);
  if (html.includes('data-analytics="posthog"')) postHogPages++;
  hygiene(file, html, { production: true });

  // --- 1. §12 precedence: one process narrative per page -------------------
  const mounts = (html.match(/data-section="process"/g) ?? []).length;
  if (mounts > 1)
    err(file, `shared process section mounted ${mounts}× — it renders once per page at most (§12)`);

  const article = html.match(/<article[^>]*class="[^"]*\barticle\b[^"]*"[^>]*>([\s\S]*?)<\/article>/)?.[1];
  if (mounts >= 1 && article) {
    for (const h2 of article.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/g)) {
      const text = stripTags(h2[1]).replace(/\s+/g, ' ').trim();
      if (/\bprocess\b/i.test(text)) {
        err(file, `two process narratives: in-article H2 "${text}" plus the shared post-body process section — omit the post-body process on this page (§12 precedence; recipe post_body_sections.process)`);
        break;
      }
    }
  }

  // --- 2. §7 banned / placeholder language in visible text ------------------
  const visible = stripTags(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' '),
  ).replace(/\s+/g, ' ').toLowerCase();
  for (const phrase of BANNED)
    if (visible.includes(phrase))
      err(file, `§7 banned phrase "${phrase}" in rendered visible text`);
  // §7 US English: British spellings in what a visitor reads fail the page (owner decision 2026-11-02).
  const ukHits = findUkSpellings(visible, US_EXCEPTIONS);
  if (ukHits.length) err(file, usEnglishMessage(ukHits));
  for (const phrase of PLACEHOLDERS)
    if (visible.includes(phrase)) { if (!placeholderPages.has(phrase)) placeholderPages.set(phrase, new Set()); placeholderPages.get(phrase).add(file); }

  // --- 5. §18 images ---------------------------------------------------------
  const heroBlocks = [...html.matchAll(/<section[^>]*data-page-hero[^>]*>([\s\S]*?)<\/section>/g)].map((m) => m[1]).join('\n');
  for (const m of html.matchAll(/<img\b([^>]*)>/g)) {
    const a = m[1];
    // A bare attribute (`alt`) is the empty string in HTML — Astro renders alt="" that way. Reading it
    // as missing reported every decorative hero as "no alt"; the empty-alt rule below still applies.
    const attr = (n) => { const m = a.match(new RegExp(`(?:^|\\s)${n}(?:="([^"]*)")?(?=[\\s/]|$)`)); return m ? (m[1] ?? '') : undefined; };
    const src = attr('src') ?? '';
    const tag = `<img src="${src.slice(0, 60)}${src.length > 60 ? '…' : ''}">`;
    if (attr('width') === undefined || attr('height') === undefined)
      err(file, `${tag} missing width/height — layout shifts while it loads (§18)`);
    const alt = attr('alt');
    if (alt === undefined) err(file, `${tag} has no alt attribute (§18)`);
    else if (alt === '' && !/aria-hidden="true"|role="presentation"/.test(a))
      err(file, `${tag} has empty alt but is not marked decorative (§18)`);
    if (/\.(jpe?g|png|gif)(\?|$)/i.test(src) && !src.startsWith('/_astro/') && !src.startsWith('/logos/'))
      err(file, `${tag} is a raw raster asset outside the optimized pipeline (§18 — import it and render through OptimizedImage/HeroImage/GalleryImage)`);
    const lazy = attr('loading') === 'lazy';
    if (lazy && (attr('fetchpriority') === 'high' || heroBlocks.includes(m[0])))
      err(file, `${tag} is lazy-loaded inside the hero / marked high priority — the LCP image must load eagerly (§18)`);
  }

  // --- 7. §26 site identity: icons + og:image present and resolving ------------
  for (const [label, re] of [
    ['favicon <link rel="icon">', /<link[^>]*rel="icon"[^>]*href="([^"]+)"/],
    ['<link rel="apple-touch-icon">', /<link[^>]*rel="apple-touch-icon"[^>]*href="([^"]+)"/],
    ['og:image', /<meta[^>]*property="og:image"[^>]*content="([^"]+)"/],
  ]) {
    // (og:title / og:description / og:url / twitter:card are checked below — presence only)
    const m = html.match(re);
    if (!m) { err(file, `${label} missing (§26 — run npm run favicons:generate; BaseLayout links the set on every page)`); continue; }
    const path = m[1].replace(/^https?:\/\/[^/]+/, '');
    if (path.startsWith('/') && !built.has(path)) err(file, `${label} points at ${path} but that file is not in the build (§26)`);
  }

  for (const [label, re] of [
    ['og:title', /<meta[^>]*property="og:title"[^>]*content="[^"]+"/],
    ['og:description', /<meta[^>]*property="og:description"[^>]*content="[^"]+"/],
    ['og:url', /<meta[^>]*property="og:url"[^>]*content="https?:\/\/[^"]+"/],
    ['twitter:card', /<meta[^>]*name="twitter:card"[^>]*content="summary_large_image"/],
  ]) if (!re.test(html)) err(file, `${label} missing — every page must render as a full share card on Facebook/LinkedIn/iMessage/Slack (§26; BaseLayout emits these, never hand-write them)`);

  // --- 8. §28 page SEO ------------------------------------------------------
  const route = file === 'index.html' ? '/' : file.endsWith('/index.html') ? `/${file.slice(0, -'index.html'.length)}` : `/${file}`;
  const h1s = [...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/g)];
  if (h1s.length !== 1) err(file, `${h1s.length} <h1> elements — every page has exactly one (§28)`);
  const title = decodeEntities(html.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? '').trim();
  const meta = decodeEntities(html.match(/<meta[^>]*name="description"[^>]*content="([^"]*)"/)?.[1] ?? '').trim();
  if (!title) err(file, '<title> missing or empty (§28)');
  else if (title.length > SEO_LIMITS.title) err(file, `<title> is ${title.length} characters — the limit is ${SEO_LIMITS.title} (§28): "${title}"`);
  if (!meta) err(file, 'meta description missing or empty (§28)');
  else if (meta.length > SEO_LIMITS.meta) err(file, `meta description is ${meta.length} characters — the limit is ${SEO_LIMITS.meta} (§28)`);
  if (title) titlesSeen.set(title, [...(titlesSeen.get(title) ?? []), file]);
  if (meta) metasSeen.set(meta, [...(metasSeen.get(meta) ?? []), file]);
  const canonical = html.match(/<link[^>]*rel="canonical"[^>]*href="([^"]+)"/)?.[1];
  const ogUrl = html.match(/<meta[^>]*property="og:url"[^>]*content="([^"]+)"/)?.[1];
  // §31: the 404 page has no URL of its own, so it carries NO canonical (BaseLayout notFound).
  if (file === '404.html') { if (canonical) err(file, `404 page must not have a canonical (found ${canonical}) — use BaseLayout notFound (§31)`); }
  else if (!canonical || !/^https?:\/\//.test(canonical)) err(file, 'absolute <link rel="canonical"> missing (§28 — BaseLayout emits a self canonical)');
  else if (ogUrl && canonical !== ogUrl) err(file, `canonical ${canonical} differs from og:url ${ogUrl} (§28)`);
  const ldNodes = [];
  for (const [, body] of html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)) {
    let data;
    try { data = JSON.parse(body); } catch (e) { err(file, `JSON-LD does not parse — ${e.message} (§22)`); continue; }
    const nodes = Array.isArray(data?.['@graph']) ? data['@graph'] : [data];
    ldNodes.push(...nodes);
    for (const n of nodes) {
      const types = [n?.['@type']].flat();
      if (types.includes('LocalBusiness') && (!n.name || !n.address?.streetAddress || !n.address?.addressLocality))
        err(file, `JSON-LD LocalBusiness ${n['@id'] ?? ''} lacks name, streetAddress, or addressLocality — Google requires name + address (§22)`);
    }
  }
  const ofType = (t) => ldNodes.filter((n) => [n?.['@type']].flat().includes(t));

  // §22 FAQ schema: a page that shows FAQs carries exactly ONE FAQPage, and every question in it is
  // visible on the page (Google requires FAQ markup to match what visitors can read).
  const faqNodes = ofType('FAQPage');
  const h2Texts = [...html.matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2>/g)].map((m) => textOf(m[1]));
  const showsFaq = html.includes('data-section="faq"') || h2Texts.some((t) => /\bFAQs?\b|frequently asked|common questions/i.test(t));
  if (faqNodes.length > 1) err(file, `${faqNodes.length} FAQPage blocks — one per page; FAQSection emits it, so do not also pass schema.faqs (§22)`);
  if (showsFaq && !faqNodes.length) err(file, 'page shows FAQs but has no FAQPage schema — render them with FAQSection (it emits the schema) or pass schema.faqs with the same questions (§22)');
  const readable = decodeEntities(visible);
  for (const q of faqNodes.flatMap((n) => [n.mainEntity ?? []].flat())) {
    const question = decodeEntities(q?.name ?? '').replace(/\s+/g, ' ').trim();
    if (!question || !String(q?.acceptedAnswer?.text ?? '').trim()) err(file, 'FAQPage question without a name or an answer (§22)');
    else if (!readable.includes(question.toLowerCase())) err(file, `FAQ schema question "${question.slice(0, 80)}" is not visible on the page — schema must match what visitors read (§22)`);
  }

  // §22 breadcrumbs: every inner page has one BreadcrumbList from the homepage to itself, and every
  // page it names was built. BaseLayout derives it from the URL; schema.breadcrumbs overrides.
  if (route !== '/' && file !== '404.html') {
    const crumbs = ofType('BreadcrumbList');
    if (crumbs.length !== 1) err(file, crumbs.length ? `${crumbs.length} BreadcrumbList blocks — one per page (§22)` : 'no BreadcrumbList schema — BaseLayout builds one from the URL for every inner page; pass schema.breadcrumbs only to override (§22)');
    else {
      const items = [...(crumbs[0].itemListElement ?? [])].sort((x, y) => x.position - y.position);
      const paths = items.map((it) => String(it.item ?? '').replace(/^https?:\/\/[^/]+/, ''));
      if (items.length < 2 || items.some((it, i) => it.position !== i + 1 || !String(it.name ?? '').trim()))
        err(file, 'BreadcrumbList needs 2+ items numbered 1..n, each with a name (§22)');
      if (paths[0] !== '/') err(file, `BreadcrumbList starts at "${paths[0] ?? ''}" — it starts at the homepage (§22)`);
      if (paths.at(-1) !== route) err(file, `BreadcrumbList ends at "${paths.at(-1) ?? ''}" — it ends at this page, ${route} (§22)`);
      for (const p of paths) if (p && !resolves(p)) err(file, `BreadcrumbList links ${p}, which was not built — pass schema.breadcrumbs that skips the missing parent (§22)`);
    }
  }
  const mp = mapPages.get(route);
  if (mp) {
    // Title rule per page type (PAGE_TITLE_RULES). Brand = og:site_name, which BaseLayout sets from site.name.
    const kw = mp.primary_keyword;
    const city = pageCity(mp);
    const h1 = textOf(h1s[0]?.[1] ?? '');
    const brand = decodeEntities(html.match(/<meta[^>]*property="og:site_name"[^>]*content="([^"]*)"/)?.[1] ?? pageMap?.meta?.client ?? '');
    const loc = locationLabel(city, mp.state || pageMap?.meta?.primary_service_page_target_state);
    const ctx = { keyword: kw, location: loc, brand, servicePhrase: mp.title_service_phrase, headline: h1, label: h1 };
    const allowed = allowedTitles(mp.page_type, ctx);
    if (allowed === null) {
      const sug = suggestTitleRule(mp.page_type, ctx);
      err(file, `page_type "${mp.page_type}" has no title rule yet (§28). Suggested: "${sug.pattern}" — ${sug.reason}. Add it to PAGE_TITLE_RULES once approved`);
    } else if (allowed.length && title && !allowed.includes(title)) {
      err(file, `<title> "${title}" does not follow the ${mp.page_type} title rule — expected "${allowed[0]}" (§28)`);
    }
    if (KEYWORD_PAGE_TYPES.includes(mp.page_type) && kw) {
      const local = LOCAL_PAGE_TYPES.includes(mp.page_type) ? city : '';
      const afterH1 = h1s[0] ? html.slice(h1s[0].index + h1s[0][0].length) : html;
      const h2 = textOf(afterH1.match(/<h2\b[^>]*>([\s\S]*?)<\/h2>/)?.[1] ?? '');
      for (const [label, text] of [['<title>', title], ['meta description', meta], ['H1', h1], ['first H2', h2]]) {
        if (!containsPhrase(text, kw)) err(file, `${label} does not contain the primary keyword "${kw}" (§28): "${text}"`);
        if (local && !containsPhrase(text, local)) err(file, `${label} does not contain the city "${local}" (§28): "${text}"`);
      }
    }
  }

  // --- 6. §11 forms + tap-to-call on every production page -------------------
  if (!html.includes('data-component="request-service"'))
    err(file, 'no shared request form on the page (§11 — RequestServicePanel must be present, via sidebar, section, or footer band)');
  if (!/href="tel:/.test(html))
    err(file, 'no tap-to-call tel: link on the page (§9)');

  // --- 12. §30 agency footer credit on every page ----------------------------
  for (const msg of checkAgencyCredit(html)) err(file, msg);

  // --- 3. §15 dead internal links (aggregated across pages below) ----------
  // 404.html is exempt: its links are the site shell's, so any dead one also appears on every
  // real page and is reported there. In the starter, 404 is the ONLY shelled non-template page,
  // and the shell's example nav points at page types a client build creates.
  if (file === '404.html') continue;
  for (const m of html.matchAll(/<a\s[^>]*href="([^"]*)"/g)) {
    const href = m[1];
    if (EXTERNAL.test(href) || !href.startsWith('/')) continue;
    if (!resolves(href)) {
      if (!deadLinks.has(href)) deadLinks.set(href, new Set());
      deadLinks.get(href).add(file);
    }
  }
}

for (const [href, pages] of [...deadLinks.entries()].sort()) {
  err(
    `${pages.size} page(s), e.g. ${[...pages][0]}`,
    `dead internal link "${href}" — no built route or file at that path (§15: never publish links to routes that don't exist)`,
  );
}

// §28: titles and meta descriptions are unique across the site (Google: boilerplate titles are unhelpful)
for (const [kind, seen] of [['<title>', titlesSeen], ['meta description', metasSeen]])
  for (const [text, pages] of seen)
    if (pages.length > 1) err(`${pages.length} pages, e.g. ${pages[0]}`, `duplicate ${kind} "${text.slice(0, 80)}" — every page needs its own (§28)`);

// §28 site-wide asset weight (PageSpeed fix logs: a 100+ KB decorative font, oversized logos and posters)
for (const f of built) {
  const size = statSync(join(DIST, f)).size;
  const kb = Math.round(size / 1024);
  if (/\.woff2$/i.test(f) && size > 80 * 1024) err(f, `font is ${kb} KB (limit 80) — subset it to the characters used (a signature/script font is often the text of one line) (§28)`);
  if (/\.(ttf|otf)$/i.test(f)) err(f, 'font is not woff2 — convert it (§28)');
  if (/\.(jpe?g|png|webp|avif|gif)$/i.test(f)) {
    if (f.startsWith('/logos/') && size > 100 * 1024) warn(`${f} is ${kb} KB — a logo should be under 100 KB (SVG, or a resized WebP) (§18/§28)`);
    else if (size > 400 * 1024) warn(`${f} is ${kb} KB — over the 400 KB image budget; check its widths/quality (§18/§28)`);
  }
}
// §28 Agentic Browsing llms-txt: Lighthouse passes an H1, at least one markdown link, 50+ characters.
if (built.has('/llms.txt')) {
  const llms = readFileSync(join(DIST, 'llms.txt'), 'utf8');
  if (!/^\s*#\s+.+/m.test(llms)) err('llms.txt', 'no H1 ("# Site name") — Lighthouse llms-txt fails (§21/§28)');
  if (!/\[.+\]\(.+\)/.test(llms)) err('llms.txt', 'no markdown link — Lighthouse llms-txt fails (§21/§28)');
  if (llms.length < 50) err('llms.txt', `only ${llms.length} characters — Lighthouse llms-txt needs 50+ (§21/§28)`);
}
for (const f of ['/ai-catalog.json', '/.well-known/ai-catalog.json'])
  if (built.has(f)) warn(`${f} is published — Lighthouse ard-schema now validates it against the ARD spec; an invalid file fails Agentic Browsing (§28)`);

// §28 launch steps: IndexNow key file published, PostHog loading on every page
if (LAUNCH) {
  const keyFile = [...built].find((f) => /^\/[A-Za-z0-9-]{8,128}\.txt$/.test(f) && !['/robots.txt', '/llms.txt'].includes(f) &&
    readFileSync(join(DIST, f), 'utf8').trim() === basename(f, '.txt'));
  if (!keyFile) err('launch gate', 'IndexNow key file missing — set site.indexNow.key and rebuild (postbuild publishes /{key}.txt) (§28)');
  if (checked > 0 && !postHogPages) err('launch gate', 'PostHog is not loading — it needs site.posthog.projectKey (the shared "RGP - Clients" key, starter default) and the client slug (site.posthog.client or site.leadRouter.clientId); rebuild (§28)');
  else if (postHogPages < checked) err('launch gate', `PostHog loads on ${postHogPages} of ${checked} page(s) — every page must render it via BaseLayout (§28)`);
}

// §28 post-deploy announcements: the public page manifest the "Tell search engines" job compares (postbuild writes it).
{
  const manifestPath = join(DIST, MANIFEST_FILE);
  if (!existsSync(manifestPath)) err(MANIFEST_FILE, 'missing — postbuild.mjs writes it; the post-deploy "Tell search engines" job needs it to send IndexNow only the changed pages (§28)');
  else {
    try {
      const m = parseManifest(readFileSync(manifestPath, 'utf8'));
      const inSitemap = builtSitemapUrls(DIST);
      const listed = new Set(Object.keys(m.pages));
      const notListed = inSitemap.filter((u) => !listed.has(u));
      const notInSitemap = [...listed].filter((u) => !inSitemap.includes(u));
      if (notListed.length) err(MANIFEST_FILE, `${notListed.length} sitemap URL(s) missing from it (e.g. ${notListed[0]}) — rebuild; never edit it by hand (§28)`);
      if (notInSitemap.length) err(MANIFEST_FILE, `${notInSitemap.length} URL(s) not in the sitemap (e.g. ${notInSitemap[0]}) — rebuild; never edit it by hand (§28)`);
      if (LAUNCH && m.previewMode) err('launch gate', `${MANIFEST_FILE} says previewMode true — the post-deploy job would announce nothing; set site.previewMode to false and rebuild (§28)`);
    } catch (e) { err(MANIFEST_FILE, `unusable — ${e.message} (§28)`); }
  }
}

// §27 launch gate: every lead form posts to the ONE agency router with a client id, and lead delivery was proven.
// Added 2026-10-19 after four client sites were found pointed at the retired router with forms switched off.
if (LAUNCH) {
  const hostingFile = join(DIST, '..', 'hosting.json');
  const routerUrl = existsSync(hostingFile) ? JSON.parse(readFileSync(hostingFile, 'utf8')).leadRouter?.url : null;
  const expected = routerUrl ? `${routerUrl.replace(/\/+$/, '')}/submit` : null;
  let forms = 0;
  const off = new Set(), wrong = new Set(), notConnected = new Set(), noSpamCheck = new Set();
  for (const f of built) {
    if (!f.endsWith('.html')) continue;
    for (const m of readFileSync(join(DIST, f), 'utf8').matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)) {
      const input = m[2].match(/<input\b[^>]*\bname="client_id"[^>]*>/i);
      if (!input) continue;
      forms++;
      const clientId = (input[0].match(/\bvalue="([^"]*)"/) || [])[1]; // empty renders as a bare `value`
      const action = (m[1].match(/\baction="([^"]*)"/) || [])[1];
      const formType = (m[2].match(/<input\b[^>]*\bname="form_type"[^>]*\bvalue="([^"]*)"/i) || [])[1];
      // A Careers / Partner form with a client id but no action: its own GHL workflow is not connected yet (§27).
      // Template previews show both forms whatever site.forms says, so only real pages count.
      if (clientId && !action && ['career_application', 'partner_enquiry'].includes(formType)) { if (!f.startsWith('/templates/')) notConnected.add(`${f} (${formType})`); }
      else if (!action || !clientId) off.add(f);
      else if (expected && decodeEntities(action) !== expected) wrong.add(`${f} → ${action}`);
      // Without a Turnstile widget no token is sent, and the router refuses every submission (§11/§27).
      if (action && clientId && !/\bclass="[^"]*\bcf-turnstile\b/.test(m[2])) noSpamCheck.add(f);
    }
  }
  if (!expected) err('launch gate', 'hosting.json has no leadRouter.url — cannot verify where lead forms post (§27)');
  if (off.size) err('launch gate', `lead forms are DISABLED (no router client id) on ${off.size} page(s), e.g. ${[...off][0]} — run npm run leadrouter:setup (§27, skill agency-lead-delivery-setup)`);
  if (notConnected.size) err('launch gate', `a Careers/Partner form is DISABLED — the router has no GHL workflow for it yet (site.leadRouter.careersReady / partnerReady) on ${notConnected.size} page(s), e.g. ${[...notConnected][0]} — run npm run leadrouter:setup -- --skip-lead-test --career-webhook <URL> / --partner-webhook <URL>, or switch the form off in site.forms (§27, skill agency-lead-delivery-setup)`);
  if (noSpamCheck.size) err('launch gate', `lead forms post to the router with no spam-check widget (site.leadRouter.turnstileSiteKey empty) on ${noSpamCheck.size} page(s), e.g. ${[...noSpamCheck][0]} — the router refuses every submission without a Turnstile token; run npm run leadrouter:setup (§27)`);
  if (wrong.size) err('launch gate', `lead forms post somewhere other than the agency router (${expected}) on ${wrong.size} page(s), e.g. ${[...wrong][0]} — run npm run leadrouter:setup (§27)`);
  if (forms && !existsSync(join(DIST, '..', 'artifacts', 'launch', 'lead-delivery.md')))
    err('launch gate', 'artifacts/launch/lead-delivery.md missing — lead delivery to the client\'s GHL was never proven (npm run leadrouter:setup, §27)');
}

// §26: the starter placeholder identity must not launch
if (built.has('/site-identity.json')) {
  try {
    const ident = JSON.parse(readFileSync(join(DIST, 'site-identity.json'), 'utf8'));
    if (ident.placeholder) { const msg = 'favicons / og-default are the STARTER PLACEHOLDER set (public/site-identity.json) — run npm run favicons:generate with the client logo/mark'; LAUNCH ? err('launch gate', msg) : warn(msg); }
  } catch { warn('public/site-identity.json unreadable'); }
} else if (checked > 0) { const msg = 'public/site-identity.json missing — favicons were never generated (npm run favicons:generate)'; LAUNCH ? err('launch gate', msg) : warn(msg); }

for (const [phrase, pages] of placeholderPages) {
  const msg = `starter placeholder "${phrase}" still rendered on ${pages.size} page(s) (e.g. ${[...pages][0]}) — site.ts/theme not yet replaced with client data`;
  if (LAUNCH) err('launch gate', msg); else warn(msg);
}

if (noindexPages.length) {
  const detail = `${noindexPages.length} of ${checked} page(s) noindex (e.g. ${noindexPages[0]})`;
  if (LAUNCH)
    err('launch gate', `${detail} — a launched site must be indexable: set site.previewMode to false, rebuild, re-run (§17)`);
  else
    warn(`${detail} — expected while site.previewMode is true; launch requires ZERO (npm run validate:launch)`);
}
if (LAUNCH) {
  for (const required of ['/robots.txt', '/sitemap.xml', '/llms.txt'])
    if (!built.has(required)) err('launch gate', `${required} missing from the build (§21)`);
}

// --- 11. §29 blog schedule -------------------------------------------------------------------
const blog = checkBlogBuild({ dist: DIST, postsDir: process.env.BLOG_POSTS_DIR ?? join(DIST, '..', 'src', 'content', 'posts') });
for (const n of blog.notes) warn(`blog: ${n}`);
for (const e of blog.errors) err('blog schedule', e);
const qa = checkQaRecords({ postsDir: process.env.BLOG_POSTS_DIR ?? join(DIST, '..', 'src', 'content', 'posts'), qaDir: process.env.BLOG_QA_DIR ?? join(DIST, '..', QA_DIR) });
for (const e of qa.errors) err('blog QA record', e);

if (errors) {
  console.error(`\n✗ validate:built failed — ${errors} error(s) across ${checked} page(s). Fix the page composition or the upstream artifact; do not ship.`);
  process.exit(1);
}
console.log(`✓ validate:built passed${LAUNCH ? ' (LAUNCH mode)' : ''} — ${checked} page(s): one process narrative each, no §7 banned language, images sized/alt/eager-LCP, form + tel on every page, no dead internal links, one H1 + unique title ≤${SEO_LIMITS.title} + unique meta ≤${SEO_LIMITS.meta} + canonical + valid JSON-LD${pageMap ? ' + keyword/city in title, meta, H1, first H2' : ''} + PageSpeed/agent hygiene (templates too)${blog.posts ? ` + blog schedule (${blog.published}/${blog.posts} posts live, none unpublished linked, company author + TOC checked on ${blog.pagesChecked}, ${qa.checked} Ready QA record(s))` : ''}${LAUNCH ? ', all pages indexable, robots.txt + sitemap.xml present, IndexNow key + PostHog live' : ''}.${warnings ? ` ${warnings} warning(s) above.` : ''}`);
