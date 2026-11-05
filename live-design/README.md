# Applied ZIP design

The live homepage is built from the original ZIP’s Astro components and theme. The original archive and source under `design-source/` are preserved. `overrides/` contains the agency adaptations: homepage copy, business data, booking panel, CTA labels, and service schema. The original homepage is retained in `legacy-homepage.html` and Git history.

Run `node live-design/build.mjs` from the repository root with Node 24. It copies the preserved source into a temporary build directory, overlays the adaptations, installs the locked dependencies, builds Astro, and publishes the generated homepage and runtime assets into this static site. Vercel continues deploying the root static output.

`publish.mjs` also wraps existing editorial pages from baseline commit c7cd558 with the ZIP header/footer and self-hosted fonts. Their original main content, metadata, URLs and root redirects remain. Their legacy CSS is scoped to the content region so it cannot override the ZIP navigation. Update the baseline deliberately when rebuilding editorial content from a newer source revision.

The homepage uses the ZIP’s designed graphic fallbacks instead of preview-only stock photos. Its booking CTA links to the calendar configured in the original ZIP; no unconfigured lead form is displayed. No appointment or test lead is submitted during verification.
