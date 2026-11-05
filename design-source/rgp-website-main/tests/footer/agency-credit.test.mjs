/**
 * Agency footer credit (CORE_CONTRACTS §30): scripts/lib/agency-credit-checks.mjs (shared with
 * validate:built) passes the starter's markup and fails every way the credit can go wrong.
 * The real build is covered by validate:built in check:built (every page must pass).
 * Run: npm run test:footer
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkAgencyCredit } from '../../scripts/lib/agency-credit-checks.mjs';

const GOOD_LINK = '<a href="https://www.restorationgrowthpartners.com/" target="_blank" rel="noopener" class="underline">Restoration Growth Partners</a>';
const credit = (inner = `Website Design, Development, &amp; AI SEO by ${GOOD_LINK}`, attrs = '') => `<p data-agency-credit${attrs}>\n  ${inner}\n</p>`;
const page = (footer) => `<!doctype html><html lang="en"><body><main>x</main><footer>${footer}</footer></body></html>`;
const fails = (html, re) => assert.ok(checkAgencyCredit(html).some((m) => re.test(m)), `expected ${re} in ${JSON.stringify(checkAgencyCredit(html))}`);

test('the starter markup passes', () => {
  assert.deepEqual(checkAgencyCredit(page(credit())), []);
  assert.deepEqual(checkAgencyCredit(page(credit(`Website Design, Development, & AI SEO by ${GOOD_LINK.replace('https://www.', 'https://').replace('.com/', '.com')}`))), []);
});

test('missing or duplicated credit fails', () => {
  fails(page('<p>© 2026 Client LLC</p>'), /no agency footer credit/);
  fails(page(credit() + credit()), /appears 2×/);
});

test('wrong wording or link text fails', () => {
  fails(page(credit(`Website by ${GOOD_LINK}`)), /must read exactly/);
  fails(page(credit(`Website Design, Development, &amp; AI SEO by ${GOOD_LINK.replace('>Restoration Growth Partners<', '>RGP<')}`)), /link text is "RGP"/);
});

test('missing, extra or wrong link fails', () => {
  fails(page(credit('Website Design, Development, &amp; AI SEO by Restoration Growth Partners')), /has 0 links/);
  fails(page(credit(`Website Design, Development, &amp; AI SEO by ${GOOD_LINK.replace('restorationgrowthpartners.com/', 'example.com/')}`)), /must link to/);
});

test('nofollow, sponsored, ugc and noreferrer fail', () => {
  for (const rel of ['nofollow', 'noopener nofollow', 'sponsored', 'ugc', 'noopener noreferrer'])
    fails(page(credit(`Website Design, Development, &amp; AI SEO by ${GOOD_LINK.replace('rel="noopener"', `rel="${rel}"`)}`)), /normal followed link/);
});

test('a hidden credit fails', () => {
  fails(page(credit(undefined, ' hidden')), /is hidden/);
  fails(page(credit(undefined, ' aria-hidden="true"')), /is hidden/);
  fails(page(credit(undefined, ' class="sr-only"')), /is hidden/);
  fails(page(credit(undefined, ' style="display:none"')), /is hidden/);
});
