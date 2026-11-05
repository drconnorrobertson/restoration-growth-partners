/**
 * Astro config for the Turnstile tests ONLY (npm run test:forms). It is the blog-test config (real starter
 * config + hub stubs, fixture posts) plus a Vite transform that gives site.leadRouter a Turnstile site key
 * and a client id — the starter ships both EMPTY, so a plain build renders no widget at all. A client
 * site's real key and id are replaced too, so the test runs the same in client repos (part of check:built).
 * It also marks the Careers form connected and the Partner form not connected (careersReady / partnerReady).
 * FORMS_TEST_TMP moves the output, so two test files can build at the same time.
 * The key is Cloudflare's published always-pass TEST site key; nothing here reaches a real router.
 * Output goes to tests/forms/.tmp/dist; the real dist/ is untouched.
 */
import { fileURLToPath } from 'node:url';
import blogTest from '../blog/astro-test.config.mjs';

const tmp = process.env.FORMS_TEST_TMP ?? fileURLToPath(new URL('./.tmp/', import.meta.url));
export const TEST_SITE_KEY = '1x00000000000000000000AA';

const turnstileKey = {
  name: 'forms-test-turnstile-key',
  enforce: 'pre',
  transform(code, id) {
    if (!/[\\/]src[\\/]data[\\/]site\.ts$/.test(id.split('?')[0])) return null;
    const out = code
      .replace(/turnstileSiteKey:\s*'[^']*'/, `turnstileSiteKey: '${TEST_SITE_KEY}'`)
      .replace(/clientId:\s*'[^']*'/, `clientId: 'forms-test'`)
      // The Careers form as connected (live, posts to the router), the Partner form as not yet connected (disabled,
      // "not connected" notice) — so one build exercises both states (tests/forms/standard-forms.test.mjs).
      .replace(/careersReady:\s*(true|false)/, 'careersReady: true')
      .replace(/partnerReady:\s*(true|false)/, 'partnerReady: false');
    if (out === code || !/careersReady: true/.test(out) || !/partnerReady: false/.test(out))
      throw new Error('forms test: site.leadRouter shape changed — update tests/forms/astro-test.config.mjs');
    return { code: out, map: null };
  },
};

export default {
  ...blogTest,
  outDir: `${tmp}dist`,
  cacheDir: `${tmp}cache`,
  vite: { ...blogTest.vite, plugins: [turnstileKey, ...(blogTest.vite?.plugins ?? [])] },
};
