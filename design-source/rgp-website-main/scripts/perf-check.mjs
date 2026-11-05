#!/usr/bin/env node
/**
 * perf-check.mjs — PageSpeed Insights gate (CORE_CONTRACTS §28). PageSpeed Insights runs Lighthouse on
 * Google's servers, so every client is measured the same way, and it returns the diagnostics that say
 * WHAT to fix, not only a score.
 *
 * Usage (from starter/):
 *   npm run perf:check -- <url> [<url> …] [--preview]      (key: env PAGESPEED_API_KEY, a key file saved by the retired search:setup, or the GitHub org variable PAGESPEED_API_KEY)
 * Review stage: the §24 set (homepage, one service, one city hub, one city-service, contact) on the
 * preview URL. After launch: the same set on the production domain (agents/08).
 * The key is free (Google Cloud → APIs → PageSpeed Insights API → Credentials). Keyless requests share
 * a tiny public quota and fail with HTTP 429, so the script requires a key.
 *
 * Bars (mobile; median of RUNS runs, because Lighthouse moves a few points run to run) — owner
 * decision 2026-10-05:
 *   Performance ≥ 90 · LCP ≤ 2.5 s · CLS ≤ 0.1 · TBT ≤ 200 ms (lab stand-in for INP ≤ 200 ms)
 *   Accessibility 100 · Best Practices 100 · SEO 100
 *   Agentic Browsing: every scored audit passes (Lighthouse shows it as a fraction, e.g. 4/4)
 * SEO on a preview: the site is noindex until launch (§17), which fails Lighthouse's is-crawlable
 * audit by design. With --preview (or a *.vercel.app URL) that one audit is excused; everything
 * else in SEO must still pass. On the production domain SEO must be a real 100.
 *
 * Third-party findings the site cannot fix (a provider's cache headers, a chat vendor's avatar) can be
 * excused ONLY by a human-approved entry in artifacts/perf/accepted-risks.yaml:
 *   - audit: uses-long-cache-ttl         # Lighthouse audit id
 *     url: https://example.com/          # optional — omit to cover every page
 *     reason: Elfsight and LeadConnector set their own cache headers; we cannot proxy them.
 *     approved_by: Jane Doe
 *     approved_at: 2026-10-05
 *     approval_quote: "accept the third-party cache warning"   # the human's words, verbatim
 * Performance score and Core Web Vitals can never be accepted away.
 *
 * Output: artifacts/perf/perf-report-YYYY-MM-DD.json (everything) and artifacts/perf/fix-list.json —
 * every failing audit with its category, Lighthouse id and the elements/resources it names, which is
 * what the Review fix loop (agents/07, at most 3 rounds) works from.
 *
 * A preview behind Vercel's login (Deployment Protection) cannot be reached by PageSpeed Insights;
 * test the production URL, or a preview with protection off.
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { parse as parseYaml } from 'yaml';

const CRITERIA = {
  metrics: { performance: 90, lcpMs: 2500, cls: 0.1, tbtMs: 200 },
  perfect: ['accessibility', 'best-practices', 'seo'], // must be 100
  agentic: 'every scored audit passes',
};
const CATEGORIES = ['performance', 'accessibility', 'best-practices', 'seo', 'agentic-browsing'];
const RUNS = 3;
const TOP_FIXES = 6;
const PASS = 0.9; // Lighthouse's pass threshold for an audit in a fraction-scored category

const argv = process.argv.slice(2);
const urls = argv.filter((a) => /^https?:\/\//.test(a));
const previewFlag = argv.includes('--preview');
// PAGESPEED_API_KEY, or a key file left by the retired `npm run search:setup` (outside the repo).
const keyFile = join(homedir(), '.config', 'agency-website-builder', 'pagespeed-api-key');
// Third source (owner decision 2026-10-14): the GitHub organization variable PAGESPEED_API_KEY, shared with the
// client repo, so anyone with access to the repo can run this without a per-computer setup. Read through the
// repo's "organization variables" endpoint, which any collaborator can read (no org-admin scope needed).
function keyFromGitHub() {
  try {
    const remote = execSync('git remote get-url origin', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const m = remote.match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?$/);
    if (!m) return '';
    return execSync(`gh api repos/${m[1]}/${m[2]}/actions/organization-variables --jq '.variables[] | select(.name=="PAGESPEED_API_KEY") | .value'`,
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch { return ''; }
}
const key = process.env.PAGESPEED_API_KEY || (existsSync(keyFile) ? readFileSync(keyFile, 'utf8').trim() : '') || keyFromGitHub();
if (!key) { console.error('✗ perf:check — no PageSpeed API key: not in PAGESPEED_API_KEY, no key file on this computer, and not readable from the GitHub organization variable PAGESPEED_API_KEY (needs `gh` signed in with access to this repo)'); process.exit(1); }
if (!urls.length) { console.error('✗ perf:check — pass one or more page URLs'); process.exit(1); }

// Accepted risks: human-approved only (§28). A malformed entry is an error, never silently ignored.
const RISKS_PATH = 'artifacts/perf/accepted-risks.yaml';
let risks = [];
if (existsSync(RISKS_PATH)) {
  const raw = parseYaml(readFileSync(RISKS_PATH, 'utf8')) ?? [];
  const list = Array.isArray(raw) ? raw : raw.risks ?? [];
  for (const [i, r] of list.entries()) {
    const missing = ['audit', 'reason', 'approved_by', 'approved_at', 'approval_quote'].filter((k) => !String(r?.[k] ?? '').trim());
    if (missing.length) { console.error(`✗ ${RISKS_PATH} entry ${i + 1} (${r?.audit ?? '?'}) lacks ${missing.join(', ')} — an accepted risk needs the human's approval quote`); process.exit(1); }
    if (['performance', 'largest-contentful-paint', 'cumulative-layout-shift', 'total-blocking-time'].includes(r.audit)) {
      console.error(`✗ ${RISKS_PATH}: "${r.audit}" cannot be accepted — the Performance score and Core Web Vitals are hard bars (§28)`); process.exit(1);
    }
    risks.push(r);
  }
}
const accepted = (auditId, url) => risks.find((r) => r.audit === auditId && (!r.url || r.url === url));

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const ms = (v) => `${(v / 1000).toFixed(2)} s`;

async function run(url) {
  const q = new URLSearchParams({ url, strategy: 'mobile', key });
  for (const c of CATEGORIES) q.append('category', c);
  const res = await fetch(`https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${q}`);
  const body = await res.json();
  if (!res.ok || body.error) throw new Error(body.error?.message ?? `HTTP ${res.status}`);
  return body;
}

/** Elements / resources a failing audit points at, for the fix list. */
function targets(audit) {
  const out = [];
  const walk = (items) => {
    // Some audits (newer Lighthouse insights) give `items` as an object, not a list — skip those.
    for (const it of Array.isArray(items) ? items : []) {
      if (out.length >= 8) return;
      if (it?.node?.selector || it?.node?.snippet) out.push({ selector: it.node.selector, snippet: it.node.snippet?.slice(0, 200), label: it.node.nodeLabel?.slice(0, 80) });
      else if (it?.url || it?.source?.url) out.push({ url: it.url ?? it.source.url, ...(it.wastedBytes ? { wastedKiB: Math.round(it.wastedBytes / 1024) } : {}) });
      if (it?.subItems?.items) walk(it.subItems.items);
      if (Array.isArray(it?.items)) walk(it.items);
    }
  };
  walk(audit.details?.items);
  return out;
}

