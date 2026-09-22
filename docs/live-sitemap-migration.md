# Live sitemap migration inventory

Captured from https://www.restorationgrowthpartners.com/sitemap.xml on 2026-09-22. The public domain remains on the current site. Do not point it to Vercel until every `rebuild` row has an equivalent page or an explicitly approved redirect and all 25 legacy paths are tested on the Vercel deployment.

| Status | Count | Meaning |
| --- | ---: | --- |
| Retained | 6 | Same-content route exists on Vercel |
| Redirect | 9 | Permanent redirect added in vercel.json to a close equivalent |
| Rebuild | 10 | Distinct live content needs migration before cutover |

| Live path | Status | Vercel destination |
| --- | --- | --- |
| `/case-studies/american-water-damage-restoration` | redirect | `/case-studies/american-water-damage/` |
| `/pricing` | retained | `/pricing/` |
| `/cgp-lead-analysis-projection` | rebuild | **Pending** |
| `/case-studies/sunshine-restoration` | retained | `/case-studies/sunshine-restoration/` |
| `/restoration-growth` | rebuild | **Pending** |
| `/our-process` | retained | `/our-process/` |
| `/cgp-book-a-call` | redirect | `/contact/` |
| `/lead-generation-for-home-services` | rebuild | **Pending** |
| `/contractor-growth-partners-test` | redirect | `/` |
| `/case-studies/romexterra-restoration` | retained | `/case-studies/romexterra-restoration/` |
| `/cgp-about-us` | redirect | `/about/` |
| `/about-us` | redirect | `/about/` |
| `/case-studies` | retained | `/case-studies/` |
| `/case-studies/restoration-heroes` | rebuild | **Pending** |
| `/` | retained | `/` |
| `/restoration-growth-video` | rebuild | **Pending** |
| `/case-studies/ercolano-cleaning-and-restoration` | redirect | `/case-studies/ercolano-cleaning-restoration/` |
| `/schedule-a-call` | redirect | `/contact/` |
| `/case-studies/1-800-water-damage-of-utah-county` | redirect | `/case-studies/1800-water-damage-utah/` |
| `/home-old` | redirect | `/` |
| `/voda-packages` | rebuild | **Pending** |
| `/united-water-restoration-group-packages` | rebuild | **Pending** |
| `/make-the-most-of-the-season-by-following-these-simple-guidelines` | rebuild | **Pending** |
| `/keep-in-touch-with-site-visitors-and-boost-loyalty` | rebuild | **Pending** |
| `/tips-for-writing-great-posts-that-increase-your-site-traffic` | rebuild | **Pending** |

The three general blog posts, two package pages, two training pages, the lead analysis page, the home-services article, and Restoration Heroes case study are the ten pages still requiring content migration. Preserve their relevant text, media, offers, and conversion paths before switching the domain. Do not add these incomplete URLs to Vercel's XML sitemap.
