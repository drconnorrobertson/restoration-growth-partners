/**
 * search-manifest.mjs — the public page manifest behind "tell the search engines after every production deploy"
 * (CORE_CONTRACTS §28 "After every production deploy"). Pure functions, unit-tested (tests/search/search-notify.test.mjs).
 *
 * postbuild.mjs writes dist/search-manifest.json on every build: every sitemap URL → a fingerprint of that page's
 * MEANINGFUL HTML, plus the commit the build came from. After a production deploy the workflow "Tell search engines"
 * (.github/workflows/search-notify.yml → scripts/search-notify.mjs) reads the LIVE manifest, compares it with the one
 * stored by its last run whose IndexNow step succeeded, and sends only changed + added + removed URLs to IndexNow.
 *
 * What the fingerprint covers (and what it deliberately ignores):
 *   counted:  <title>, meta description, meta robots, canonical href, every JSON-LD block, the visible text of
 *             <body>, every link href in <body>, every <img> src + alt in <body>.
 *   ignored:  <script> (other than JSON-LD), <style>, <noscript>, <template>, inline <svg>, HTML comments, every
 *             other attribute (classes, Astro's data-astro-cid-*, inline styles), CSS/JS bundle names in <head>,
 *             and the copyright YEAR (© 2026 → © YEAR) so New Year's Day does not make every page "changed".
 *   So a CSS-only or script-only deploy changes nothing; a phone number in the footer changes every page (it is on
 *   every page — correct); publishing a blog post changes the post, /blog/, and the posts whose related lists moved.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export const MANIFEST_FILE = 'search-manifest.json';
export const MANIFEST_VERSION = 1;

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'", '#x27': "'", copy: '©' };
const decode = (s) => String(s).replace(/&(#?\w+);/g, (m, e) => ENTITIES[e.toLowerCase()] ?? m);
const squash = (s) => decode(s).replace(/\s+/g, ' ').trim();
const attr = (tag, name) => tag.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'))?.slice(1).find((v) => v !== undefined) ?? '';
const headTags = (html, tagName, test) => [...html.matchAll(new RegExp(`<${tagName}\\b[^>]*>`, 'gi'))].map((m) => m[0]).filter(test);

/** The copyright year (and year ranges) in visible text, replaced so a new calendar year is not a page change. */
export const stripCopyrightYear = (text) =>
  String(text).replace(/(©|\(c\)|copyright)(\s*)\d{4}(\s*[-–]\s*\d{4})?/gi, '$1$2YEAR');

/** The parts of a page that matter to a search engine, as one normalized string. */
export function meaningfulContent(html) {
  const h = String(html ?? '');
  const title = squash(h.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '');
  const metaNamed = (name) => headTags(h, 'meta', (t) => attr(t, 'name').toLowerCase() === name).map((t) => squash(attr(t, 'content'))).join(' | ');
  const canonical = headTags(h, 'link', (t) => attr(t, 'rel').toLowerCase() === 'canonical').map((t) => attr(t, 'href')).join(' | ');
  const jsonLd = [...h.matchAll(/<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => squash(m[1]));
  let body = h.match(/<body\b[^>]*>([\s\S]*)<\/body>/i)?.[1] ?? h;
  body = body.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<(script|style|noscript|template|svg)\b[\s\S]*?<\/\1\s*>/gi, ' ');
  const links = [...body.matchAll(/<a\b[^>]*>/gi)].map((m) => attr(m[0], 'href')).filter(Boolean);
  const images = [...body.matchAll(/<img\b[^>]*>/gi)].map((m) => `${attr(m[0], 'src')}|${squash(attr(m[0], 'alt'))}`);
  const text = stripCopyrightYear(squash(body.replace(/<[^>]+>/g, ' ')));
  return JSON.stringify({ title, description: metaNamed('description'), robots: metaNamed('robots'), canonical, jsonLd, text, links, images });
}

/** Short, stable fingerprint of a page's meaningful content. */
export const pageFingerprint = (html) => createHash('sha256').update(meaningfulContent(html)).digest('hex').slice(0, 20);

/** Every <loc> in the built sitemap files (sitemap-0.xml, sitemap-1.xml, …) of a dist folder. */
export function builtSitemapUrls(dist) {
  const files = readdirSync(dist).filter((f) => /^sitemap-\d+\.xml$/.test(f)).sort();
  return [...new Set(files.flatMap((f) => [...readFileSync(join(dist, f), 'utf8').matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1])))];
}

