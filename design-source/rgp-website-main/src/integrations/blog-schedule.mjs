/**
 * Blog schedule integration (§29). Two jobs:
 *  1. Fix ONE build time for the whole build (BLOG_BUILD_TIME), so every page, the index, the RSS feed
 *     and the sitemap agree on which posts are live — see src/utils/blog-schedule.mjs → buildTime().
 *  2. Record that time next to the output (`{outDir}/../.astro/blog-build.json`, never inside the
 *     published output) so postbuild and validate:built judge the build by the time it was built at.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

export const buildInfoPath = (outDir) => join(dirname(outDir), '.astro', `blog-build-${basename(outDir)}.json`);

export default function blogSchedule() {
  return {
    name: 'agency-blog-schedule',
    hooks: {
      'astro:config:setup': ({ logger }) => {
        if (process.env.BLOG_BUILD_TIME) logger.warn(`BLOG_BUILD_TIME is set (${process.env.BLOG_BUILD_TIME}) — posts are scheduled against that fixed time. Tests only; never set it in Vercel.`);
        else process.env.BLOG_BUILD_TIME = new Date().toISOString();
      },
      'astro:build:done': ({ dir }) => {
        const out = fileURLToPath(dir).replace(/\/$/, '');
        const file = buildInfoPath(out);
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, JSON.stringify({ buildTime: process.env.BLOG_BUILD_TIME, outDir: out }, null, 2));
      },
    },
  };
}
