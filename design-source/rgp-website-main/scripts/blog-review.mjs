#!/usr/bin/env node
/**
 * blog-review.mjs — the developer's ONE review page for a blog batch (CORE_CONTRACTS §29, Stage F step 5).
 * Deterministic: no AI step. The covers are the build's own (src/utils/blog-cover.mjs via the real build).
 *
 *  1. Throwaway all-published build: copies src/content/posts/*.json to .blog-review/posts with
 *     draft:false, builds the site into .blog-review/dist (own cache; the real dist/ and content cache are
 *     untouched) with the build time set after the last publishDate, so every post and its cover is built.
 *     Skipped with --dist <dir> (an existing all-published build).
 *  2. Writes <out>/index.html + <out>/covers/{slug}.png: a contact sheet of every cover, then per post the
 *     date, headline, Google description, URL, word count, parent page, body, FAQs, and its QA record
 *     (verdict, reviewer, what QA fixed, open questions) from docs/blog/qa/{slug}.md. Topics skipped at
 *     scheduling (docs/blog/skipped.tsv: row_id, slug, reason) are listed at the end.
 *
 * Usage (client repo root):
 *   node --experimental-strip-types scripts/blog-review.mjs [--out .blog-review/review] [--dist <dir>]
 *        [--posts src/content/posts] [--qa docs/blog/qa] [--schedule docs/blog/schedule.tsv]
 * Open <out>/index.html in a browser. .blog-review/ is git-ignored — the page is never committed.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadPostFiles, formatPostDate } from '../src/utils/blog-schedule.mjs';
import { QA_DIR, parseQaRecord, qaRecordProblem } from './lib/blog-qa.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export const wordCount = (html) => String(html ?? '').replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').split(/\s+/).filter(Boolean).length;

/** Rows of a TSV with a header line, as objects ([] when the file is absent). */
export function readTsv(file) {
  if (!file || !existsSync(file)) return [];
  const [head, ...rows] = readFileSync(file, 'utf8').split(/\r?\n/).filter((l) => l.trim());
  const cols = head.split('\t').map((c) => c.trim());
  return rows.map((r) => Object.fromEntries(r.split('\t').map((v, i) => [cols[i], v.trim()])));
}

/**
 * The page. posts: post objects (sorted here by publishDate); qa: Map(slug -> record text | undefined);
 * covers: Map(slug -> relative image path | undefined); schedule/skipped: TSV rows; siteUrl: links in the
 * bodies open the live site. Pure function — same input, same bytes.
 */