/** The built file for a sitemap URL, or null (a URL the static build did not produce). */
export function builtFileFor(dist, pageUrl) {
  let path;
  try { path = decodeURIComponent(new URL(pageUrl).pathname); } catch { return null; }
  const rel = path.replace(/^\/+/, '');
  const candidates = path.endsWith('/') ? [join(rel, 'index.html')] : /\.html?$/i.test(path) ? [rel] : [`${rel}.html`, join(rel, 'index.html')];
  return candidates.map((c) => join(dist, c)).find((f) => existsSync(f)) ?? null;
}

/**
 * The manifest for a finished build. `commit` is the git commit the build came from (Vercel: VERCEL_GIT_COMMIT_SHA);
 * the post-deploy job waits until the production domain serves the manifest of the deployed commit.
 */
export function buildManifest({ dist, origin, commit = null, deploymentId = null, builtAt = new Date().toISOString(), previewMode = true, indexNowKey = '' }) {
  const pages = {};
  const missing = [];
  for (const u of builtSitemapUrls(dist)) {
    const file = builtFileFor(dist, u);
    if (!file) { missing.push(u); pages[u] = null; continue; }
    pages[u] = pageFingerprint(readFileSync(file, 'utf8'));
  }
  return {
    manifest: {
      version: MANIFEST_VERSION,
      site: String(origin).replace(/\/$/, ''),
      commit: commit || null,
      deploymentId: deploymentId || null,
      builtAt,
      previewMode: previewMode === true,
      indexNowKey: indexNowKey || '',
      pages,
    },
    missing,
  };
}

/** A manifest read from text or an object, checked. Throws a plain message when it is unusable. */
export function parseManifest(input) {
  let m = input;
  if (typeof input === 'string') {
    try { m = JSON.parse(input); } catch { throw new Error('not JSON'); }
  }
  if (!m || typeof m !== 'object' || Array.isArray(m)) throw new Error('not a JSON object');
  if (m.version !== MANIFEST_VERSION) throw new Error(`unsupported version ${JSON.stringify(m.version)} (expected ${MANIFEST_VERSION})`);
  if (!m.pages || typeof m.pages !== 'object' || Array.isArray(m.pages)) throw new Error('no "pages" object');
  for (const [u, h] of Object.entries(m.pages)) {
    if (!/^https?:\/\//.test(u)) throw new Error(`page key "${u}" is not an absolute URL`);
    if (h !== null && typeof h !== 'string') throw new Error(`fingerprint for ${u} is not a string`);
  }
  if (!Object.keys(m.pages).length) throw new Error('lists no pages');
  return m;
}

/**
 * What to send to IndexNow, comparing the previously announced manifest with the live one.
 * Returns { mode: 'diff' | 'full', reason, changed, added, removed, unchanged, submit }.
 *   - diff:  submit = changed + added + removed (IndexNow asks to be told about deleted URLs too, so engines drop them).
 *   - full:  the comparison could not run (no previous manifest, it failed to load or is malformed, or it belongs to
 *            another origin) → submit = every URL in the live manifest, with the reason stated.
 * `previous` is a manifest object, or { error: '<why it could not be loaded>' }, or null/undefined (none stored).
 */
export function diffManifests(previous, current) {
  const cur = parseManifest(current);
  const all = Object.keys(cur.pages);
  const full = (reason) => ({ mode: 'full', reason, changed: [], added: all, removed: [], unchanged: [], submit: all });
  if (previous == null) return full('no previous manifest is stored (first run of this job for the site)');
  if (previous.error) return full(`the previous manifest could not be loaded: ${previous.error}`);
  let prev;
  try { prev = parseManifest(previous); } catch (e) { return full(`the previous manifest is malformed: ${e.message}`); }
  if (prev.site && cur.site && prev.site !== cur.site) return full(`the previous manifest is for ${prev.site}, the live one for ${cur.site}`);
  const changed = [], added = [], unchanged = [];
  for (const u of all) {
    if (!(u in prev.pages)) added.push(u);
    else if (prev.pages[u] !== cur.pages[u]) changed.push(u);
    else unchanged.push(u);
  }
  const removed = Object.keys(prev.pages).filter((u) => !(u in cur.pages));
  return { mode: 'diff', reason: 'compared with the manifest from the last announced deploy', changed, added, removed, unchanged, submit: [...changed, ...added, ...removed] };
}
