# RGP marketing playbook library

This is a static, navigable library of 4,000 practical marketing worksheets: 10 restoration specialties × 10 property audiences × 40 distinct operator tasks. Another 151 pages provide navigation by specialty, audience and task. The library uses the applied ZIP design; the original ZIP and imported baseline are unchanged.

## Build and validate

From the repository root:

```sh
python3 content-engine/generate.py
python3 content-engine/validate.py
node --check assets/playbooks.js
```

Python uses only its standard library. Generation is deterministic for the catalog and release date. `catalog.py` contains service boundaries, customer coordination requirements and task-specific objectives, steps, worked worksheet entries, success measures, mistakes and reference URLs. `generate.py` combines those inputs into a complete operator worksheet, editable working copy, internal links, metadata and structured data. The generator does not fetch or invent search-volume data, business qualifications, customer outcomes, local offices or market statistics.

The main page content is server-rendered HTML. JavaScript adds local filtering, worksheet personalization, CSV export and calculators. No worksheet input is submitted to RGP or saved by this tool. Formula-like CSV cells are neutralized, and calculators check nonnegative input and percentage limits. Main content remains accessible without JavaScript.

## Keyword and editorial status

`keyword-inventory.csv` maps each of the 4,000 proposed long-tail targets to one URL and its specific service/audience/task. Targets are editorial hypotheses, not a validated demand forecast. The connected GSC Wizard account refused queries because it has no active subscription. Search volumes, ranking difficulty, existing impressions, indexing and traffic are therefore unverified. The library does not claim guaranteed results or imply that publication proves indexing.

Each page has a different worked service/buyer scenario and task output. Shared process guidance remains consistent where the underlying advice is the same. These are generated practical resources, not 4,000 separately researched client case studies. Do not represent example terms, copy concepts or calculation inputs as actual campaign data. Consolidate or improve pages when real search and usage evidence shows overlap or limited usefulness; do not multiply synonym pages merely to increase URL count.

## Canonical host and discovery

The canonical origin is `https://restoration-growth-partners.vercel.app`, the production site deployed from this repository. On November 5, 2026, `www.restorationgrowthpartners.com` still served a separate site. This release does not migrate that domain or alter its DNS. Do not canonical new pages to an origin that does not serve them.

`/playbooks` is linked from the homepage and resources index. The hierarchy reaches every new URL. `sitemap-playbooks.xml` is an index for nine chunks, each with no more than 500 URLs; robots.txt advertises that index. Existing content, sitemap and redirect configuration are retained. An authenticated Google sitemap submission remains unavailable through the inactive GSC subscription; robots discovery is enabled, not a substitute claim of successful submission.

## Verification

`validation-report.json` records all-page checks: 4,000 unique target phrases, 4,151 unique titles/headings/descriptions, self-referencing canonicals, indexable directives, structured data, internal link and asset existence, root-hub reachability, sitemap membership, and original archive integrity. Main body hashes identify files, not semantic originality; do not treat a hash as proof that search engines will consider a page unique or useful.

Browser checks cover desktop/mobile library and detail rendering, no page-level horizontal overflow at 390px, worksheet personalization, CSV export, scenario arithmetic and invalid input rejection. Calculator outputs use explicit visitor inputs and are not performance predictions.

Reference foundations:

- [Google people-first content guidance](https://developers.google.com/search/docs/fundamentals/creating-helpful-content)
- [Google scaled content abuse policy](https://developers.google.com/search/docs/essentials/spam-policies#scaled-content)
- [Google sitemap guidance](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap)
- [Google canonicalization](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls)
- [Google Ads negative keywords](https://support.google.com/google-ads/answer/2453972)
- [Business Profile representation rules](https://support.google.com/business/answer/3038177)
- [Google Search AI features](https://developers.google.com/search/docs/appearance/ai-features)
