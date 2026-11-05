/**
 * "In this article" table of contents for blog posts (CORE_CONTRACTS §29, owner decision 2026-10-14).
 * Built by code from the post body's H2s — no AI step, no client-side JS, identical on every build.
 * Plain .mjs (like blog-schedule.mjs) so the build checks (scripts/lib/blog-checks.mjs) and tests use the
 * same rules the page does.
 *
 *  · every non-empty <h2> in the body gets a stable id: a slug of its text (ASCII, lowercase, words joined
 *    by "-"), made unique within the page with "-2", "-3"… An <h2> that already has an id keeps it;
 *  · the TOC is shown only when the body has TOC_MIN_H2 (3) or more such headings.
 */
export const TOC_MIN_H2 = 3;

const NAMED = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“',
  ndash: '–', mdash: '—', hellip: '…', copy: '©', reg: '®', trade: '™', deg: '°', frac12: '½', times: '×',
};

/** Decode HTML entities to text (named ones above, and every numeric one). Unknown named entities stay as written. */
export function decodeEntities(s) {
  return String(s ?? '').replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (whole, e) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1));
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : whole;
    }
    return NAMED[e.toLowerCase()] ?? whole;
  });
}

/** Visible text of a heading's inner HTML: tags removed, entities decoded, whitespace collapsed. */
export function headingText(innerHtml) {
  return decodeEntities(String(innerHtml).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/** "What's Covered — & What Isn't?" → "whats-covered-and-what-isnt". ASCII only; never empty ("section"). */
export function slugifyHeading(text) {
  const slug = String(text)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // accents → base letter
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’‘`]/g, '') // contractions stay one word: "what's" → "whats"
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!slug) return 'section';
  if (slug.length <= 60) return slug;
  const cut = slug.slice(0, 60);
  return cut.includes('-') ? cut.slice(0, cut.lastIndexOf('-')) : cut;
}

const H2_RE = /<h2\b([^>]*)>([\s\S]*?)<\/h2\s*>/gi;
const ID_RE = /\bid\s*=\s*(["'])(.*?)\1/i;

/** Number of non-empty <h2> headings in a chunk of HTML — what the TOC is built from. */
export function countH2(html) {
  return [...String(html).matchAll(H2_RE)].filter((m) => headingText(m[2])).length;
}

/**
 * Give every non-empty body <h2> a stable unique id and list them.
 *   html:     the post body HTML
 *   reserved: ids already used elsewhere on the page (never reused for a heading)
 * Returns { html (with ids), headings: [{ id, text }], show (true when there are TOC_MIN_H2+ headings) }.
 */
export function buildToc(html, { reserved = [] } = {}) {
  const src = String(html ?? '');
  const used = new Set(reserved);
  for (const m of src.matchAll(/\bid\s*=\s*(["'])(.*?)\1/gi)) used.add(m[2]);
  const headings = [];
  const out = src.replace(H2_RE, (whole, attrs, inner) => {
    const text = headingText(inner);
    if (!text) return whole;
    const existing = attrs.match(ID_RE)?.[2];
    if (existing) {
      headings.push({ id: existing, text });
      return whole;
    }
    const base = slugifyHeading(text);
    let id = base;
    for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
    used.add(id);
    headings.push({ id, text });
    return `<h2${attrs} id="${id}">${inner}</h2>`;
  });
  return { html: out, headings, show: headings.length >= TOC_MIN_H2 };
}
