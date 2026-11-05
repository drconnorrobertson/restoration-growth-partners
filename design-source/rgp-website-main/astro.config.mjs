import { defineConfig, fontProviders } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import sitemap from '@astrojs/sitemap';
import icon from 'astro-icon';
import blogSchedule from './src/integrations/blog-schedule.mjs';
import { site } from './src/data/site';

/**
 * Fonts (§20) through Astro's Fonts API: the files below are copied into the build (self-hosted, no
 * remote font requests), BaseLayout preloads the two faces the first screen uses, and Astro generates
 * size-matched fallback faces so text does not jump when the web font arrives. The files come from
 * the Fontsource packages in node_modules, so the build needs no network for fonts.
 * Per client: change the family names, weights and package/file names HERE only — theme.css reads
 * --font-display-face / --font-body-face and never names a family. Latin subset only.
 */
const fontsource = (pkg, weights) =>
  weights.map((w) => ({ src: [`./node_modules/@fontsource/${pkg}/files/${pkg}-latin-${w}-normal.woff2`], weight: String(w), style: 'normal' }));
const fonts = [
  { provider: fontProviders.local(), name: 'Barlow Condensed', cssVariable: '--font-display-face', fallbacks: ['Arial Narrow', 'sans-serif'], options: { variants: fontsource('barlow-condensed', [600, 700]) } },
  { provider: fontProviders.local(), name: 'Barlow', cssVariable: '--font-body-face', fallbacks: ['Segoe UI', 'system-ui', 'sans-serif'], options: { variants: fontsource('barlow', [400, 500, 600, 700]) } },
];

/**
 * `site` is required for canonical URLs and for the sitemap to emit absolute production
 * URLs (CORE_CONTRACTS §21, §22). It is read from src/data/site.ts (siteUrl) so canonical URLs,
 * the sitemap, robots.txt, and schema all derive from one value.
 */
export default defineConfig({
  site: site.siteUrl,
  fonts,
  integrations: [
    // §29: one build time for the whole build; future-dated posts are not built (src/utils/blog-schedule.mjs).
    blogSchedule(),
    // §17: Lucide is the only icon set, inlined at build (no runtime JS). Usage: <Icon name="lucide:phone" />
    icon({ include: { lucide: ['*'] } }),
    sitemap({
      /**
       * §21: only approved canonical, indexable routes belong in the sitemap.
       * Template preview routes are noindex,nofollow and are excluded from sitemaps by
       * contract (§17). The internal client-preview route is not a production page.
       */
      filter: (page) =>
        !page.includes('/templates/') && !page.includes('/clients/'),
    }),
  ],
  vite: {
    plugins: [tailwindcss()],
  },
});
