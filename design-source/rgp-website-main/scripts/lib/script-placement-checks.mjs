/**
 * Script placement rules (CORE_CONTRACTS §19 "Script placement table"), checked on one page's built HTML.
 * Added 2026-10-28: the table was written rules only — BaseLayout followed them, but nothing stopped a
 * client site from delaying GA, moving call tracking, pasting a verification tag or loading chat eagerly.
 *
 *   1. Google Analytics 4 / Google Tag Manager — never delayed. When the page has GA4/GTM, the loader
 *      (gtag/js `<script async src>`, or GTM's inline snippet that injects gtm.js) is in <head>, runs
 *      as normal JavaScript (not type="text/partytown" or any other non-JS type, not data-src lazy
 *      loading), and the snippet is not wrapped in a timer, idle callback, load/first-input listener or
 *      approach observer. A GA/GTM config with no loader in the HTML at all means a bundle loads it later.
 *   2. LeadConnector call tracking (number_pool.js / user_session.js, §9) — a plain `<script defer src>`
 *      at the end of <body> (only scripts after it), never injected by another script (first-input or
 *      approach loaders delay the number swap past the visitor's first tap). Order (number_pool, then
 *      user_session) is a warning.
 *   3. Search Console / Bing verification — by FILE only (§28): a `google-site-verification` or
 *      `msvalidate.01` <meta> in a page fails.
 *   4. Chat widgets — WARNING when a known chat vendor loads with the page (`<script src>`, a hint to its
 *      origin, or an inline injector with no first-input listener). §19 makes first-input loading the
 *      approved pattern but keeps page-load chat an accepted risk (artifacts/perf/accepted-risks.yaml),
 *      so it is not an error. LeadConnector's call-tracking scripts are not chat.
 *
 * Pure function over one page's HTML so validate:built and tests/scripts share it.
 */

