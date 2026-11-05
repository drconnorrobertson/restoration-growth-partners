/**
 * A GTM-enabled build passes validate:built (CORE_CONTRACTS §19, §28).
 *
 * BaseLayout's GTM <noscript> fallback is an <iframe>, and validate:built fails every iframe with no title
 * (Accessibility frame-title) or not loading="lazy" (§28). Before 2026-10-28 the frame had neither, so every
 * client with site.analytics.gtmId set failed validate:built / validate:launch with 2 errors per page (Phantom
 * Restoration, Stage 7 round 2: 110 errors across 55 pages).
 * Build: the starter built WITH a GTM test id (tests/scripts/astro-gtm-test.config.mjs) has
 *   · the GTM loader in <head> and the noscript frame (title + loading="lazy") on every page;
 *   · validate:built passing on the real output, and FAILING once the frame loses its title and loading.
 * Run: npm run test:scripts (builds into tests/scripts/.tmp/, never touches dist/).
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const TMP = join(ROOT, 'tests/scripts/.tmp');
const DIST = join(TMP, 'dist');
const GTM_ID = 'GTM-TEST123'; // = TEST_GTM_ID in astro-gtm-test.config.mjs
const env = {
  ...process.env,
  BLOG_POSTS_DIR: join(ROOT, 'tests/blog/fixtures/posts'),
  BLOG_QA_DIR: join(ROOT, 'tests/blog/fixtures/qa'),
  BLOG_BUILD_TIME: '2026-10-13T12:00:00Z',
};
const sh = (cmd, args) => spawnSync(cmd, args, { cwd: ROOT, env, encoding: 'utf8' });
function* walk(dir) { for (const e of readdirSync(dir)) { const p = join(dir, e); if (statSync(p).isDirectory()) yield* walk(p); else yield p; } }
const pages = () => [...walk(DIST)].filter((f) => f.endsWith('.html')).map((f) => ({ file: relative(DIST, f), path: f, html: readFileSync(f, 'utf8') }));
const frameOf = (html) => html.match(/<noscript>\s*(<iframe\b[^>]*googletagmanager\.com\/ns\.html[^>]*>)/)?.[1];

before(() => {
  rmSync(TMP, { recursive: true, force: true });
  const b = sh('npx', ['astro', 'build', '--config', 'tests/scripts/astro-gtm-test.config.mjs']);
  assert.equal(b.status, 0, `astro build failed:\n${b.stdout}\n${b.stderr}`);
  const p = sh('node', ['--experimental-strip-types', 'postbuild.mjs', DIST]);
  assert.equal(p.status, 0, `postbuild failed:\n${p.stdout}\n${p.stderr}`);
});

test('build: every page has the GTM loader in <head> and a titled, lazy noscript frame', () => {
  // The starter's root index.html is a standalone template directory, not BaseLayout; a client homepage replaces it.
  const all = pages().filter((p) => p.file !== 'index.html' || p.html.includes('data-component="request-service"'));
  assert.ok(all.length > 5, 'pages were built');
  for (const { file, html } of all) {
    const head = html.slice(0, html.indexOf('</head>'));
    assert.ok(head.includes(`'dataLayer','${GTM_ID}'`), `${file}: GTM loader in <head>`);
    const frame = frameOf(html);
    assert.ok(frame, `${file}: GTM noscript frame`);
    assert.ok(frame.includes(`ns.html?id=${GTM_ID}`), `${file}: frame carries the container id`);
    assert.match(frame, /\btitle="Google Tag Manager"/, `${file}: frame has a title`);
    assert.match(frame, /\bloading="lazy"/, `${file}: frame is loading="lazy"`);
  }
});

test('build: validate:built passes, and fails once the frame loses its title and loading', () => {
  const ok = sh('node', ['scripts/validate-built-html.mjs', DIST]);
  assert.equal(ok.status, 0, `validate:built should pass with GTM set:\n${ok.stdout}\n${ok.stderr}`);

  const target = pages().find((p) => frameOf(p.html) && !p.file.startsWith('templates/') && p.file !== '404.html');
  const frame = frameOf(target.html);
  writeFileSync(target.path, target.html.replace(frame, frame.replace(' title="Google Tag Manager" loading="lazy"', '')));
  try {
    const bad = sh('node', ['scripts/validate-built-html.mjs', DIST]);
    assert.notEqual(bad.status, 0, 'validate:built must fail');
    assert.match(bad.stderr, /iframe has no title \(Accessibility frame-title\)/);
    assert.match(bad.stderr, /iframe is not loading="lazy"/);
  } finally {
    writeFileSync(target.path, target.html);
  }
});
