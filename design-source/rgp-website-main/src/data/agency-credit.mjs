/**
 * Agency footer credit (CORE_CONTRACTS §30, owner decision 2026-10-20). One source for the footer
 * (SiteFooter.astro) and the built-HTML check (scripts/validate-built-html.mjs) — change the wording
 * here only with the owner's approval, and every client site picks it up on its next build.
 *
 * Rendered on every page, in the footer's bottom (legal) bar, as:
 *   <p data-agency-credit>Website Design, Development, &amp; AI SEO by
 *     <a href="https://www.restorationgrowthpartners.com/" target="_blank" rel="noopener">Restoration Growth Partners</a></p>
 * A normal followed link: never rel="nofollow", "sponsored" or "ugc"; never "noreferrer" (it hides the
 * referral visit in the agency's analytics).
 */
export const AGENCY_CREDIT = {
  lead: 'Website Design, Development, & AI SEO by',
  name: 'Restoration Growth Partners',
  url: 'https://www.restorationgrowthpartners.com/',
};
