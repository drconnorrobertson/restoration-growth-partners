/**
 * Astro config for the blog tests ONLY (npm run test:blog). It is the real starter config plus:
 *  · output to tests/blog/.tmp/dist (or $BLOG_TEST_TMP/dist) and its own cache, so the real dist/ and content cache are untouched;
 *  · stub pages at every site.services hub URL and every shell link (utility + legal nav), because the
 *    starter has no such pages and posts link to them (validate:built fails dead links). The stubs
 *    render the real layout and inner-page template.
 * The fixture posts come from BLOG_POSTS_DIR (set by the test) — never from src/content/posts.
 */
import { fileURLToPath } from 'node:url';
import base from '../../astro.config.mjs';
import { site } from '../../src/data/site.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));
const tmp = process.env.BLOG_TEST_TMP ?? fileURLToPath(new URL('./.tmp/', import.meta.url));

const hubStubs = {
  name: 'blog-test-hub-stubs',
  hooks: {
    'astro:config:setup': ({ injectRoute }) => {
      const urls = [...new Set([...site.services, ...site.utilityNav, ...site.legalLinks].map((l) => l.url).filter((u) => u !== '/'))];
      for (const url of urls) injectRoute({ pattern: url.replace(/\/$/, ''), entrypoint: fileURLToPath(new URL('./fixtures/HubStub.astro', import.meta.url)) });
    },
  },
};

export default {
  ...base,
  root,
  outDir: `${tmp}dist`,
  cacheDir: `${tmp}cache`,
  integrations: [...base.integrations, hubStubs],
};
