# Agency Restoration Starter

Astro 7 + Tailwind v4 starter implementing the `emergency_split_hero` archetype.

- Archetype spec: `../docs/agency-website-system/design-system/EMERGENCY_SPLIT_HERO_ARCHETYPE.md`
- Token contract: `../docs/agency-website-system/design-system/DESIGN_TOKENS.md`
- Variant registry consumed by design recipes: `../docs/agency-website-system/schemas/design-recipe.yaml`

## Per-client theming

`src/styles/theme.css` is the only file that changes per client. Everything else is shared.

## Rules baked in

- Tokens only — arbitrary Tailwind values (`p-[13px]`, `text-[#hex]`) are banned in components.
- All phone actions read from `src/data/site.ts` (`phoneHref` is the approved DNI source, §9).
- `overflow-x: clip` on root, never `hidden` (§12 sticky survival).
- `prefers-reduced-motion` respected globally.
- Shell-mounted header/footer/sticky CTA — never per-page (§10, §17).

## Component build order (Phase 2 remaining work)

Build one at a time, verify each against the archetype composition rules with a live
preview + screenshots before moving on. Each component ships with its variants from the
recipe registry and a `/templates/` noindex preview route (§17).

1. ✅ `SiteHeader.astro` — utility strip + sticky header, phone CTA dominant (§9); mobile: call / logo / menu
2. ✅ `StickyMobileCTA.astro` — `[data-mobile-sticky-cta]`, reveals after ~50% of first viewport (§10)
3. ✅ `Hero.astro` (variant: `image_backed_split_form`) + `RequestServicePanel.astro` (§11)
4. ✅ `EmergencyCTABand.astro` — accent stripe band, pulse dot, phone CTA with number
5. ✅ `ServiceGrid.astro` (variant: `image_overlay_grid`) — photo cards with chips; gradient placeholder until client photos land
6. ✅ `DifferentiatorVS.astro` (variant: `dark_advantage_board`) — ✗/✓ comparison module
7. ✅ `ProcessSection.astro` (variant: `dark_timeline_cards`) — numbered cards, desktop connectors
8. ✅ `ReviewSection.astro` (variants: `real_widget_stacked` via slot, `reserved_polished_state` fallback) (§16)
9. ✅ `ServiceAreaMap.astro` (variant: `map_with_county_accordions`) — Leaflet + county/city accordions, auto-init on load (§15)
10. ✅ `FAQSection.astro` — accordion cards, accent open state
11. ✅ `FinalCTA.astro` (variant: `dark_phone_first_band`)
12. ✅ `SiteFooter.astro` (variant: `full_nap_service_footer`) — mounted from BaseLayout (§13)

### Second variants (differentiation layer)

- ✅ `HeroFullBleed.astro` — `premium_full_bleed`: centered full-bleed hero, chips row, no side form (pair with a form section directly below)
- ✅ `ServiceGridIcons.astro` — `icon_plus_media_cards`: icon-tile cards for clients without strong photography
- ✅ `ProcessStepper.astro` — `numbered_connector_steps`: light horizontal stepper, 3-5 steps, vertical rail on mobile
- ✅ `RegionalServiceExplorer.astro` — `regional_service_explorer`: county tabs + cross-county city search + map, for large service areas

Variant registry (which are BUILT vs PLANNED): `../docs/agency-website-system/schemas/design-recipe.yaml`.

### Preview routes (all noindex, §17)

- `/` — full homepage assembly, default (red) tokens, with placeholder photography
- `/templates/inner-page` — the inner-page template with realistic service content
- `/templates/contact-page` — the contact page template with three locations
- `/templates/sections-a` — services grid + differentiator
- `/templates/sections-b` — process + reviews
- `/templates/sections-c` — service area + FAQ
- `/templates/sections-d` — footer in isolation
- `/templates/variants-b1`, `variants-b2` — the second variants (icon service cards +
  light stepper; regional service explorer) in isolation

To see per-client theming, point the `./theme.css` import in `src/styles/global.css` at
`src/styles/themes/green-state-example.css` — the whole site re-brands from one file.
13. Optional modules: `InsuranceBand.astro`, `SocialCards.astro`, `CommercialGrid.astro`, `IntroSection.astro`
14. ✅ Image components: `HeroImage.astro` (LCP: eager, fetchpriority=high, AVIF/WebP, never a CSS background) and `OptimizedImage.astro` (lazy content images). Wired into Hero, IntroSection, ServiceGrid cards, and ProcessSection backgrounds. Placeholder photos in `src/assets/photos/` are PREVIEW-ONLY — see that folder's README; shipping them is a build blocker. `GalleryImage.astro` still to build.
15. ✅ `templates/ContactPageTemplate.astro` (§13) — phone-first hero → request section FIRST
    (two columns: when-to-call support card with phone/response-time/email, shared form beside it)
    → `ContactLocations.astro` NAP cards for every approved GBP location. Preview:
    `/templates/contact-page`. Reviews/About/city-hub pages reuse InnerPageTemplate — no separate
    templates needed.
16. Schema utilities (§22), then the validation scripts.

✅ `templates/InnerPageTemplate.astro` — the two-column service/city/city-service layout (§12):
   compact `PageHero`, editorial left column with typographic defaults, sticky sidebar
   (form-first, proof card, `SidebarNav` with hard-capped smart navigation), post-body slot.
   Body modules: ✅ `InlineCTA` (required 2x per page), ✅ `ContentAlertList`,
   ✅ `IncludedPanel`, ✅ `InnerSubsections`.
   Preview route: `/templates/inner-page` (realistic water-damage content, noindex).
   Verified: sticky pins at 96px and releases with the body; mobile sidebar drops below
   the article, static; no horizontal overflow; nav capped in code.

## Commands

```bash
npm install
npm run dev      # local preview
npm run check    # astro check + artifacts + pipeline state + contrast + spacing (§17)
npm run build    # production build
npm run check:built  # spacing + build + built-HTML checks + lead-form test (test:forms)
```

Planned validation commands (`optimize:images`, `validate:images`, `validate:forms`,
`validate:sitemap`, `audit:launch`) land with the corresponding components.