// Known chat vendors (script hosts). LeadConnector/msgsndr count only off the call-tracking paths.
const CHAT_HOSTS = /(?:^|\/\/|\.)(?:distance\.so|embed\.tawk\.to|widget\.intercom\.io|js\.driftt\.com|client\.crisp\.chat|connect\.podium\.com|static\.zdassets\.com|birdeye\.com\/embed|leadconnectorhq\.com|msgsndr\.com)\b/i;
// Origins that only ever serve chat (a preconnect to backend.leadconnectorhq.com is call tracking, not chat).
const CHAT_ONLY_ORIGINS = /^(?:https?:)?\/\/(?:[\w-]+\.)*(?:distance\.so|tawk\.to|intercom\.io|intercomcdn\.com|driftt\.com|crisp\.chat|podium\.com|zdassets\.com|widgets\.leadconnectorhq\.com)(?:[/:]|$)/i;
const CALL_TRACKING = /\/(number_pool|user_session)\.js\b/i;
const GA_LOADER = /googletagmanager\.com\/(?:gtag\/js|gtm\.js)/i;
// GA/GTM configured in an inline script (the loader itself may be missing from the HTML).
const GA_CONFIG = /\bgtag\s*\(\s*['"]config['"]|['"]gtm\.start['"]/;
// A wrapper that runs the loader later than "now": timers, idle/frame callbacks, approach observers,
// page-load listeners, and first-input listeners — written either as addEventListener('scroll', …) or as
// the event-list form the agency loaders use (["pointerdown", "keydown", …].forEach(addEventListener…)).
const TIMER = /\b(?:setTimeout|setInterval|requestIdleCallback|requestAnimationFrame|whenNear|IntersectionObserver)\b/;
const PAGE_LOAD = /\baddEventListener\s*\(\s*['"`](?:load|DOMContentLoaded|readystatechange)['"`]/;
const INPUT_EVENT = /['"`](?:scroll|wheel|mousemove|mouseover|mousedown|pointer(?:move|down|over|up)|touchstart|touchmove|keydown|keyup|click|focusin|focus)['"`]/;
/** What delays this inline script's work, or null when it runs immediately. */
const firstInput = (body) => (/\baddEventListener\b/.test(body) && INPUT_EVENT.test(body) ? `first input (${body.match(INPUT_EVENT)[0]})` : body.match(/\bwhenNear\b|\bIntersectionObserver\b/)?.[0] ?? null);
const delayOf = (body) => firstInput(body) ?? body.match(TIMER)?.[0] ?? body.match(PAGE_LOAD)?.[0] ?? null;
const JS_TYPES = new Set(['', 'text/javascript', 'application/javascript', 'module']);

const attrsOf = (s) => {
  const a = {};
  for (const m of s.matchAll(/([^\s=/"'>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) a[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? '';
  return a;
};
const short = (s) => (s.length > 90 ? `${s.slice(0, 90)}…` : s);

/** @returns {{ errors: string[], warnings: string[] }} */
export function checkScriptPlacement(html) {
  const errors = [];
  const warnings = [];
  // Blank out comments (same length, so positions stay true).
  const doc = html.replace(/<!--[\s\S]*?-->/g, (c) => ' '.repeat(c.length));
  const lower = doc.toLowerCase();
  const bodyOpen = lower.search(/<body[\s>]/);
  const headEnd = (() => { const i = lower.indexOf('</head>'); return i >= 0 ? i : bodyOpen >= 0 ? bodyOpen : doc.length; })();
  const bodyClose = lower.lastIndexOf('</body>');

  const scripts = [...doc.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)].map((m) => ({
    a: attrsOf(m[1]), body: m[2], start: m.index, end: m.index + m[0].length,
  }));
  const typeOf = (s) => (s.a.type ?? '').trim().toLowerCase();
  const otherAttr = (s, re) => Object.entries(s.a).find(([k, v]) => k !== 'src' && re.test(v));

  // --- 1. GA4 / GTM: in <head>, immediately ---------------------------------------------------------
  let gaLoaders = 0;
  for (const s of scripts) {
    const lazyAttr = otherAttr(s, GA_LOADER);
    const src = GA_LOADER.test(s.a.src ?? '');
    const inline = !s.a.src && GA_LOADER.test(s.body);
    if (!src && !inline && !lazyAttr) continue;
    gaLoaders++;
    const what = src ? `<script src="${short(s.a.src)}">` : inline ? 'the GTM/GA inline snippet' : `<script ${lazyAttr[0]}="${short(lazyAttr[1])}">`;
    if (lazyAttr && !src) {
      errors.push(`Google Analytics/Tag Manager is lazy-loaded (${what}) — GA4/GTM must load immediately so every visit is counted; use a plain <script async src> in <head> (§19: never delayed)`);
      continue;
    }
    if (s.start > headEnd) errors.push(`Google Analytics/Tag Manager loader (${what}) is in <body> — it goes in <head> so every visit is counted (§19: never delayed)`);
    if (!JS_TYPES.has(typeOf(s))) errors.push(`Google Analytics/Tag Manager loader (${what}) has type="${s.a.type}" — that defers it to a worker or a later script (Partytown, consent or lazy-load tools); GA4/GTM must run as normal JavaScript, immediately (§19: never delayed)`);
    if (src && !('async' in s.a)) errors.push(`Google Analytics loader ${what} is not async — load it <script async src> in <head> (§19)`);
    if (inline && delayOf(s.body)) errors.push(`Google Analytics/Tag Manager snippet is wrapped in a delay (${delayOf(s.body)}) — GA4/GTM must load as soon as the page starts, never after a timer, page load or the visitor's first input (§19: never delayed)`);
  }
  if (!gaLoaders && scripts.some((s) => !s.a.src && typeOf(s) !== 'application/ld+json' && GA_CONFIG.test(s.body)))
    errors.push('Google Analytics/Tag Manager is configured on the page but its loader (gtag/js or gtm.js) is not in the HTML — it is being loaded later by another script; put the standard loader in <head> so every visit is counted (§19: never delayed)');

  // --- 2. Call tracking: plain <script defer src> at the end of <body> ------------------------------
  const order = [];
  for (const s of scripts) {
    const src = CALL_TRACKING.test(s.a.src ?? '') ? s.a.src : null;
    const lazyAttr = otherAttr(s, CALL_TRACKING);
    if (!src && lazyAttr) {
      errors.push(`call tracking is lazy-loaded (<script ${lazyAttr[0]}="${short(lazyAttr[1])}">) — the number swap must run before the visitor's first tap; use <script defer src> at the end of <body> (§9/§19)`);
      continue;
    }
    if (!src && !s.a.src && CALL_TRACKING.test(s.body)) {
      const file = s.body.match(CALL_TRACKING)[1];
      errors.push(`call tracking (${file}.js) is injected by another script${delayOf(s.body) ? ` behind a delay (${delayOf(s.body)})` : ''} — it must be a plain <script defer src> at the end of <body> so numbers are swapped before the first tap, never on first input or approach (§9/§19)`);
      continue;
    }
    if (!src) continue;
    const name = `${src.match(CALL_TRACKING)[1]}.js`;
    order.push(name);
    if (!JS_TYPES.has(typeOf(s))) errors.push(`call tracking ${name} has type="${s.a.type}" — it would not run when the page loads; use a plain <script defer src> (§19)`);
    if ('async' in s.a || !('defer' in s.a)) errors.push(`call tracking ${name} must be loaded with defer${'async' in s.a ? ', not async' : ''} — defer runs it right after the page is parsed, when every tel: link exists (§9/§19)`);
    if (bodyOpen < 0 || s.start < bodyOpen) errors.push(`call tracking ${name} is in <head> — it goes last in <body>, after every tel: link (§9/§19)`);
    else if (bodyClose > s.end) {
      const after = doc.slice(s.end, bodyClose)
        .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '')
        .replace(/<(noscript|style|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
      const next = after.match(/<([a-z][\w-]*)/i);
      if (next) errors.push(`call tracking ${name} is not at the end of <body> — page content (<${next[1].toLowerCase()}>) follows it; move it after all content, last in <body> (§9/§19)`);
    }
  }
  const pool = order.indexOf('number_pool.js');
  const session = order.indexOf('user_session.js');
  if (pool >= 0 && session >= 0 && session < pool) warnings.push('call tracking scripts are out of order — number_pool.js comes before user_session.js (§19)');

  // --- 3. Verification by file only -----------------------------------------------------------------
  for (const [tag, attrs] of doc.matchAll(/<meta\b([^>]*)>/gi)) {
    const name = (attrsOf(attrs).name ?? '').toLowerCase();
    if (name === 'google-site-verification' || name === 'msvalidate.01')
      errors.push(`${short(tag)} — Search Console / Bing are verified by FILE only (public/google….html, BingSiteAuth.xml via npm run gsc -- verify / npm run bing -- verify); remove the meta tag (§19/§28)`);
  }

  // --- 4. Chat on first interaction (warning: §19 accepted risk) ------------------------------------
  const chatNote = 'chat must load on the visitor\'s first interaction (§19; Distance on Green State, owner-approved 2026-10-21) — if it stays at page load, record it in artifacts/perf/accepted-risks.yaml';
  for (const s of scripts) {
    if (s.a.src && CHAT_HOSTS.test(s.a.src) && !CALL_TRACKING.test(s.a.src))
      warnings.push(`chat widget loads with the page (<script src="${short(s.a.src)}">) — ${chatNote}`);
    else if (!s.a.src && JS_TYPES.has(typeOf(s))) {
      const url = s.body.match(/(?:https?:)?\/\/[^\s"'`]+/g)?.find((u) => CHAT_ONLY_ORIGINS.test(u));
      if (url && !firstInput(s.body)) warnings.push(`chat widget (${short(url)}) is injected at page load, not on first input — ${chatNote}`);
    }
  }
  for (const [, attrs] of doc.matchAll(/<link\b([^>]*)>/gi)) {
    const a = attrsOf(attrs);
    if (/\b(preconnect|dns-prefetch|preload|modulepreload|prefetch)\b/i.test(a.rel ?? '') && CHAT_ONLY_ORIGINS.test(a.href ?? ''))
      warnings.push(`<link rel="${a.rel}" href="${short(a.href)}"> hints a chat origin at page load — ${chatNote}`);
  }

  return { errors, warnings };
}
