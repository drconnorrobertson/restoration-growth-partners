/**
 * /llms.txt "## Service areas" (scripts/lib/llms-service-areas.mjs, written by postbuild.mjs — CORE_CONTRACTS §21):
 * hubs are found in each city's own state, and the text claims city-service pages only where they are built.
 * Multi-state shape is Phantom Restoration's (NC + SC hubs, no city-service pages — client fix a65fc5c).
 * Run: npm run test:search
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hubUrl, serviceAreasSection } from '../../scripts/lib/llms-service-areas.mjs';

const ORIGIN = 'https://example.com';
const city = (slug, state) => ({ slug, name: slug, county: 'X', state, zone: 'near', near: [] });
const link = (route, label) => `- [${label}](${ORIGIN}${route})`;
// A fake dist: `routes` are the built pages; childrenOf lists built pages one level under a route.
const section = (cities, routes) => {
  const set = new Set(routes);
  const childrenOf = (route) => routes.filter((r) => r.startsWith(route) && r !== route && !r.slice(route.length, -1).includes('/'));
  return serviceAreasSection({ cities, origin: ORIGIN, built: (r) => set.has(r), childrenOf, link });
};

test('hub URL uses the city\'s own state', () => {
  assert.equal(hubUrl(city('rock-hill', 'SC')), '/rock-hill-sc/');
});

test('single state, every hub has city-service pages: the original wording', () => {
  const { text, hubs } = section(
    [city('austin', 'TX'), city('round-rock', 'TX')],
    ['/service-areas/', '/austin-tx/', '/austin-tx/water-damage-restoration/', '/round-rock-tx/', '/round-rock-tx/water-damage-restoration/'],
  );
  assert.equal(hubs.length, 2);
  assert.match(text, /^## Service areas\n\n- \[All 2 cities served\]\(https:\/\/example\.com\/service-areas\/\)\n/);
  assert.ok(text.includes(`Each of the 2 cities has a hub page at ${ORIGIN}/{city}-tx/ (for example ${ORIGIN}/austin-tx/), linking to that city's service pages. The complete inventory is in the sitemap.`), text);
});

test('multi-state (Phantom: NC + SC, no city-service pages): every hub counted, no city-service claim', () => {
  const cities = [city('charlotte', 'NC'), city('concord', 'NC'), city('rock-hill', 'SC'), city('fort-mill', 'SC')];
  const { text, hubs } = section(cities, ['/service-area/', ...cities.map(hubUrl)]);
  assert.deepEqual(hubs.map((c) => c.slug), ['charlotte', 'concord', 'rock-hill', 'fort-mill'], 'SC hubs are not dropped');
  assert.ok(text.includes('All 4 cities served'));
  assert.ok(text.includes(`Each of the 4 cities has a hub page at ${ORIGIN}/{city}-{nc|sc}/ (for example ${ORIGIN}/charlotte-nc/ and ${ORIGIN}/rock-hill-sc/). The complete inventory`), text);
  assert.ok(!text.includes('service pages'), 'no claim of city-service pages that do not exist');
});

test('some hubs have city-service pages: the claim is counted, not universal', () => {
  const { text } = section(
    [city('frankford', 'DE'), city('selbyville', 'DE'), city('ocean-city', 'MD')],
    ['/frankford-de/', '/frankford-de/water-damage-restoration/', '/selbyville-de/', '/ocean-city-md/'],
  );
  assert.ok(text.includes('{city}-{de|md}/'), text);
  assert.ok(text.includes('. 1 of the 3 hubs links to that city\'s service pages. '), text);
  assert.ok(!text.includes('All 3 cities served'), 'no service-area index link when none is built');
});

test('unbuilt cities are skipped; no hubs = no section', () => {
  const { text: one } = section([city('austin', 'TX'), city('waco', 'TX')], ['/austin-tx/']);
  assert.ok(one.includes('The 1 city has a hub page'), one);
  assert.deepEqual(section([city('austin', 'TX')], []), { text: '', hubs: [] });
});
