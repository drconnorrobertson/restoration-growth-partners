#!/usr/bin/env node
/**
 * indexnow-submit.mjs — tell IndexNow search engines (Bing, Yandex, Naver, Seznam, Yep) about the
 * live site's URLs (CORE_CONTRACTS §28, Launch Checklist step 7b). Google does not use IndexNow;
 * Search Console's sitemap stays the route to Google, so run this AFTER that submission.
 *
 * After launch this is NOT the normal route: every production deploy runs the workflow "Tell search engines"
 * (.github/workflows/search-notify.yml → scripts/search-notify.mjs), which sends only the pages that changed.
 * This command stays for the launch-day submission and for a deliberate manual send.
 *
 * Usage (from starter/, on the LAUNCHED site):
 *   npm run indexnow:submit                  every URL in the live /sitemap.xml (launch)
 *   npm run indexnow:submit -- <url> [...]   only the pages you changed (later updates)
 *   npm run indexnow:submit -- --dry-run     print what would be sent, send nothing
 *
 * Refuses to run while site.previewMode is true (a noindexed site must not be announced), when
 * site.indexNow.key is empty, or when the key file is not live at {siteUrl}/{key}.txt.
 * IndexNow asks for submissions only when content is added, changed, or removed — do not re-run
 * it for unchanged pages; repeat submissions get rate-limited (HTTP 429).
 * The IndexNow calls themselves live in scripts/lib/indexnow.mjs (shared with the post-deploy job).
 */
import { site } from '../src/data/site.ts';
import { KEY_PATTERN, checkKeyFile, sitemapUrls, submitIndexNow } from './lib/indexnow.mjs';

const argv = process.argv.slice(2);
const DRY = argv.includes('--dry-run');
const explicit = argv.filter((a) => !a.startsWith('--'));
const fail = (msg) => { console.error(`✗ indexnow:submit — ${msg}`); process.exit(1); };

if (site.previewMode) fail('site.previewMode is true — launch the site (previewMode false, validate:launch, deploy) before announcing it');
const key = site.indexNow?.key ?? '';
if (!KEY_PATTERN.test(key)) fail('site.indexNow.key is empty or invalid (8–128 letters, digits, dashes)');
const origin = String(site.siteUrl).replace(/\/$/, '');
const host = new URL(origin).host;

try { await checkKeyFile({ origin, key }); } catch (e) { fail(e.message); }

let urls;
try { urls = [...new Set(explicit.length ? explicit : await sitemapUrls(`${origin}/sitemap.xml`))]; } catch (e) { fail(e.message); }
if (!urls.length) fail('no URLs to submit');

console.log(`indexnow:submit — ${urls.length} URL(s) for ${host}${DRY ? ' (dry run)' : ''}`);
try { await submitIndexNow({ origin, key, urls, dryRun: DRY }); } catch (e) { fail(e.message); }
console.log('A 200/202 means the engines received the URLs, not that they are indexed. Check Bing Webmaster Tools → IndexNow for what was picked up.');