export function renderReviewPage({ posts, qa = new Map(), covers = new Map(), schedule = [], skipped = [], siteUrl = '', title = 'Blog batch review' }) {
  const list = [...posts].sort((a, b) => new Date(a.publishDate) - new Date(b.publishDate) || a.slug.localeCompare(b.slug));
  const rowOf = new Map(schedule.map((r) => [r.slug, r]));
  const origin = siteUrl.replace(/\/$/, '');
  const live = (h) => (origin ? String(h).replace(/href="(\/[^"]*)"/g, `href="${origin}$1" target="_blank" rel="noopener"`) : String(h));
  const status = (p) => {
    const text = qa.get(p.slug);
    if (text === undefined) return { ok: false, label: 'No QA record' };
    const why = qaRecordProblem(text);
    return why ? { ok: false, label: parseQaRecord(text).verdict || 'QA record incomplete' } : { ok: true, label: parseQaRecord(text).verdict };
  };
  const ready = list.filter((p) => status(p).ok).length;
  const badge = (p) => { const s = status(p); return `<span class="b ${s.ok ? 'ok' : 'no'}">${esc(s.label)}</span>`; };
  const img = (p, cls) => (covers.get(p.slug) ? `<img class="${cls}" src="${esc(covers.get(p.slug))}" alt="" loading="lazy">` : `<div class="${cls} none">no cover</div>`);

  const sheet = list.map((p) => `<a class="tile" href="#${esc(p.slug)}">${img(p, 'thumb')}<span><b>${esc(formatPostDate(p.publishDate))}</b> ${esc(p.title)}</span>${badge(p)}</a>`).join('');
  const articles = list.map((p, i) => {
    const row = rowOf.get(p.slug) ?? {};
    const text = qa.get(p.slug);
    const { reviewer } = parseQaRecord(text ?? '');
    const faqs = (p.faqs ?? []).map((f) => `<details><summary>${esc(f.question)}</summary><p>${esc(f.answer)}</p></details>`).join('') || '<p class="small">No FAQs.</p>';
    return `<article id="${esc(p.slug)}">
<div class="meta"><span>#${i + 1} · ${esc(formatPostDate(p.publishDate))}${row.row_id ? ` · ${esc(row.row_id)}` : ''}${p.draft ? ' · draft' : ' · draft:false'}</span>${badge(p)}</div>
<h1>${esc(p.title)}</h1>
${img(p, 'cover')}
<p class="small"><b>Google description</b> (${String(p.description ?? '').length}/160): ${esc(p.description)}</p>
<p class="small">/blog/${esc(p.slug)}/ · ${wordCount(p.html).toLocaleString('en-US')} words · parent ${esc(p.parent)}${row.primary_keyword ? ` · keyword “${esc(row.primary_keyword)}”` : ''}${p.cluster ? ` · cluster ${esc(p.cluster)}` : ''}${(p.related ?? []).length ? ` · related ${esc(p.related.join(', '))}` : ''}</p>
<div class="qa"><b>QA${reviewer ? ` — ${esc(reviewer)}` : ''}:</b>${text === undefined ? '<p>No QA record at docs/blog/qa/' + esc(p.slug) + '.md — this post cannot be approved.</p>' : `<pre>${esc(text.trim())}</pre>`}</div>
<div class="post">${live(p.html)}</div>
<h2 class="fq">FAQs</h2>${faqs}
<p class="top"><a href="#top">↑ contact sheet</a></p>
</article>`;
  }).join('\n');
  const skippedHtml = skipped.length ? `<section class="skipped"><h2>Topics skipped at scheduling (${skipped.length})</h2><ul>${skipped.map((r) => `<li><b>${esc(r.row_id ?? '')}</b> ${esc(r.slug ?? '')} — ${esc(r.reason ?? '')}</li>`).join('')}</ul></section>` : '';
  const first = list[0]?.publishDate;
  const last = list.at(-1)?.publishDate;

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>
:root{--bg:#fbfaf8;--fg:#1d1d1f;--mut:#666;--card:#fff;--line:#e4e1dc;--ok:#1f7a3d;--okbg:#e5f4ea;--no:#8a1c1c;--nobg:#fbe3e3;--qa:#f3f1ec;--acc:#b5361d}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#161616;--fg:#ececec;--mut:#a5a5a5;--card:#1f1f1f;--line:#333;--ok:#7fd49a;--okbg:#17321f;--no:#ff9b9b;--nobg:#3a1616;--qa:#262420;--acc:#ff8a6b}}
:root[data-theme="dark"]{--bg:#161616;--fg:#ececec;--mut:#a5a5a5;--card:#1f1f1f;--line:#333;--ok:#7fd49a;--okbg:#17321f;--no:#ff9b9b;--nobg:#3a1616;--qa:#262420;--acc:#ff8a6b}
body{background:var(--bg);color:var(--fg);font:17px/1.6 Georgia,serif;margin:0;padding:0 16px}
main{max-width:1100px;margin:0 auto;padding:32px 0 80px}
header h1{font:700 30px/1.2 system-ui,sans-serif;margin:0 0 8px}
.lead,.small,.meta,.top,.tile,.qa{font-family:system-ui,sans-serif}
.lead{color:var(--mut);font-size:15px}
.sheet{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:14px;margin:20px 0}
.tile{display:flex;flex-direction:column;gap:6px;color:var(--fg);text-decoration:none;font-size:13px;line-height:1.35}
.thumb{width:100%;aspect-ratio:1200/630;border-radius:6px;border:1px solid var(--line);object-fit:cover}
.none{display:flex;align-items:center;justify-content:center;background:var(--nobg);color:var(--no);font:600 13px system-ui,sans-serif}
.b{font:600 11px system-ui,sans-serif;padding:2px 7px;border-radius:10px;white-space:nowrap;align-self:flex-start}
.ok{background:var(--okbg);color:var(--ok)}.no{background:var(--nobg);color:var(--no)}
article{max-width:760px;margin:36px auto;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:24px}
article h1{font:700 26px/1.25 system-ui,sans-serif;margin:8px 0}
.cover{width:100%;aspect-ratio:1200/630;border-radius:6px;margin:8px 0}
.meta{display:flex;justify-content:space-between;gap:8px;font-size:13px;color:var(--mut)}
.small{font-size:14px;color:var(--mut);margin:4px 0}
.qa{background:var(--qa);border-radius:8px;padding:10px 14px;margin:14px 0;font-size:14px}
.qa pre{white-space:pre-wrap;font:13px/1.5 ui-monospace,Menlo,monospace;margin:6px 0 0}
.post h2{font:700 21px/1.3 system-ui,sans-serif;margin:26px 0 6px}.post h3{font:700 17px system-ui,sans-serif;margin:18px 0 4px}
.post a,.top a{color:var(--acc)}
.fq{font:700 18px system-ui,sans-serif;margin-top:28px;border-top:1px solid var(--line);padding-top:16px}
details{border-bottom:1px solid var(--line);padding:6px 0}summary{cursor:pointer;font:600 15px system-ui,sans-serif}
.skipped{max-width:760px;margin:36px auto;font-family:system-ui,sans-serif;font-size:14px}
</style></head><body><main id="top">
<header><h1>${esc(title)}</h1>
<p class="lead">${list.length} post(s)${first ? `, one per Wednesday, ${esc(formatPostDate(first))} → ${esc(formatPostDate(last))}` : ''}. ${ready} of ${list.length} have a Ready QA record. Covers are the build's own automatic covers (CORE_CONTRACTS §29). Approve by merging the PR that sets <code>draft: false</code> on the approved posts; the Wednesday workflow then publishes each on its date. Links open the live site.</p></header>
<section class="sheet">${sheet}</section>
${articles}
${skippedHtml}
</main></body></html>
`;
}

/** Step 1: the throwaway all-published build. Returns its dist folder. */
function allPublishedBuild(postsDir, work) {
  rmSync(work, { recursive: true, force: true });
  const posts = join(work, 'posts');
  mkdirSync(posts, { recursive: true });
  let latest = Date.now();
  for (const p of loadPostFiles(postsDir)) {
    const { id, ...data } = p;
    data.draft = false;
    if (data.heroImage) data.heroImage = relative(posts, resolve(postsDir, data.heroImage)); // image paths are relative to the post file
    latest = Math.max(latest, new Date(data.publishDate).getTime() || 0);
    writeFileSync(join(posts, `${id}.json`), JSON.stringify(data, null, 2));
  }
  const config = join(work, 'astro.review.config.mjs');
  writeFileSync(config, `import base from ${JSON.stringify(pathToFileURL(join(ROOT, 'astro.config.mjs')).href)};\nexport default { ...base, root: ${JSON.stringify(ROOT)}, outDir: ${JSON.stringify(join(work, 'dist'))}, cacheDir: ${JSON.stringify(join(work, 'cache'))} };\n`);
  const r = spawnSync('npx', ['astro', 'build', '--config', relative(ROOT, config)], {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, BLOG_POSTS_DIR: posts, BLOG_BUILD_TIME: new Date(latest + 60_000).toISOString() },
  });
  if (r.status !== 0) {
    console.error('✗ blog-review: the all-published build failed — fix the error above (it would also fail the real build once these posts are approved).');
    process.exit(1);
  }
  return join(work, 'dist');
}

async function main() {
  const arg = (name, def) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : def; };
  const postsDir = resolve(ROOT, arg('--posts', 'src/content/posts'));
  const qaDir = resolve(ROOT, arg('--qa', QA_DIR));
  const out = resolve(ROOT, arg('--out', '.blog-review/review'));
  const posts = loadPostFiles(postsDir);
  if (!posts.length) { console.error(`✗ blog-review: no post files in ${postsDir}`); process.exit(1); }
  const dist = arg('--dist') ? resolve(ROOT, arg('--dist')) : allPublishedBuild(postsDir, resolve(ROOT, '.blog-review/build'));

  rmSync(out, { recursive: true, force: true });
  mkdirSync(join(out, 'covers'), { recursive: true });
  const covers = new Map();
  const qa = new Map();
  for (const p of posts) {
    const built = join(dist, 'blog', p.slug, 'cover.png');
    const source = p.heroImage ? resolve(postsDir, p.heroImage) : built;
    if (existsSync(source)) {
      const name = `covers/${p.slug}${extname(source)}`;
      copyFileSync(source, join(out, name));
      covers.set(p.slug, name);
    }
    const record = join(qaDir, `${p.slug}.md`);
    if (existsSync(record)) qa.set(p.slug, readFileSync(record, 'utf8'));
  }
  const { site } = await import('../src/data/site.ts'); // body links open the live site
  const page = renderReviewPage({
    posts,
    qa,
    covers,
    schedule: readTsv(resolve(ROOT, arg('--schedule', 'docs/blog/schedule.tsv'))),
    skipped: readTsv(resolve(ROOT, arg('--skipped', 'docs/blog/skipped.tsv'))),
    siteUrl: arg('--site', site.siteUrl ?? ''),
    title: arg('--title', 'Blog batch review'),
  });
  writeFileSync(join(out, 'index.html'), page);
  const missing = posts.filter((p) => !covers.has(p.slug)).map((p) => p.slug);
  console.log(`✓ blog-review: ${join(out, 'index.html')} — ${posts.length} post(s), ${covers.size} cover(s), ${qa.size} QA record(s)${missing.length ? `; NO cover for: ${missing.join(', ')}` : ''}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
