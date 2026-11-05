/**
 * The weekly "Search engine watch" bars (scripts/lib/search-health.mjs, used by scripts/search-watch.mjs in
 * agent-website-builder). Pure: no Google, Bing or network. Run: npm run test:search
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessSite, parseBingDate, pickProperty, weekOf, BARS } from '../../scripts/lib/search-health.mjs';

const O = 'https://www.client.com';
const NOW = Date.parse('2026-10-26T13:00:00Z');
const daysBefore = (d) => new Date(NOW - d * 86_400_000).toISOString();
const bingDate = (iso) => `/Date(${Date.parse(iso)})/`;
const healthy = () => ({
  slug: 'client', origin: O, now: NOW,
  google: { property: `${O}/`, access: 'siteOwner', sitemap: { lastSubmitted: daysBefore(1), lastDownloaded: daysBefore(1), errors: 0, warnings: 0, contents: [{ type: 'web', submitted: '56', indexed: '40' }] } },
  bing: { inAccount: true, verified: true, feed: { Status: 'Success', LastCrawled: bingDate(daysBefore(2)), Submitted: bingDate(daysBefore(1)), UrlCount: 56 } },
  indexNow: { key: 'abcdef12', reachable: true },
  manifest: { builtAt: daysBefore(1.5), commit: 'a'.repeat(40) },
});

test('Bing dates: WCF format, the 1601 "never" value, and empties', () => {
  assert.equal(parseBingDate('/Date(1793033818119)/'), new Date(1793033818119).toISOString());
  assert.equal(parseBingDate('/Date(1793033818119-0700)/'), new Date(1793033818119).toISOString());
  assert.equal(parseBingDate('/Date(-11644473600000)/'), null);
  assert.equal(parseBingDate(''), null);
  assert.equal(parseBingDate(null), null);
});

test('Search Console property: domain property first, Owner/Full only counts as usable', () => {
  const entries = [{ siteUrl: `${O}/`, permissionLevel: 'siteRestrictedUser' }, { siteUrl: 'sc-domain:client.com', permissionLevel: 'siteFullUser' }, { siteUrl: 'https://other.com/', permissionLevel: 'siteOwner' }];
  assert.equal(pickProperty(entries, O).usable.siteUrl, 'sc-domain:client.com');
  assert.equal(pickProperty([entries[0]], O).usable, null);
  assert.equal(pickProperty([entries[0]], O).all.length, 1);
});

test('a healthy site has no problems and a full row', () => {
  const r = assessSite(healthy());
  assert.deepEqual(r.problems, []);
  assert.match(r.cells.google, /^✓ · downloaded 1 day\(s\) ago .* 56 URLs, 40 indexed/);
  assert.match(r.cells.bing, /^✓ Success · crawled 2 day\(s\) ago/);
  assert.equal(r.cells.indexNow, '✓ key file live');
});

test(`Google: not downloaded for ${BARS.googleDownloadDays} days, errors, no property, no sitemap → problems`, () => {
  const stale = healthy(); stale.google.sitemap.lastDownloaded = daysBefore(15);
  assert.match(assessSite(stale).problems.join(), /has not downloaded \/sitemap\.xml for 15 days/);
  const fresh = healthy(); fresh.google.sitemap.lastDownloaded = daysBefore(13);
  assert.deepEqual(assessSite(fresh).problems, []);
  const errs = healthy(); errs.google.sitemap.errors = 2;
  assert.match(assessSite(errs).problems.join(), /Google reports 2 error\(s\)/);
  const warn = healthy(); warn.google.sitemap.warnings = 3;
  assert.deepEqual(assessSite(warn).problems, [], 'warnings are reported, not a bar');
  assert.match(assessSite(warn).notes.join(), /3 sitemap warning/);
  const none = healthy(); none.google = { property: null, found: [] };
  assert.match(assessSite(none).problems.join(), /not in the agency Search Console account/);
  const restricted = healthy(); restricted.google = { property: null, found: ['siteRestrictedUser'] };
  assert.match(assessSite(restricted).problems.join(), /only has siteRestrictedUser access/);
  const never = healthy(); never.google.sitemap = null;
  assert.match(assessSite(never).problems.join(), /never submitted to Search Console/);
  const neverDl = healthy(); neverDl.google.sitemap.lastDownloaded = null; neverDl.google.sitemap.lastSubmitted = daysBefore(20);
  assert.match(assessSite(neverDl).problems.join(), /never downloaded/);
});

test('Bing: not in the account, not verified, no sitemap, error status → problems', () => {
  const out = healthy(); out.bing = { inAccount: false };
  assert.match(assessSite(out).problems.join(), /not in the agency Bing Webmaster account/);
  const unv = healthy(); unv.bing = { inAccount: true, verified: false };
  assert.match(assessSite(unv).problems.join(), /not verified/);
  const nofeed = healthy(); nofeed.bing.feed = null;
  assert.match(assessSite(nofeed).problems.join(), /never submitted/);
  const bad = healthy(); bad.bing.feed.Status = 'Failed';
  assert.match(assessSite(bad).problems.join(), /status "Failed"/);
  const pending = healthy(); pending.bing.feed.Status = 'Pending';
  assert.deepEqual(assessSite(pending).problems, []);
});

test('submission failure: a production build older than the grace period that was never announced', () => {
  const missed = healthy(); missed.manifest.builtAt = daysBefore(1); missed.google.sitemap.lastSubmitted = daysBefore(3);
  assert.match(assessSite(missed).problems.join(), /never announced to Google/);
  const bingMissed = healthy(); bingMissed.manifest.builtAt = daysBefore(1); bingMissed.bing.feed.Submitted = bingDate(daysBefore(3));
  assert.match(assessSite(bingMissed).problems.join(), /never announced to Bing/);
  const justDeployed = healthy(); justDeployed.manifest.builtAt = new Date(NOW - 30 * 60_000).toISOString(); justDeployed.google.sitemap.lastSubmitted = daysBefore(3);
  assert.deepEqual(assessSite(justDeployed).problems, [], `within ${BARS.announceGraceHours} h the job may still be running`);
  const noManifest = healthy(); noManifest.manifest = null;
  assert.deepEqual(assessSite(noManifest).problems, [], 'no manifest yet = not rolled out: a note, not a problem');
  assert.match(assessSite(noManifest).notes.join(), /not rolled out/);
});

test('IndexNow key file not served → problem; no key → note; engines not checked or erroring', () => {
  const dead = healthy(); dead.indexNow = { key: 'abcdef12', reachable: false, detail: 'HTTP 404' };
  assert.match(assessSite(dead).problems.join(), /abcdef12\.txt is not served \(HTTP 404\)/);
  const nokey = healthy(); nokey.indexNow = { key: null };
  assert.deepEqual(assessSite(nokey).problems, []);
  const blind = healthy(); blind.google = { notChecked: 'GOOGLE_TOKEN_JSON not set' }; blind.bing = { error: 'GetUserSites → 401: invalid key' };
  const r = assessSite(blind);
  assert.equal(r.cells.google, 'not checked');
  assert.match(r.problems.join(), /Bing Webmaster Tools could not be read: GetUserSites → 401/);
});

test('weekOf: the Monday (UTC) of the week', () => {
  assert.equal(weekOf(new Date('2026-10-26T13:00:00Z')), '2026-10-26'); // a Monday
  assert.equal(weekOf(new Date('2026-11-01T23:00:00Z')), '2026-10-26'); // the Sunday after
  assert.equal(weekOf(new Date('2026-10-27T00:30:00Z')), '2026-10-26');
});
