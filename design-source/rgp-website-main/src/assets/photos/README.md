# Placeholder photography — PREVIEW ONLY

These images exist so the starter's template preview routes can be judged with real
photographic weight instead of gradient panels. They are generic stock placeholders
sourced from picsum.photos, **not** restoration imagery and **not** licensed for
client use.

## Rules

- NEVER ship these to a client site. Replace every one with the client's own approved
  photography (their crews, trucks, job sites) during the build (§18 asset plan).
- A production build that still references `placeholder-*` files is a build blocker,
  not a cosmetic detail — same rule as leftover placeholder copy.
- Client photos go through the intake/source folder first, then render through
  `HeroImage.astro` / `OptimizedImage.astro`, never as raw `<img src>` (§18).
