/**
 * Turnstile loading rule (CORE_CONTRACTS §11 + §28 "Caught before PageSpeed").
 *
 * Cloudflare's api.js must never load with the page: BaseLayout's loader
 * (<script data-turnstile-loader>) injects it on the visitor's first focus / tap / click / key
 * inside a lead form. A page fails when its HTML
 *   · loads challenges.cloudflare.com/turnstile/v0/api.js in a <script src> (that is page-load
 *     loading, async/defer or not — PageSpeed's lab run downloads and executes it);
 *   · preconnects / dns-prefetches / preloads challenges.cloudflare.com (wasted: nothing at load uses it);
 *   · renders a Turnstile widget (.cf-turnstile) without the loader — the widget would never
 *     render, no token would be sent, and the lead router would reject every lead.
 *
 * Pure function over one page's HTML so validate:built and the unit tests share it.
 */
const API_JS = /challenges\.cloudflare\.com\/turnstile\/v0\/api\.js/i;
const CF_ORIGIN = /^(https?:)?\/\/challenges\.cloudflare\.com(\/|$)/i;

const attrsOf = (s) => {
  const a = {};
  for (const m of s.matchAll(/([^\s=/"'>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) a[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? '';
  return a;
};

/** @returns {string[]} one message per defect (empty = the page follows the rule) */
export function checkTurnstileLoading(html) {
  const errors = [];
  for (const [, attrs] of html.matchAll(/<script\b([^>]*)>/gi)) {
    const a = attrsOf(attrs);
    if (a.src && API_JS.test(a.src))
      errors.push(`Turnstile api.js loads with the page (<script src="${a.src}">) — it must load on the visitor's first interaction with a lead form (BaseLayout loader, §11/§28)`);
  }
  for (const [, attrs] of html.matchAll(/<link\b([^>]*)>/gi)) {
    const a = attrsOf(attrs);
    const rel = (a.rel ?? '').toLowerCase();
    if (/\b(preconnect|dns-prefetch|preload|modulepreload|prefetch)\b/.test(rel) && CF_ORIGIN.test(a.href ?? ''))
      errors.push(`<link rel="${rel}" href="${a.href}"> — Turnstile loads only after form interaction, so a page-load hint to challenges.cloudflare.com is wasted (§19/§28)`);
  }
  const hasWidget = /<[a-z][\w-]*\b[^>]*\bclass="[^"]*\bcf-turnstile\b[^"]*"/i.test(html);
  const hasLoader = /<script\b[^>]*\bdata-turnstile-loader\b[^>]*>/i.test(html);
  if (hasWidget && !hasLoader)
    errors.push('Turnstile widget (.cf-turnstile) on a page without the on-interaction loader (<script data-turnstile-loader> from BaseLayout) — no token would be sent and the lead router rejects every lead (§11/§27)');
  return errors;
}
