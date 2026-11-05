/**
 * Turnstile loads on first lead-form interaction, never with the page (CORE_CONTRACTS §11, §28).
 *
 * Unit: scripts/lib/turnstile-checks.mjs (shared with validate:built) flags api.js in a <script src>,
 * a page-load hint to challenges.cloudflare.com, and a widget with no loader — and passes a good page.
 * Build: the starter built WITH a Turnstile test site key (tests/forms/astro-test.config.mjs) has
 *   · no page whose HTML loads turnstile/v0/api.js or hints its origin;
 *   · the loader (<script data-turnstile-loader>) on every page that renders a widget, each widget
 *     inside a lead form with the status live region next to it;
 *   · validate:built passing on the real output, and FAILING once api.js is put back in a page head.
 * The browser behaviour (held submit, "Verifying…", timeout error) is verified by hand on a local
 * preview — see the PR that added this file.
 * Run: npm run test:forms (builds into tests/forms/.tmp/, never touches dist/).
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkTurnstileLoading } from '../../scripts/lib/turnstile-checks.mjs';
import { buildFormsSite } from './build.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const TMP = join(ROOT, 'tests/forms/.tmp');
const DIST = join(TMP, 'dist');
const env = {
  ...process.env,
  BLOG_POSTS_DIR: join(ROOT, 'tests/blog/fixtures/posts'),
  BLOG_QA_DIR: join(ROOT, 'tests/blog/fixtures/qa'),
  BLOG_BUILD_TIME: '2026-10-13T12:00:00Z',
};
const sh = (cmd, args) => spawnSync(cmd, args, { cwd: ROOT, env, encoding: 'utf8' });
function* walk(dir) { for (const e of readdirSync(dir)) { const p = join(dir, e); if (statSync(p).isDirectory()) yield* walk(p); else yield p; } }
const pages = () => [...walk(DIST)].filter((f) => f.endsWith('.html')).map((f) => ({ file: relative(DIST, f), path: f, html: readFileSync(f, 'utf8') }));

const LOADER = '<script data-turnstile-loader>(function(){})();</script>';
const WIDGET = '<form data-lead-form><div class="cf-turnstile max-w-full" data-sitekey="k"></div></form>';
const page = (head, body) => `<!doctype html><html lang="en"><head>${head}</head><body>${body}</body></html>`;

// --- unit -----------------------------------------------------------------------------------------
test('check: a form page with the loader and no api.js passes', () => {
  assert.deepEqual(checkTurnstileLoading(page(LOADER, WIDGET)), []);
  assert.deepEqual(checkTurnstileLoading(page('', '<p>no form here</p>')), []);
});

test('check: api.js in a <script src> fails — async, defer, explicit render or not', () => {
  for (const tag of [
    '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js"></script>',
    '<script async defer src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=onTurnstileReady"></script>',
    "<script is:inline src='//challenges.cloudflare.com/turnstile/v0/api.js' async></script>",
  ]) {
    const errors = checkTurnstileLoading(page(LOADER + tag, WIDGET));
    assert.equal(errors.length, 1, tag);
    assert.match(errors[0], /api\.js loads with the page/);
  }
});

test('check: a page-load hint to challenges.cloudflare.com fails', () => {
  for (const rel of ['preconnect', 'dns-prefetch', 'preload']) {
    const errors = checkTurnstileLoading(page(`${LOADER}<link rel="${rel}" href="https://challenges.cloudflare.com">`, WIDGET));
    assert.equal(errors.length, 1, rel);
    assert.match(errors[0], /challenges\.cloudflare\.com/);
  }
});

test('check: a widget without the loader fails', () => {
  const errors = checkTurnstileLoading(page('', WIDGET));
  assert.equal(errors.length, 1);
  assert.match(errors[0], /without the on-interaction loader/);
});

// --- build ----------------------------------------------------------------------------------------
before(() => {
  // Same build as before (astro build with the test config into tests/forms/.tmp, then postbuild), taking turns
  // with the other forms test file through build.mjs's lock.
  buildFormsSite(TMP);
});

test('build: no page loads turnstile/v0/api.js or hints its origin at page load', () => {
  const all = pages();
  assert.ok(all.length > 5, 'pages were built');
  for (const { file, html } of all) {
    assert.ok(!/<script\b[^>]*\bsrc="[^"]*turnstile\/v0\/api\.js/i.test(html), `${file} loads api.js in a <script src>`);
    assert.ok(!/<link\b[^>]*challenges\.cloudflare\.com/i.test(html), `${file} hints challenges.cloudflare.com`);
  }
});

test('build: every page with a lead form widget carries the loader once, with the live region in the form', () => {
  const withWidget = pages().filter((p) => /class="cf-turnstile\b/.test(p.html));
  assert.ok(withWidget.length > 5, `the test key rendered widgets (${withWidget.length} pages)`);
  for (const { file, html } of withWidget) {
    assert.equal((html.match(/<script\b[^>]*data-turnstile-loader/g) ?? []).length, 1, `${file}: loader exactly once`);
    assert.ok(html.includes('1x00000000000000000000AA'), `${file}: the widget carries the site key`);
    const forms = html.match(/<form\b[^>]*data-lead-form[\s\S]*?<\/form>/g) ?? [];
    assert.equal(forms.length, (html.match(/class="cf-turnstile\b/g) ?? []).length, `${file}: one widget per lead form`);
    for (const f of forms) {
      assert.match(f, /class="cf-turnstile\b/, `${file}: widget inside the form`);
      assert.match(f, /data-turnstile-status[^>]*role="status"[^>]*aria-live="polite"/, `${file}: status live region inside the form`);
    }
  }
  // The loader injects api.js with explicit render and the router's field name.
  const loader = withWidget[0].html.match(/<script\b[^>]*data-turnstile-loader[^>]*>([\s\S]*?)<\/script>/)[1];
  assert.match(loader, /turnstile\/v0\/api\.js\?render=explicit&onload=onTurnstileReady/);
  assert.match(loader, /'response-field-name': 'cf-turnstile-response'/);
  assert.match(loader, /appearance: 'interaction-only'/);
  for (const ev of ['focusin', 'pointerdown', 'touchstart', 'keydown']) assert.ok(loader.includes(`'${ev}'`), `listens for ${ev}`);
});

test('build: validate:built passes, and fails once api.js is back in a page head', () => {
  const ok = sh('node', ['scripts/validate-built-html.mjs', DIST]);
  assert.equal(ok.status, 0, `validate:built should pass:\n${ok.stdout}\n${ok.stderr}`);

  const target = pages().find((p) => /class="cf-turnstile\b/.test(p.html) && !p.file.startsWith('templates/'));
  writeFileSync(target.path, target.html.replace('</head>', '<script async defer src="https://challenges.cloudflare.com/turnstile/v0/api.js"></script></head>'));
  try {
    const bad = sh('node', ['scripts/validate-built-html.mjs', DIST]);
    assert.notEqual(bad.status, 0, 'validate:built must fail');
    assert.match(bad.stderr, /Turnstile api\.js loads with the page/);
  } finally {
    writeFileSync(target.path, target.html);
  }
});
