/**
 * search-health.mjs — the bars of the weekly "Search engine watch" (CORE_CONTRACTS §28; .github/workflows/search-watch.yml
 * → scripts/search-watch.mjs in agent-website-builder). Pure functions: the watch gathers what Google, Bing and the live
 * site say, this file decides what needs attention. Unit-tested in tests/search/search-health.test.mjs.
 *
 * A site NEEDS ATTENTION (it goes into the weekly issue) when any of these holds:
 *   1. Google: no property in the agency Search Console account with Owner/Full access; the sitemap was never
 *      submitted; Google reports sitemap errors; or Google has not downloaded the sitemap for 14 days.
 *   2. Bing: the site is not in (or not verified in) the agency Bing account; the sitemap was never submitted; the
 *      sitemap status is an error.
 *   3. A submission failure: the last production build (its /search-manifest.json `builtAt`, older than 2 hours) is
 *      newer than Google's or Bing's last sitemap submission — the post-deploy job did not run or failed.
 *   4. IndexNow: the site has a key but {origin}/{key}.txt does not serve it.
 *   5. Google or Bing could not be read at all (API error).
 * Reported but not a problem: sitemap warnings, submitted/indexed counts, Bing last crawl, a site without
 * /search-manifest.json yet (post-deploy job not rolled out) or without an IndexNow key.
 */
export const BARS = { googleDownloadDays: 14, announceGraceHours: 2, clockSkewMs: 60_000 };
const DAY = 86_400_000;