/** Failing audits of one category in one Lighthouse result. */
function failingAudits(lhr, cat, threshold) {
  const c = lhr.categories[cat];
  if (!c) return null;
  return c.auditRefs
    .map((ref) => ({ ref, a: lhr.audits[ref.id] }))
    .filter(({ a }) => a && typeof a.score === 'number' && !['notApplicable', 'informative', 'manual'].includes(a.scoreDisplayMode) && a.score < threshold)
    .map(({ ref, a }) => ({ category: cat, id: ref.id, title: a.title, score: a.score, display: a.displayValue ?? '', targets: targets(a) }));
}

let failed = 0;
const report = [];
const fixList = [];
for (const url of urls) {
  const preview = previewFlag || /\.vercel\.app$/i.test(new URL(url).hostname);
  const runs = [];
  for (let i = 0; i < RUNS; i++) {
    try { runs.push(await run(url)); } catch (e) { console.error(`✗ ${url}: ${e.message}`); failed++; break; }
  }
  if (runs.length < RUNS) continue;
  const lh = runs.map((r) => r.lighthouseResult);
  const score = (cat) => median(lh.map((l) => Math.round((l.categories[cat]?.score ?? 0) * 100)));
  const num = (audit) => median(lh.map((l) => l.audits[audit]?.numericValue ?? 0));
  const m = { performance: score('performance'), lcpMs: num('largest-contentful-paint'), cls: num('cumulative-layout-shift'), tbtMs: num('total-blocking-time'),
    accessibility: score('accessibility'), seo: score('seo'), 'best-practices': score('best-practices') };
  // The median run for category findings (the run whose Performance score is the median).
  const mid = lh.find((l) => Math.round((l.categories.performance?.score ?? 0) * 100) === m.performance) ?? lh[0];

  const checks = [
    ['Performance score', m.performance >= CRITERIA.metrics.performance, `${m.performance} (need ≥ ${CRITERIA.metrics.performance})`],
    ['LCP', m.lcpMs <= CRITERIA.metrics.lcpMs, `${ms(m.lcpMs)} (need ≤ ${ms(CRITERIA.metrics.lcpMs)})`],
    ['CLS', m.cls <= CRITERIA.metrics.cls, `${m.cls.toFixed(3)} (need ≤ ${CRITERIA.metrics.cls})`],
    ['Total Blocking Time', m.tbtMs <= CRITERIA.metrics.tbtMs, `${Math.round(m.tbtMs)} ms (need ≤ ${CRITERIA.metrics.tbtMs} ms)`],
  ];
  const pageFixes = [];
  const acceptedHere = [];
  const notes = [];
  const LABEL = { accessibility: 'Accessibility', 'best-practices': 'Best Practices', seo: 'SEO' };
  for (const cat of CRITERIA.perfect) {
    let fails = failingAudits(mid, cat, 1) ?? [];
    let excused = false;
    if (cat === 'seo' && preview && fails.some((f) => f.id === 'is-crawlable')) {
      excused = true;
      notes.push('SEO: is-crawlable excused on the preview (site.previewMode noindex, §17) — it must pass on production');
      fails = fails.filter((f) => f.id !== 'is-crawlable');
    }
    const open = fails.filter((f) => { const r = accepted(f.id, url); if (r) acceptedHere.push({ ...f, risk: r }); return !r; });
    pageFixes.push(...open);
    checks.push([LABEL[cat], open.length === 0,
      `${m[cat]}${open.length ? ` — ${open.length} failing audit(s): ${open.map((f) => f.id).join(', ')}` : fails.length ? ' (remaining findings are accepted risks)' : excused ? ' (only is-crawlable, excused on the preview)' : ''} (need 100)`]);
  }
  const agentic = failingAudits(mid, 'agentic-browsing', PASS);
  if (agentic === null) {
    notes.push('Agentic Browsing: PageSpeed Insights returned no agentic-browsing category for this run — run Lighthouse 13.3+ locally (Chrome DevTools → Lighthouse) and record the result');
  } else {
    const open = agentic.filter((f) => { const r = accepted(f.id, url); if (r) acceptedHere.push({ ...f, risk: r }); return !r; });
    pageFixes.push(...open);
    const cat = mid.categories['agentic-browsing'];
    const scored = cat.auditRefs.filter((r) => { const a = mid.audits[r.id]; return a && !['notApplicable', 'informative', 'manual'].includes(a.scoreDisplayMode); });
    checks.push(['Agentic Browsing', open.length === 0, `${scored.length - agentic.length}/${scored.length} scored audits pass${open.length ? ` — failing: ${open.map((f) => f.id).join(', ')}` : ''} (need all)`]);
  }

  const pass = checks.every(([, ok]) => ok);
  if (!pass) failed++;
  console.log(`\n${pass ? '✓' : '✗'} ${url}  (mobile, median of ${RUNS} runs${preview ? ', preview' : ''})`);
  for (const [label, ok, detail] of checks) console.log(`   ${ok ? '✓' : '✗'} ${label}: ${detail}`);
  for (const n of notes) console.log(`   ⚠ ${n}`);
  for (const a of acceptedHere) console.log(`   ⚠ accepted risk: ${a.id} — ${a.risk.reason} (approved by ${a.risk.approved_by}, ${a.risk.approved_at})`);

  const field = runs[0].loadingExperience?.metrics ? runs[0].loadingExperience : runs[0].originLoadingExperience;
  if (field?.metrics) {
    const f = field.metrics;
    const part = (k, fmt) => (f[k] ? `${fmt(f[k].percentile)} ${f[k].category}` : 'n/a');
    console.log(`   Real visitors (Google CrUX, ${field === runs[0].loadingExperience ? 'this page' : 'whole site'}): LCP ${part('LARGEST_CONTENTFUL_PAINT_MS', ms)} · INP ${part('INTERACTION_TO_NEXT_PAINT', (v) => `${v} ms`)} · CLS ${part('CUMULATIVE_LAYOUT_SHIFT_SCORE', (v) => (v / 100).toFixed(2))}`);
  } else console.log('   Real visitors (Google CrUX): not enough traffic yet — PostHog web vitals cover this after launch');

  // Performance: the audits Lighthouse flags, largest estimated savings first.
  const audits = mid.audits;
  const metricIds = new Set(['largest-contentful-paint', 'cumulative-layout-shift', 'total-blocking-time', 'first-contentful-paint', 'speed-index', 'interactive', 'max-potential-fid']);
  const savings = (a) => a.details?.overallSavingsMs ?? Math.max(0, ...Object.values(a.metricSavings ?? {}).map(Number).filter(Number.isFinite));
  const perfFixes = Object.entries(audits)
    .filter(([id, a]) => !metricIds.has(id) && typeof a.score === 'number' && a.score < 0.9 && ['metricSavings', 'numeric', 'binary'].includes(a.scoreDisplayMode)
      && mid.categories.performance?.auditRefs.some((r) => r.id === id))
    .map(([id, a]) => ({ category: 'performance', id, title: a.title, score: a.score, display: a.displayValue ?? '', savingsMs: Math.round(savings(a)), targets: targets(a) }))
    .sort((a, b) => b.savingsMs - a.savingsMs);
  const perfShown = perfFixes.slice(0, TOP_FIXES);
  if (perfShown.length) {
    console.log('   Performance — what to fix (largest estimated savings first):');
    for (const f of perfShown) console.log(`     - ${f.title}${f.display ? ` — ${f.display}` : ''}${f.savingsMs ? ` (≈${f.savingsMs} ms)` : ''}  [${f.id}]`);
  }
  if (pageFixes.length) {
    console.log('   Accessibility / Best Practices / SEO / Agentic — failing audits:');
    for (const f of pageFixes) console.log(`     - [${f.category}] ${f.title}  [${f.id}]${f.targets[0]?.selector ? ` e.g. ${f.targets[0].selector}` : f.targets[0]?.url ? ` e.g. ${f.targets[0].url}` : ''}`);
  }
  try {
    const node = audits['largest-contentful-paint-element']?.details?.items?.[0]?.items?.[0]?.node ?? audits['largest-contentful-paint-element']?.details?.items?.[0]?.node;
    if (node?.snippet) console.log(`   LCP element: ${node.snippet.slice(0, 140)}`);
  } catch { /* shape varies by Lighthouse version */ }

  // Fix list: everything that blocks a bar on this page. Performance opportunities are included only
  // while a performance metric fails (the score is what matters, not every opportunity).
  const perfFailing = checks.slice(0, 4).some(([, ok]) => !ok);
  fixList.push({ url, pass, preview, failing: [...pageFixes, ...(perfFailing ? perfFixes : [])], accepted: acceptedHere.map((a) => ({ id: a.id, reason: a.risk.reason })) });
  report.push({ url, pass, preview, metrics: m, checks: checks.map(([label, ok, detail]) => ({ label, ok, detail })), fixes: [...pageFixes, ...perfFixes], accepted: acceptedHere.map((a) => a.id), field: field?.metrics ?? null, lighthouseVersion: mid.lighthouseVersion, testedAt: new Date().toISOString() });
}

mkdirSync('artifacts/perf', { recursive: true });
const out = `artifacts/perf/perf-report-${new Date().toISOString().slice(0, 10)}.json`;
writeFileSync(out, JSON.stringify({ criteria: CRITERIA, runs: RUNS, report }, null, 2));
writeFileSync('artifacts/perf/fix-list.json', JSON.stringify({ generatedAt: new Date().toISOString(), criteria: CRITERIA, pages: fixList }, null, 2));
console.log(`\n${failed ? '✗' : '✓'} perf:check — ${urls.length - failed} of ${urls.length} page(s) meet every bar. Report: ${out} · fix list: artifacts/perf/fix-list.json`);
process.exit(failed ? 1 : 0);
