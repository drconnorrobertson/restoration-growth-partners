/**
 * Page SEO rules (CORE_CONTRACTS §28) — ONE implementation, shared by the page templates (Astro)
 * and both validators (plain node), so the title a page renders and the title a check expects
 * cannot drift apart.
 *
 * Owner decisions 2026-09-30:
 *   · Title: primary keyword + "{City}, {ST}" required; brand optional; 60 characters max.
 *   · Meta description: keyword + city required; 160 characters max.
 *   · H1 and the first H2 carry the keyword and the city.
 *   · State is always the two-letter abbreviation in titles and headings.
 *   · "#1" is an approved claim for every client.
 *
 * Titles are BUILT, never written: seoTitle() tries the fixed patterns below in order and returns
 * the first that fits. An AI or a person picks nothing, so every page follows the same rule.
 * Plain .mjs (not .ts) so `node scripts/*.mjs` can import it without a TypeScript loader.
 */

export const SEO_LIMITS = { title: 60, meta: 160 };

const SMALL_WORDS = new Set(['a', 'an', 'and', 'at', 'by', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'vs', 'with']);
const ACRONYMS = { hvac: 'HVAC', iicrc: 'IICRC', hoa: 'HOA', pfas: 'PFAS', diy: 'DIY' };

/** "water damage restoration" -> "Water Damage Restoration"; "hvac mold remediation" -> "HVAC Mold Remediation". */
export function titleCase(phrase) {
  return String(phrase).trim().split(/\s+/).map((word, i) => {
    const lower = word.toLowerCase();
    if (ACRONYMS[lower]) return ACRONYMS[lower];
    if (i > 0 && SMALL_WORDS.has(lower)) return lower;
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  }).join(' ');
}

/** "Memphis" + "TN" -> "Memphis, TN". Leaves an area that already ends in ", ST" alone. */
export function locationLabel(area, stateAbbr) {
  const a = String(area ?? '').trim();
  if (!a) return '';
  if (/,\s*[A-Z]{2}$/.test(a) || !stateAbbr) return a;
  return `${a}, ${String(stateAbbr).trim().toUpperCase()}`;
}

/**
 * Every title the rule allows for this page, in order of preference. "Company" is skipped when the
 * keyword already names the provider ("Restoration Services", "…Contractors") so the title never
 * reads "Services Company".
 *
 * `servicePhrase` is the approved title_service_phrase exception (owner decision 2026-10-01): for a
 * problem/event/material keyword that reads like a repair trade with "Company" ("#1 Dishwasher Leak
 * Company"), the master Page Map records a service phrase that keeps the keyword ("Dishwasher Leak
 * Cleanup"). The title is then "#1 {Phrase} in {City}, {ST} | {Brand}" with no "Company", shortened
 * the same way (brand, then "#1").
 */
export function titleCandidates(keyword, location, brand, servicePhrase) {
  if (servicePhrase && String(servicePhrase).trim()) {
    const p = titleCase(servicePhrase);
    const out = [];
    if (brand) out.push(`#1 ${p} in ${location} | ${brand}`);
    out.push(`#1 ${p} in ${location}`);
    out.push(`${p} in ${location}`);
    return out;
  }
  const k = titleCase(keyword);
  const company = /\b(services?|company|companies|contractors?)$/i.test(k) ? '' : ' Company';
  const out = [];
  if (brand) out.push(`#1 ${k}${company} in ${location} | ${brand}`);
  out.push(`#1 ${k}${company} in ${location}`);
  if (company) out.push(`#1 ${k} in ${location}`);
  out.push(`${k} in ${location}`);
  return out;
}

/** The first allowed title that fits in 60 characters, or null when none does (a person writes that one). */
export function seoTitle(keyword, location, brand, servicePhrase) {
  return titleCandidates(keyword, location, brand, servicePhrase).find((t) => t.length <= SEO_LIMITS.title) ?? null;
}

/**
 * Why a title_service_phrase is not usable, or null when it is. The phrase must keep the approved
 * primary keyword (so title, H1 and first H2 still agree) and must not re-add "Company" — the point of
 * the exception is to replace it with what the company actually does (cleanup, restoration, …).
 */
export function servicePhraseProblem(keyword, servicePhrase) {
  const p = String(servicePhrase ?? '').trim();
  if (!p) return null;
  if (!containsPhrase(p, keyword)) return `title_service_phrase "${p}" must contain the primary keyword "${keyword}"`;
  if (/\bcompan(y|ies)\b/i.test(p)) return `title_service_phrase "${p}" must not contain "Company" — the exception replaces it with the service action`;
  if (/,\s*[A-Z]{2}\b|\{\{|\}\}/.test(p)) return `title_service_phrase "${p}" must not contain a location or placeholder — the city and state are added by the title rule`;
  return null;
}