/** Bing's WCF dates ("/Date(1793033818119)/", "/Date(-11644473600000)/" = never) → ISO string or null. */
export function parseBingDate(v) {
  if (v == null || v === '') return null;
  const m = String(v).match(/\/Date\((-?\d+)(?:[+-]\d{4})?\)\//);
  const ms = m ? Number(m[1]) : Date.parse(String(v));
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return new Date(ms).toISOString();
}

/** Search Console properties that could cover this origin, best first (same order as scripts/search-console.mjs). */
export function propertyCandidates(origin) {
  const u = new URL(origin);
  const apex = u.hostname.replace(/^www\./, '');
  return [`sc-domain:${apex}`, `${u.origin}/`, `https://www.${apex}/`, `https://${apex}/`, `http://www.${apex}/`, `http://${apex}/`];
}

/** The best matching property from Search Console's site list: { usable, all }. */
export function pickProperty(siteEntries, origin) {
  const c = propertyCandidates(origin);
  const all = (siteEntries ?? []).filter((s) => c.includes(s.siteUrl)).sort((a, b) => c.indexOf(a.siteUrl) - c.indexOf(b.siteUrl));
  return { usable: all.find((s) => ['siteOwner', 'siteFullUser'].includes(s.permissionLevel)) ?? null, all };
}

const daysAgo = (iso, now) => (iso ? Math.floor((now - Date.parse(iso)) / DAY) : null);
const BAD_BING_STATUS = /fail|error|invalid|denied|block|not ?found/i;

/**
 * One site's verdict. Inputs (any may carry { error } or { notChecked: '<why>' }):
 *   google   { property, access, found: [levels], sitemap: null | { lastSubmitted, lastDownloaded, errors, warnings, contents } }
 *   bing     { inAccount, verified, feed: null | { Status, LastCrawled, Submitted, UrlCount } }   (Bing's raw feed)
 *   indexNow { key: string | null, reachable: boolean | null, detail }
 *   manifest { builtAt, commit } | { error } | null
 * Returns { slug, origin, problems: [text], notes: [text], cells: {...} } — cells are for the summary table.
 */
export function assessSite({ slug, origin, now = Date.now(), google = {}, bing = {}, indexNow = {}, manifest = null }) {
  const problems = [];
  const notes = [];
  const cells = {};

  // --- Google
  if (google.notChecked) { cells.google = 'not checked'; notes.push(`Google not checked: ${google.notChecked}`); }
  else if (google.error) { cells.google = '✗ error'; problems.push(`Google Search Console could not be read: ${google.error}`); }
  else if (!google.property) {
    cells.google = '✗ no access';
    problems.push(google.found?.length
      ? `Google: the agency account only has ${google.found.join(', ')} access — sitemap submissions need Owner or Full (ask the client to grant Full access)`
      : 'Google: the site is not in the agency Search Console account (§28 launch step 7a: `npm run gsc -- status`)');
  } else if (!google.sitemap) {
    cells.google = '✗ no sitemap';
    problems.push('Google: /sitemap.xml was never submitted to Search Console (`npm run gsc -- submit`)');
  } else {
    const s = google.sitemap;
    const d = daysAgo(s.lastDownloaded, now);
    const errors = Number(s.errors ?? 0), warnings = Number(s.warnings ?? 0);
    const web = (s.contents ?? []).find((c) => c.type === 'web') ?? (s.contents ?? [])[0];
    cells.google = `${errors ? `✗ ${errors} error(s)` : '✓'} · downloaded ${s.lastDownloaded ? `${d} day(s) ago` : 'never'} · submitted ${s.lastSubmitted ? `${daysAgo(s.lastSubmitted, now)} day(s) ago` : 'never'}${web ? ` · ${web.submitted ?? '?'} URLs, ${web.indexed ?? '?'} indexed` : ''}`;
    if (errors) problems.push(`Google reports ${errors} error(s) in /sitemap.xml — open Search Console → Sitemaps`);
    if (!s.lastDownloaded) {
      if (daysAgo(s.lastSubmitted, now) >= BARS.googleDownloadDays || !s.lastSubmitted) problems.push(`Google has never downloaded /sitemap.xml${s.lastSubmitted ? ` (submitted ${s.lastSubmitted})` : ''}`);
      else notes.push(`Google has not downloaded the sitemap yet (submitted ${s.lastSubmitted})`);
    } else if (d >= BARS.googleDownloadDays) problems.push(`Google has not downloaded /sitemap.xml for ${d} days (last ${s.lastDownloaded}; bar: ${BARS.googleDownloadDays})`);
    if (warnings) notes.push(`Google reports ${warnings} sitemap warning(s)`);
  }

  // --- Bing
  if (bing.notChecked) { cells.bing = 'not checked'; notes.push(`Bing not checked: ${bing.notChecked}`); }
  else if (bing.error) { cells.bing = '✗ error'; problems.push(`Bing Webmaster Tools could not be read: ${bing.error}`); }
  else if (!bing.inAccount) { cells.bing = '✗ not in account'; problems.push('Bing: the site is not in the agency Bing Webmaster account (§28 "Bing order")'); }
  else if (!bing.verified) { cells.bing = '✗ not verified'; problems.push('Bing: the site is in the agency account but not verified (`npm run bing -- verify`)'); }
  else if (!bing.feed) { cells.bing = '✗ no sitemap'; problems.push('Bing: /sitemap.xml was never submitted (`npm run bing -- submit`)'); }
  else {
    const f = bing.feed;
    const crawled = parseBingDate(f.LastCrawled), submitted = parseBingDate(f.Submitted);
    cells.bing = `${BAD_BING_STATUS.test(f.Status ?? '') ? '✗' : '✓'} ${f.Status ?? 'status unknown'} · crawled ${crawled ? `${daysAgo(crawled, now)} day(s) ago` : 'never'} · submitted ${submitted ? `${daysAgo(submitted, now)} day(s) ago` : 'never'}${f.UrlCount ? ` · ${f.UrlCount} URLs` : ''}`;
    if (BAD_BING_STATUS.test(f.Status ?? '')) problems.push(`Bing reports the sitemap status "${f.Status}" — open Bing Webmaster Tools → Sitemaps`);
  }

  // --- Submission after the last production deploy (needs the post-deploy job's public manifest)
  if (!manifest) { cells.lastDeploy = 'no manifest'; notes.push('no /search-manifest.json — the post-deploy "Tell search engines" job is not rolled out to this site yet, so missed announcements cannot be detected'); }
  else if (manifest.error) { cells.lastDeploy = '✗ unreadable'; problems.push(`/search-manifest.json could not be read: ${manifest.error}`); }
  else {
    const built = Date.parse(manifest.builtAt);
    cells.lastDeploy = Number.isFinite(built) ? `${new Date(built).toISOString().slice(0, 16).replace('T', ' ')} UTC${manifest.commit ? ` (${String(manifest.commit).slice(0, 7)})` : ''}` : 'unknown';
    if (Number.isFinite(built) && now - built > BARS.announceGraceHours * 3_600_000) {
      const late = (label, iso) => {
        const t = iso ? Date.parse(iso) : NaN;
        if (!Number.isFinite(t) || t < built - BARS.clockSkewMs) problems.push(`Submission failure: the production build of ${cells.lastDeploy} was never announced to ${label} (last sitemap submission ${iso ?? 'never'}) — open the client repo's Actions → "Tell search engines" (or run it)`);
      };
      if (google.sitemap && !google.error && !google.notChecked) late('Google', google.sitemap.lastSubmitted);
      if (bing.feed && !bing.error && !bing.notChecked) late('Bing', parseBingDate(bing.feed.Submitted));
    }
  }

  // --- IndexNow key file
  if (!indexNow.key && (!manifest || manifest.error)) { cells.indexNow = 'not checked'; notes.push('IndexNow key file not checked: the key is read from /search-manifest.json'); }
  else if (!indexNow.key) { cells.indexNow = 'no key'; notes.push('IndexNow is not set up (no key in the live manifest: site.indexNow.key is empty)'); }
  else if (indexNow.reachable) cells.indexNow = '✓ key file live';
  else { cells.indexNow = '✗ key file'; problems.push(`IndexNow key file ${origin}/${indexNow.key}.txt is not served (${indexNow.detail ?? 'unreachable'}) — IndexNow rejects every submission (403)`); }

  return { slug, origin, problems, notes, cells };
}

/** Monday (UTC) of the week containing `date`, as YYYY-MM-DD — the weekly issue's key. */
export function weekOf(date = new Date()) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}
