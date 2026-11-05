/**
 * Astro config for the GTM build test ONLY (tests/scripts/gtm-build.test.mjs, npm run test:scripts). It is the
 * blog-test config (real starter config + hub stubs, fixture posts) plus a Vite transform that gives
 * site.analytics a GTM container id — the starter ships it EMPTY, so a plain build renders no GTM at all. A
 * client site's real id is replaced too, so the test runs the same in client repos (part of check:built).
 * Output goes to tests/scripts/.tmp/dist; the real dist/ is untouched.
 */
import { fileURLToPath } from 'node:url';
import blogTest from '../blog/astro-test.config.mjs';

const tmp = fileURLToPath(new URL('./.tmp/', import.meta.url));
export const TEST_GTM_ID = 'GTM-TEST123';

const gtmId = {
  name: 'scripts-test-gtm-id',
  enforce: 'pre',
  transform(code, id) {
    if (!/[\\/]src[\\/]data[\\/]site\.ts$/.test(id.split('?')[0])) return null;
    const out = code.replace(/gtmId:\s*'[^']*'/, `gtmId: '${TEST_GTM_ID}'`);
    if (out === code) throw new Error('GTM test: site.analytics shape changed — update tests/scripts/astro-gtm-test.config.mjs');
    return { code: out, map: null };
  },
};

export default {
  ...blogTest,
  outDir: `${tmp}dist`,
  cacheDir: `${tmp}cache`,
  vite: { ...blogTest.vite, plugins: [gtmId, ...(blogTest.vite?.plugins ?? [])] },
};
