/**
 * §19 script placement table: scripts/lib/script-placement-checks.mjs (shared with validate:built) passes
 * BaseLayout's output (GA4 and GTM variants, call tracking, a first-input chat loader) and fails each rule.
 * The real build is covered by validate:built in check:built (every page must pass).
 * Run: npm run test:scripts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkScriptPlacement } from '../../scripts/lib/script-placement-checks.mjs';

const GA4 = '<script async src="https://www.googletagmanager.com/gtag/js?id=G-TEST123"></script><script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag(\'js\',new Date());gtag(\'config\',\'G-TEST123\');</script>';
const GTM = '<script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({\'gtm.start\':new Date().getTime(),event:\'gtm.js\'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!=\'dataLayer\'?\'&l=\'+l:\'\';j.async=true;j.src=\'https://www.googletagmanager.com/gtm.js?id=\'+i+dl;f.parentNode.insertBefore(j,f);})(window,document,\'script\',\'dataLayer\',\'GTM-TEST1\');</script>';
const GTM_NOSCRIPT = '<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=GTM-TEST1" title="Google Tag Manager" loading="lazy" height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>';
const POOL = 'https://backend.leadconnectorhq.com/appengine/loc/LOC/pool/POOL/number_pool.js';
const SESSION = 'https://backend.leadconnectorhq.com/appengine/js/user_session.js';
const CALLS = `<script defer src="${POOL}"></script><script defer src="${SESSION}"></script>`;
// Green State's Distance loader shape: the event-list first-input pattern (like posthog-loader.ts).
const CHAT_ON_INPUT = '<script>(function(){const src="https://cdn.distance.so/widget-js/v1/web-chat.min.js";const INPUTS=["pointermove","pointerdown","touchstart","keydown","scroll","wheel"];let started=false;const start=()=>{if(started)return;started=true;const s=document.createElement("script");s.src=src;s.async=true;document.body.appendChild(s);};INPUTS.forEach((t)=>addEventListener(t,start,{capture:true,passive:true}));})();</script>';
const CONTENT = '<header><a href="tel:+15550001234">Call</a></header><main><h1>Water damage</h1></main><footer>f</footer>';
const MODULE = '<script type="module" src="/_astro/BaseLayout.js"></script>';

const page = ({ head = GA4, body = `${CONTENT}${MODULE}${CALLS}` } = {}) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>t</title>${head}</head><body>${body}</body></html>`;
const result = (html) => checkScriptPlacement(html);
const fails = (html, re) => { const r = result(html); assert.ok(r.errors.some((m) => re.test(m)), `expected error ${re} in ${JSON.stringify(r)}`); };
const warns = (html, re) => { const r = result(html); assert.deepEqual(r.errors, []); assert.ok(r.warnings.some((m) => re.test(m)), `expected warning ${re} in ${JSON.stringify(r)}`); };
const clean = (html) => assert.deepEqual(result(html), { errors: [], warnings: [] });

test('BaseLayout output passes: GA4, GTM, call tracking last in <body>, first-input chat', () => {
  clean(page());
  clean(page({ head: GTM, body: `${GTM_NOSCRIPT}${CONTENT}${CALLS}` }));
  clean(page({ body: `${CONTENT}${CHAT_ON_INPUT}${CALLS}<script type="module">import "/x.js"</script>` }));
  clean(page({ head: '', body: CONTENT })); // no GA, no call tracking configured: nothing to check
});

test('1. GA4/GTM delayed or out of <head> fails', () => {
  fails(page({ head: '', body: `${GA4}${CONTENT}${CALLS}` }), /in <body>.*§19/);
  fails(page({ head: GA4.replace('<script async', '<script type="text/partytown" async') }), /type="text\/partytown"/);
  fails(page({ head: GA4.replace('async src', 'defer src') }), /not async/);
  fails(page({ head: GA4.replace('async src', 'async data-src') }), /lazy-loaded/);
  fails(page({ head: GTM.replace('(function(w,d,s,l,i){', 'setTimeout(function(){(function(w,d,s,l,i){').replace("'GTM-TEST1');", "'GTM-TEST1');},3000);") }), /wrapped in a delay \(setTimeout\)/);
  fails(page({ head: GTM.replace('<script>', '<script>requestIdleCallback(function(){').replace('</script>', '});</script>') }), /delay \(requestIdleCallback\)/);
  fails(page({ head: `<script>["pointerdown","keydown","scroll"].forEach(function(e){addEventListener(e,function(){var j=document.createElement("script");j.async=true;j.src="https://www.googletagmanager.com/gtag/js?id=G-TEST123";document.head.appendChild(j);},{once:true});});</script>` }), /delay \(first input/);
  fails(page({ head: GTM.replace('<script>', '<script>window.addEventListener("load",function(){').replace('</script>', '});</script>') }), /delay/);
  // Config present, loader pulled in later by a bundle: nothing in the HTML loads it.
  fails(page({ head: GA4.replace(/<script async[^>]*><\/script>/, '') }), /loader .* is not in the HTML/);
});

test('2. call tracking not deferred at the end of <body>, or injected, fails', () => {
  fails(page({ head: `${GA4}${CALLS}`, body: CONTENT }), /number_pool\.js is in <head>/);
  fails(page({ body: `${CALLS}${CONTENT}` }), /not at the end of <body> — page content \(<header>\)/);
  fails(page({ body: `${CONTENT}${CALLS.replaceAll('defer', 'async')}` }), /must be loaded with defer, not async/);
  fails(page({ body: `${CONTENT}<script src="${POOL}"></script>` }), /must be loaded with defer/);
  fails(page({ body: `${CONTENT}<script type="text/partytown" defer src="${POOL}"></script>` }), /type="text\/partytown"/);
  fails(page({ body: `${CONTENT}<script>["pointerdown","scroll"].forEach(function(e){addEventListener(e,function(){var s=document.createElement("script");s.defer=true;s.src="${POOL}";document.body.appendChild(s);},{once:true});});</script>` }), /injected by another script behind a delay \(first input/);
  fails(page({ body: `${CONTENT}<script defer data-src="${SESSION}"></script>` }), /lazy-loaded/);
  warns(page({ body: `${CONTENT}<script defer src="${SESSION}"></script><script defer src="${POOL}"></script>` }), /out of order/);
});

test('3. Search Console / Bing verification meta tags fail', () => {
  fails(page({ head: `${GA4}<meta name="google-site-verification" content="abc123">` }), /verified by FILE only/);
  fails(page({ head: `${GA4}<meta name="msvalidate.01" content="ABC123">` }), /verified by FILE only/);
  fails(page({ head: `${GA4}<meta content="abc" name="Google-Site-Verification">` }), /verified by FILE only/);
});

test('4. chat widgets at page load warn (accepted risk under §19); call tracking is not chat', () => {
  warns(page({ body: `${CONTENT}${CALLS}<script async src="https://cdn.distance.so/widget-js/v1/web-chat.min.js"></script>` }), /chat widget loads with the page.*distance\.so/);
  warns(page({ body: `${CONTENT}${CALLS}<script src="https://widgets.leadconnectorhq.com/loader.js" data-resources-url="x" defer></script>` }), /chat widget loads with the page/);
  warns(page({ head: `${GA4}<link rel="preconnect" href="https://cdn.distance.so">` }), /hints a chat origin/);
  warns(page({ body: `${CONTENT}${CALLS}<script>var s=document.createElement("script");s.src="https://embed.tawk.to/abc/default";document.body.appendChild(s);</script>` }), /injected at page load, not on first input/);
  // number_pool.js / user_session.js on leadconnectorhq.com, and a preconnect to their origin, are not chat.
  clean(page({ head: `${GA4}<link rel="preconnect" href="https://backend.leadconnectorhq.com">` }));
});

test('HTML comments are ignored', () => {
  clean(page({ head: `${GA4}<!-- <meta name="google-site-verification" content="old"> -->` }));
});
