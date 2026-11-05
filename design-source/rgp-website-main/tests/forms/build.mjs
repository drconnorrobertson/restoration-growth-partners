/**
 * Builds the starter for the forms tests (tests/forms/astro-test.config.mjs: Cloudflare's always-pass TEST Turnstile
 * key, client id "forms-test", Careers connected / Partner not) into `<tmp>/dist`, then runs postbuild.
 * `node --test` runs the test files in parallel; two Astro builds in one project at the same moment share .astro/,
 * so builds take turns through a lock directory. Nothing here reaches a real router.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const LOCK = join(ROOT, 'tests/forms/.tmp-lock');
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function lock() {
  for (let waited = 0; ; waited += 250) {
    try { mkdirSync(LOCK); return; } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      // A lock older than 5 minutes was left by a killed run.
      try { if (Date.now() - statSync(LOCK).mtimeMs > 300_000) rmSync(LOCK, { recursive: true, force: true }); } catch { /* gone */ }
      if (waited > 600_000) throw new Error(`forms test build lock ${LOCK} held for 10 minutes`);
      sleep(250);
    }
  }
}

/** Build into `${tmp}/dist`; returns the dist path. */
export function buildFormsSite(tmp) {
  const env = {
    ...process.env,
    FORMS_TEST_TMP: `${tmp.replace(/\/+$/, '')}/`,
    BLOG_POSTS_DIR: join(ROOT, 'tests/blog/fixtures/posts'),
    BLOG_QA_DIR: join(ROOT, 'tests/blog/fixtures/qa'),
    BLOG_BUILD_TIME: '2026-10-13T12:00:00Z',
  };
  const dist = join(tmp, 'dist');
  lock();
  try {
    rmSync(tmp, { recursive: true, force: true });
    const b = spawnSync('npx', ['astro', 'build', '--config', 'tests/forms/astro-test.config.mjs'], { cwd: ROOT, env, encoding: 'utf8' });
    assert.equal(b.status, 0, `astro build failed:\n${b.stdout}\n${b.stderr}`);
    const p = spawnSync('node', ['--experimental-strip-types', 'postbuild.mjs', dist], { cwd: ROOT, env, encoding: 'utf8' });
    assert.equal(p.status, 0, `postbuild failed:\n${p.stdout}\n${p.stderr}`);
  } finally {
    rmSync(LOCK, { recursive: true, force: true });
  }
  return dist;
}