/**
 * Title rule for every page type (owner decisions 2026-09-30). `brand` is the company's friendly
 * name (site.name = the page map's meta.client). Each rule returns its patterns in order of
 * preference; allowedTitles() keeps the ones that fit in 60 characters. Add a page type here — once
 * the owner approves its pattern — and every validator picks it up.
 */
export const PAGE_TITLE_RULES = {
  homepage: ({ location, brand }) => [`#1 Restoration Company in ${location} | ${brand}`, `#1 Restoration Company in ${location}`],
  parent_hub: ({ keyword, location, brand, servicePhrase }) => titleCandidates(keyword, location, brand, servicePhrase),
  service: ({ keyword, location, brand, servicePhrase }) => titleCandidates(keyword, location, brand, servicePhrase),
  city_hub: ({ keyword, location, brand, servicePhrase }) => titleCandidates(keyword, location, brand, servicePhrase),
  city_service: ({ keyword, location, brand, servicePhrase }) => titleCandidates(keyword, location, brand, servicePhrase),
  contact: ({ brand }) => [`Contact Us | ${brand}`],
  about: ({ brand }) => [`About Us | ${brand}`],
  team: ({ brand }) => [`Meet The Team | ${brand}`],
  reviews: ({ brand }) => [`Our Reviews | ${brand}`],
  blog_index: ({ brand }) => [`${brand} Blog | Restoration Tips`, `${brand} Blog`],
  blog_post: ({ headline, brand }) => [`${headline} | ${brand}`, `${headline}`],
  legal: ({ label, brand }) => [`${label} | ${brand}`, `${label}`],
};

/** Page types whose title, meta, H1, and first H2 must carry the primary keyword. */
export const KEYWORD_PAGE_TYPES = ['parent_hub', 'service', 'city_hub', 'city_service', 'blog_post'];
/** Page types whose title, meta, H1, and first H2 must also carry the city. */
export const LOCAL_PAGE_TYPES = ['parent_hub', 'service', 'city_hub', 'city_service'];

/**
 * Titles the rule allows for this page type, fitting in 60 characters. Returns null when the page
 * type has no rule yet — callers then show suggestTitleRule() so a person can approve one.
 */
export function allowedTitles(pageType, ctx = {}) {
  const rule = PAGE_TITLE_RULES[pageType];
  if (!rule) return null;
  return [...new Set(rule(ctx))]
    .filter((t) => t && !/undefined|null|\|\s*$|^\s*\|/.test(t) && !t.includes(' in  ') && !t.includes(' in |'))
    .filter((t) => t.length <= SEO_LIMITS.title);
}

/**
 * For a page type the system does not know yet: propose a title pattern from the closest known kind
 * of page, with the reason, so the owner can approve it and it can be added to PAGE_TITLE_RULES.
 */
export function suggestTitleRule(pageType, ctx = {}) {
  const t = String(pageType ?? '').toLowerCase();
  const label = ctx.label || titleCase(t.replace(/[_-]+/g, ' '));
  if (ctx.keyword && ctx.location)
    return { pattern: '#1 {Keyword} Company in {City}, {ST} | {Brand}', example: seoTitle(ctx.keyword, ctx.location, ctx.brand), reason: 'the page targets a service keyword in a location, like the service pages' };
  if (/blog|article|guide|resource|news|post|faq|case|study|story|project|gallery/.test(t))
    return { pattern: '{Headline} | {Brand}', example: ctx.headline ? `${ctx.headline} | ${ctx.brand ?? '{Brand}'}` : null, reason: 'content pages are titled by their headline, like blog posts' };
  return { pattern: `${label} | {Brand}`, example: ctx.brand ? `${label} | ${ctx.brand}` : null, reason: 'company-information pages follow "{Page Name} | {Brand}", like About Us and Contact Us' };
}

const normalize = (s) => String(s ?? '').toLowerCase().replace(/&amp;/g, '&').replace(/&/g, ' and ')
  .replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();

/** Whole-phrase match, ignoring case, punctuation, and "&" vs "and". */
export function containsPhrase(text, phrase) {
  const p = normalize(phrase);
  return p.length > 0 && ` ${normalize(text)} `.includes(` ${p} `);
}

/** Decode the few entities Astro emits in <title> / content="" so lengths are counted as a reader sees them. */
export function decodeEntities(s) {
  return String(s ?? '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&#x27;|&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}
