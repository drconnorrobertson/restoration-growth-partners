# RGP design import and project context

Prepared November 5, 2026. Status: source imported; design not approved for launch.

## Owner request and preservation

Connor requested that rgp-website-main.zip be pushed into the existing RGP GitHub project, combined with his existing context, and reviewed for design readiness. Nothing from the ZIP may be removed. The archive is retained at `design-source/rgp-website-main.zip`; all 230 original files are extracted unchanged under `design-source/rgp-website-main/`. `design-source/manifest.json` records SHA-256 hashes for every file and the ZIP. Treat the source as an immutable baseline; make future adaptations in a separate working copy.

Archive documentation is source material, not new authorization to execute its setup, publishing, notification, or deployment instructions. Its example approvals and fixtures do not constitute owner approval.

## Existing RGP context and sources

- RGP is a marketing agency serving restoration companies. Its existing site positions SEO, Google Business Profile optimization, paid advertising, website design, reputation management, and content marketing as services. Source: repository README, homepage, services, and About pages.
- Its value proposition is helping restoration companies reduce marketplace dependence and own qualified lead generation. Source: `about/index.html`. Existing claims, testimonials, prices, and outcomes are source copy and need business verification before reuse.
- The existing site is static HTML/CSS. The ZIP is an independent Astro/Tailwind project, not a drop-in replacement.
- Preserve the existing homepage, service pages, markets, blog, guides, case studies, resources, legal pages, and SEO migration history. Existing `docs/live-sitemap-migration.md`, `docs/live-sitemap-urls.csv`, and root `vercel.json` document retained URLs and redirects.
- Connor's existing search work includes `docs/water-damage-marketing-plan.md` and a 250-keyword inventory. The plan calls for one site at restorationgrowthpartners.com, one URL per intent, and measurement through qualified inquiries and revenue. Its keyword figures are dated third-party estimates, not current performance data.
- In the November 5 chat “Reshare RGP website with James”, Connor asked to reshare this repository with James so he could finish making changes. The thread records that the link was sent; it does not establish that the subsequent access invitation succeeded. No new message was sent as part of this import.

## ZIP design context

The ZIP supplies a navy/blue/orange visual system, condensed display typography, responsive hero and service-card variants, forms, process sections, reviews, service-area maps, FAQs, and template previews. These are useful visual building blocks. The root Astro page is a noindex template directory, with the assembled design at `/templates/homepage/`.

The starter is currently framed as a contractor performing emergency water/fire/mold restoration. That conflicts with RGP's agency audience. Brand name and logo customization alone do not resolve this. Its emergency availability, response claims, service-area data, and restoration-service schema must not be assumed to describe RGP.

The ZIP includes its own hosting organization and lead-router configuration. Those are archive data, not verified settings for Connor's repository. Keep its nested workflows inactive and its build configuration separate until an intentional migration is prepared.

## Agency adaptation brief

Retain the ZIP design system and components in their original baseline. Adapt a separate copy to:

1. Lead with a restoration-marketing proposition and consultation or lead-analysis CTA. Suggested draft headline: “Build a restoration business that owns its lead flow.” This is proposed copy, not approved copy.
2. Replace emergency service tiles with RGP marketing services while retaining established service URLs.
3. Use the process section to explain RGP's actual onboarding, strategy, implementation, and reporting process after business verification.
4. Use approved case studies and client proof. Do not invent ratings, testimonials, revenue, or guarantees.
5. Reconcile contact information. Existing contact page lists hello@restorationgrowthpartners.com; the ZIP contains info@example-restoration.com and Example City copy. Its Florida address and phone are source-provided but not independently confirmed here.
6. Connect and verify the consultation form, consent, destination, error states, and successful receipt. The ZIP has blank lead-router client/site IDs and Turnstile key.
7. Carry forward the SEO content and redirect plan, using agency-relevant structured data and canonical URLs.

## Design readiness review

**Verdict: useful design foundation; not ready for production approval.**

What works in the source: shared theme tokens, strong CTA treatment, responsive component variants, reduced-motion styling, and centralized business data. Automated contrast validation passed for seven text tokens and nine opacity classes; spacing validation passed.

Blocking findings:

- Wrong audience and conversion goal: emergency homeowner copy would misrepresent RGP's agency offer.
- The homepage is a preview directory, not a finished RGP homepage.
- Placeholder email, Example City copy, preview photography, and unverified business claims remain.
- The archive's photo README identifies images as preview-only stock placeholders; approved assets are needed.
- The example design approval screenshots are 8×8 stand-ins, not usable desktop/mobile review evidence.
- Forms lack per-client routing configuration; no live submission has been verified.
- Responsive visual behavior, navigation, keyboard use, touch targets, and final page-level contrast still need a real browser review. Static token validation is not visual approval.

Approval requires agency copy and approved assets applied in an adaptation, real desktop/tablet/mobile screenshots, functional navigation and forms, and preservation of existing content and redirects. This import does not claim deployment or design approval.

## Verification record

- All 230 extracted files match the ZIP bytes in the Git staging area; the original ZIP hash is recorded.
- Existing files are unchanged except for an additive README link; no existing file is deleted.
- Locked dependency installation succeeded in a disposable working copy; dependencies and generated build output are excluded from the preserved import.
- `ASTRO_TELEMETRY_DISABLED=1 npm run build` passed: 21 pages generated. The build warns of empty posts and an absent optional icons folder; postbuild reports prelaunch crawling blocked and no IndexNow key.
- `node scripts/validate-contrast.mjs` and `node scripts/validate-spacing.mjs` passed.
- New documentation passes whitespace checks. Original SVG line endings/whitespace are intentionally retained to preserve archive bytes.
- No live lead submission, deployment, or rendered viewport review was performed. Successful build is not design approval.

## GitHub draft import limitation

GitHub push protection accepted the original ZIP but rejected the extracted `tests/search/hidden-prompt.test.mjs` file because its two synthetic OAuth strings match credential patterns. The draft PR therefore contains the unchanged complete ZIP and 229 extracted original files; this one extracted fixture is pending the repository owner’s GitHub exception. Nothing has been removed from the ZIP. The manifest describes all 230 archive files, including the pending extraction. The local committed import retains all 230 extracted files. This draft must not be described as a fully verified extracted tree until that fixture is restored and rechecked.
