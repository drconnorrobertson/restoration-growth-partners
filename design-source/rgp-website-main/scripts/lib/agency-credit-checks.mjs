/**
 * Agency footer credit rule (CORE_CONTRACTS §30, owner decision 2026-10-20).
 *
 * Every page carries exactly one element marked data-agency-credit whose visible text is exactly
 *   "Website Design, Development, & AI SEO by Restoration Growth Partners"
 * and inside it exactly one link to the agency homepage whose text is "Restoration Growth Partners".
 * A page fails when the credit is missing or duplicated, the wording differs, the link is missing,
 * points elsewhere, or is qualified rel="nofollow" / "sponsored" / "ugc" (the owner wants a followed
 * link) or "noreferrer" (hides the referral visit), or the credit is hidden (hidden, aria-hidden,
 * inline display:none / visibility:hidden, sr-only) — a hidden link is link spam under Google's policy.
 *
 * Pure function over one page's HTML so validate:built and the unit tests share it.
 */
import { AGENCY_CREDIT } from '../../src/data/agency-credit.mjs';

const attrsOf = (s) => {
  const a = {};
  for (const m of s.matchAll(/([^\s=/"'>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) a[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? '';
  return a;
};
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'", nbsp: ' ' };
const text = (s) => s.replace(/<[^>]+>/g, ' ').replace(/&(#?\w+);/g, (m, e) => ENTITIES[e] ?? (e.startsWith('#') ? String.fromCodePoint(Number(e.slice(1).replace(/^x/, '0x'))) : m)).replace(/\s+/g, ' ').trim();
const norm = (u) => { try { const x = new URL(u); return `${x.hostname.replace(/^www\./, '')}${x.pathname.replace(/\/+$/, '')}`; } catch { return u; } };
const AGENCY = norm(AGENCY_CREDIT.url);
const FULL = `${AGENCY_CREDIT.lead} ${AGENCY_CREDIT.name}`;
const hiddenBy = (a) =>
  'hidden' in a ? 'hidden' :
  a['aria-hidden'] === 'true' ? 'aria-hidden="true"' :
  /display\s*:\s*none|visibility\s*:\s*hidden/i.test(a.style ?? '') ? `style="${a.style}"` :
  /(^|\s)(sr-only|hidden|invisible)(\s|$)/.test(a.class ?? '') ? `class="${a.class}"` : null;

/** @returns {string[]} one message per defect (empty = the page follows the rule) */
export function checkAgencyCredit(html) {
  const errors = [];
  const credits = [...html.matchAll(/<(p|div|span|small)\b([^>]*\bdata-agency-credit\b[^>]*)>([\s\S]*?)<\/\1>/gi)];
  if (!credits.length) return [`no agency footer credit — the footer's bottom bar must carry <p data-agency-credit>${AGENCY_CREDIT.lead} <a href="${AGENCY_CREDIT.url}">${AGENCY_CREDIT.name}</a></p> (§30)`];
  if (credits.length > 1) errors.push(`agency credit appears ${credits.length}× — exactly once per page, in the footer (§30)`);
  const [, , attrs, inner] = credits[0];
  const hidden = hiddenBy(attrsOf(attrs));
  if (hidden) errors.push(`agency credit is hidden (${hidden}) — it must be visible text (§30)`);
  if (text(inner) !== FULL) errors.push(`agency credit reads "${text(inner)}" — it must read exactly "${FULL}" (§30)`);
  const links = [...inner.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)];
  if (links.length !== 1) errors.push(`agency credit has ${links.length} links — exactly one, on "${AGENCY_CREDIT.name}" (§30)`);
  const [, la, ltext] = links[0] ?? [];
  if (la !== undefined) {
    const a = attrsOf(la);
    if (norm(a.href ?? '') !== AGENCY) errors.push(`agency credit links to "${a.href}" — it must link to ${AGENCY_CREDIT.url} (§30)`);
    if (text(ltext) !== AGENCY_CREDIT.name) errors.push(`agency credit link text is "${text(ltext)}" — it must be "${AGENCY_CREDIT.name}" (§30)`);
    const bad = (a.rel ?? '').toLowerCase().split(/\s+/).filter((r) => ['nofollow', 'sponsored', 'ugc', 'noreferrer'].includes(r));
    if (bad.length) errors.push(`agency credit link has rel="${a.rel}" — owner decision: a normal followed link with referral visible (no ${bad.join('/')}) (§30)`);
    const lh = hiddenBy(a);
    if (lh) errors.push(`agency credit link is hidden (${lh}) (§30)`);
  }
  return errors;
}
