/**
 * Blog cover images (CORE_CONTRACTS §29 → "Cover image") — the automatic 1200×630 social/card image for
 * every PUBLISHED post that has no heroImage. 100% deterministic code: no AI judgment, no photo choice.
 * The same inputs always give the same pixels.
 *
 * Inputs (nothing else): the post title, the topic label (from the post's parent page), and the site's
 * brand: dark background colour, accent colour, logo file, brand name, domain.
 *
 * How it is drawn — and why it cannot overflow:
 *   · Every piece of text is converted to glyph OUTLINES with opentype.js from font files committed in the
 *     repo (src/assets/fonts/cover/, OFL). No system font, no browser, no layout engine: the code that
 *     MEASURES a line is the code that DRAWS it, so a measured fit is the rendered fit.
 *   · The headline (uppercase) tries sizes from HEADLINE_SIZES (largest first) and takes the first size at
 *     which it wraps into ≤ 3 lines AND the ink bounding box of every glyph sits inside the headline box.
 *     Words longer than a line are broken between letters, so even 60 "W"s fit (tests/blog/cover.test.mjs
 *     proves the worst cases at the smallest size). If nothing fits, layoutCover THROWS — the build fails
 *     rather than ship a clipped cover.
 *   · The pill label, brand name and domain shrink in fixed steps, then end in "…" — never overflow.
 *   · Contrast guard (WCAG): the background is darkened until white text on it (stripes included) is
 *     ≥ 4.5:1; the accent until white pill text on it is ≥ 3:1 (large bold text). Fixed 5% steps toward
 *     black, so the result is the same on every build.
 *   · The SVG is rasterised by sharp (libvips/librsvg, already installed with Astro) — the text is paths, so
 *     the rasteriser needs no fonts. Works on Vercel's Linux build machines.
 *
 * Everything sits left of x = 1120, so a 16:9 card thumbnail (the starter's /blog/ index) is a left crop of
 * the same render. Sites with 4:3 card thumbnails use THUMB_4x3: the same design and rules at 640×480.
 *
 * Plain .mjs (like blog-schedule.mjs) so node tests import it without Astro. Paths are relative to the
 * project root (the build's working directory).
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import opentype from 'opentype.js';
import sharp from 'sharp';

/** Bump when the design changes: it is part of the cache key. */
export const COVER_VERSION = 1;

/** Headline sizes in px for the 1200×630 cover, largest first. The smallest is proven to fit any 60-character title. */
export const HEADLINE_SIZES = Object.freeze(Array.from({ length: 35 }, (_, i) => 108 - i * 2)); // 108 … 40

/** The 1200×630 cover (og:image / twitter:image / BlogPosting image). */
export const COVER = Object.freeze({
  name: 'cover',
  width: 1200,
  height: 630,
  bar: 12, // accent bar on the left edge
  left: 76, // content left edge
  right: 1080, // content right edge — everything stays inside the 16:9 crop (x < 1120)
  top: 64,
  bottom: 56, // footer bottom margin
  pill: { height: 48, padX: 20, radius: 6, sizes: [24, 22, 20, 18, 16], tracking: 0.1 },
  headline: { gapAbove: 32, gapBelow: 36, lineHeight: 1.0, maxLines: 3, sizes: HEADLINE_SIZES, ceilingGap: 8, overhang: 16 },
  badge: { height: 80, pad: 12, radius: 10, maxLogoWidth: 240 },
  brand: { sizes: [40, 38, 36, 34, 32, 30, 28, 26, 24], gap: 22 },
  domain: { sizes: [26, 24, 22, 20, 18], maxWidth: 420 },
  stripes: { every: 44, width: 4, opacity: 0.035 },
  card: { width: 1120, widths: [480, 960] }, // 16:9 left crop for 16:9 cards
});

/**
 * A 4:3 thumbnail of the same design for sites whose blog cards are 4:3 (e.g. Romexterra's 140×105 list
 * thumbnails): pill, headline, logo badge and brand name; no domain. Its own sizes, the same rules — and
 * the same proof (tests/blog/cover.test.mjs runs it for both formats).
 */
export const THUMB_4x3 = Object.freeze({
  name: 'thumb',
  width: 640,
  height: 480,
  bar: 8,
  left: 40,
  right: 600,
  top: 36,
  bottom: 32,
  pill: { height: 34, padX: 14, radius: 5, sizes: [17, 16, 15, 14, 13, 12], tracking: 0.1 },
  headline: { gapAbove: 22, gapBelow: 24, lineHeight: 1.0, maxLines: 3, sizes: Object.freeze(Array.from({ length: 26 }, (_, i) => 72 - i * 2)), ceilingGap: 6, overhang: 10 }, // 72 … 22
  badge: { height: 56, pad: 9, radius: 8, maxLogoWidth: 150 },
  brand: { sizes: [26, 24, 22, 20, 18, 16], gap: 14 },
  domain: null,
  stripes: { every: 24, width: 2, opacity: 0.035 },
  widths: [280, 420],
});

export const DEFAULT_BACKGROUND = '#121820';
export const MIN_CONTRAST = Object.freeze({ headline: 4.5, pill: 3 });

/** Bundled OFL fonts (Barlow Condensed Black for display, Barlow SemiBold/Bold for small text). */
export const DEFAULT_FONTS = Object.freeze({
  display: 'src/assets/fonts/cover/barlow-condensed-latin-900-normal.woff',
  body: 'src/assets/fonts/cover/barlow-latin-600-normal.woff',
  bodyBold: 'src/assets/fonts/cover/barlow-latin-700-normal.woff',
});

// --------------------------------------------------------------------------------------- colour ---

export function parseHex(hex) {
  const m = String(hex ?? '').trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return null;
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}
const toHex = (rgb) => `#${rgb.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')}`;
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

/** WCAG 2.x relative luminance and contrast ratio. */
export function luminance(rgb) {
  const [r, g, b] = rgb.map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a, b) {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

const WHITE = [255, 255, 255];
const BLACK = [0, 0, 0];

/**
 * Darken `hex` toward black in fixed 5% steps until white text on it (optionally on it with a white
 * overlay of `overlay` opacity, e.g. the stripes) reaches `min`. Returns { color, adjusted, ratio }.
 */
export function guardColor(hex, min, { overlay = 0, fallback = DEFAULT_BACKGROUND } = {}) {
  const base = parseHex(hex) ?? parseHex(fallback);
  for (let step = 0; step <= 20; step++) {
    const c = mix(base, BLACK, step * 0.05).map(Math.round);
    const ratio = contrast(WHITE, mix(c, WHITE, overlay));
    if (ratio >= min) return { color: toHex(c), adjusted: step > 0 || !parseHex(hex), ratio };
  }
  return { color: '#000000', adjusted: true, ratio: 21 };
}

/**
 * Read the background + accent colour tokens from the site's stylesheet — the starter's theme.css
 * (--color-dark, --color-accent) by default; a site with other token names passes them.
 */
export function readThemeColors(cssPath = 'src/styles/theme.css', tokens = { background: 'color-dark', accent: 'color-accent' }) {
  const css = existsSync(cssPath) ? readFileSync(cssPath, 'utf8') : '';
  const token = (name) => css.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{3,6})\\b`))?.[1];
  return { background: token(tokens.background) ?? DEFAULT_BACKGROUND, accent: token(tokens.accent) ?? '#b3261e' };
}

// ---------------------------------------------------------------------------------------- label ---

/**
 * Topic label for the pill, from the post's parent page — fixed keyword rules, first match wins. A site
 * can override per parent id (site.blog.cover.labels). Otherwise the parent's label minus generic
 * service words ("Asbestos Abatement" → "Asbestos", "Sewage Cleanup" → "Sewage").
 */
export const LABEL_RULES = Object.freeze([
  [/storm|wind|hail|tree|hurricane|tornado/, 'Storm'],
  [/fire|smoke|soot/, 'Fire & Smoke'],
  [/mold|mould/, 'Mold'],
  [/water|flood|leak|pipe|basement|extraction|drying|dehumidif/, 'Water Damage'],
]);
const GENERIC = /\b(restoration|remediation|removal|clean-?up|cleaning|services?|repairs?|abatement|mitigation|damage|testing|inspections?)\b/gi;

export function coverLabel({ id = '', label = '' } = {}, overrides = {}) {
  if (overrides?.[id]) return String(overrides[id]).trim();
  const hay = `${id} ${label}`.toLowerCase();
  for (const [re, out] of LABEL_RULES) if (re.test(hay)) return out;
  const short = String(label).replace(GENERIC, ' ').replace(/\s+/g, ' ').trim();
  return short || String(label).trim() || 'Blog';
}

/** "https://www.example.com/" → "example.com" */
export const domainOf = (siteUrl) => new URL(siteUrl).hostname.replace(/^www\./, '');

// ---------------------------------------------------------------------------------------- fonts ---

const fontCache = new Map();
function loadFont(path) {
  if (!fontCache.has(path)) {
    if (!existsSync(path)) throw new Error(`[blog cover] font file not found: ${path} (TTF/OTF/WOFF — not WOFF2)`);
    const buf = readFileSync(path);
    const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    fontCache.set(path, { font, bytes: buf });
  }
  return fontCache.get(path);
}
export function loadCoverFonts(paths = {}) {
  const p = { ...DEFAULT_FONTS, ...Object.fromEntries(Object.entries(paths).filter(([, v]) => v)) };
  return { display: loadFont(p.display), body: loadFont(p.body), bodyBold: loadFont(p.bodyBold), paths: p };
}

/** Uppercase + NFC; a character the font has no glyph for falls back to its base letter, else fails the build. */
function prepare(font, text, upper = true) {
  // NFC first (e + ◌́ → é); a combining mark left over has no base letter to sit on, so it is dropped.
  let s = String(text).normalize('NFC').replace(/\p{M}/gu, '').replace(/\s+/g, ' ').trim();
  if (upper) s = s.toUpperCase();
  let out = '';
  for (const ch of s) {
    if (ch === ' ' || font.charToGlyph(ch).index > 0) { out += ch; continue; }
    const base = ch.normalize('NFKD').replace(/[̀-ͯ]/g, '');
    if (base && [...base].every((c) => font.charToGlyph(c).index > 0)) { out += base; continue; }
    throw new Error(`[blog cover] the cover font has no glyph for "${ch}" (U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}) in "${text}" — use a plain character in the title`);
  }
  return out;
}

/** Glyph run: x positions (with kerning + tracking), total advance width. */
function run(font, text, size, tracking = 0) {
  const glyphs = font.stringToGlyphs(text);
  const scale = size / font.unitsPerEm;
  const xs = [];
  let x = 0;
  glyphs.forEach((g, i) => {
    xs.push(x);
    x += g.advanceWidth * scale + tracking * size;
    if (i < glyphs.length - 1) x += (font.getKerningValue(g, glyphs[i + 1]) || 0) * scale;
  });
  if (glyphs.length) x -= tracking * size; // no tracking after the last letter
  return { glyphs, xs, width: x };
}
export const textWidth = (font, text, size, tracking = 0) => run(font, text, size, tracking).width;

/** SVG path data + ink bounding box for `text` with its baseline-left at (x, y). */
function draw(font, text, x, y, size, tracking = 0) {
  const { glyphs, xs, width } = run(font, text, size, tracking);
  let d = '';
  const box = { x1: Infinity, y1: Infinity, x2: -Infinity, y2: -Infinity };
  glyphs.forEach((g, i) => {
    const path = g.getPath(x + xs[i], y, size);
    const pd = path.toPathData(2);
    if (!pd) return;
    d += pd;
    const b = path.getBoundingBox();
    box.x1 = Math.min(box.x1, b.x1); box.y1 = Math.min(box.y1, b.y1);
    box.x2 = Math.max(box.x2, b.x2); box.y2 = Math.max(box.y2, b.y2);
  });
  return { d, box, width };
}

/** Largest size from `sizes` at which `text` is ≤ maxWidth; below the last size, cut with "…". */
function fitOneLine(font, raw, sizes, maxWidth, tracking = 0, upper = true) {
  const text = prepare(font, raw, upper);
  for (const size of sizes) if (textWidth(font, text, size, tracking) <= maxWidth) return { text, size };
  const size = sizes[sizes.length - 1];
  let cut = [...text];
  while (cut.length && textWidth(font, `${cut.join('').trimEnd()}…`, size, tracking) > maxWidth) cut.pop();
  return { text: `${cut.join('').trimEnd()}…`, size, truncated: true };
}

// ------------------------------------------------------------------------------------- headline ---

/** Greedy wrap; a word wider than the line is broken between letters. */
function wrap(font, text, size, maxWidth) {
  const lines = [];
  let line = '';
  const fits = (s) => textWidth(font, s, size) <= maxWidth;
  for (const word of text.split(' ')) {
    const candidate = line ? `${line} ${word}` : word;
    if (fits(candidate)) { line = candidate; continue; }
    if (line) lines.push(line);
    line = '';
    let rest = word;
    while (!fits(rest)) {
      let n = 1;
      while (n < rest.length && fits(rest.slice(0, n + 1))) n++;
      lines.push(rest.slice(0, n));
      rest = rest.slice(n);
    }
    line = rest;
  }
  if (line) lines.push(line);
  return lines;
}

/** Same line count, more even lines: the narrowest width that still wraps into `n` lines. */
function balance(font, text, size, maxWidth, n) {
  let lo = 0;
  let hi = maxWidth;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (wrap(font, text, size, mid).length <= n) hi = mid; else lo = mid;
  }
  return wrap(font, text, size, hi);
}

/**
 * Lay out the headline inside `box` ({x1, y1, x2, y2}). Returns { size, lines, paths, ink }.
 * Throws when no size in HEADLINE_SIZES fits — the build must fail rather than ship an overflow.
 */
export function fitHeadline(font, title, box, { sizes = HEADLINE_SIZES, lineHeight = 1, maxLines = 3 } = {}) {
  const text = prepare(font, title);
  const capHeight = (font.tables.os2?.sCapHeight || font.unitsPerEm * 0.7) / font.unitsPerEm;
  const maxWidth = box.x2 - box.x1;
  for (const size of sizes) {
    const greedy = wrap(font, text, size, maxWidth);
    if (greedy.length > maxLines) continue;
    const lines = greedy.length > 1 ? balance(font, text, size, maxWidth, greedy.length) : greedy;
    const top = box.y1 + capHeight * size; // first baseline: cap tops on the box top
    const drawn = lines.map((l, i) => draw(font, l, box.x1, top + i * size * lineHeight, size));
    const ink = drawn.reduce((a, { box: b }) => ({ x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1), x2: Math.max(a.x2, b.x2), y2: Math.max(a.y2, b.y2) }), { x1: Infinity, y1: Infinity, x2: -Infinity, y2: -Infinity });
    // Cap tops sit on box.y1; accents (Å, É) may rise into the gap above, never closer than box.ceiling.
    // Left overhang (Ï, J) may use the margin, never the accent bar.
    const inside = ink.x1 >= (box.minX ?? box.x1) && ink.x2 <= box.x2 && ink.y1 >= (box.ceiling ?? box.y1) && ink.y2 <= box.y2;
    if (inside) return { size, lines, paths: drawn.map((x) => x.d), ink };
  }
  throw new Error(`[blog cover] headline "${title}" does not fit the cover at any size down to ${sizes[sizes.length - 1]}px — this should be impossible for a ≤ 60-character title; report it`);
}

// --------------------------------------------------------------------------------------- layout ---

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Logo → PNG data URI that fits the badge (sharp handles PNG, WebP, JPG, AVIF, SVG). */
async function logoImage(logoPath, { pad, height, maxLogoWidth }) {
  if (!logoPath || !existsSync(logoPath)) throw new Error(`[blog cover] logo file not found: ${logoPath}`);
  const bytes = readFileSync(logoPath);
  const { data, info } = await sharp(bytes, { density: 300 })
    .resize({ width: maxLogoWidth, height: height - pad * 2, fit: 'inside', withoutEnlargement: false })
    .png()
    .toBuffer({ resolveWithObject: true });
  return { uri: `data:image/png;base64,${data.toString('base64')}`, width: info.width, height: info.height, bytes };
}

/**
 * Build the cover SVG. input: { title, label, brandName, domain, background, accent, logo (file path),
 * fonts? ({display, body, bodyBold} paths) }. Returns { svg, layout } — layout reports every decision
 * (sizes, lines, colours, contrast) for tests and the build log.
 */
export async function layoutCover(input, spec = COVER) {
  const { width: W, height: H, bar, left, right, top, bottom, pill, headline, badge, brand, domain, stripes } = spec;
  const fonts = loadCoverFonts(input.fonts);
  const bg = guardColor(input.background || DEFAULT_BACKGROUND, MIN_CONTRAST.headline, { overlay: stripes.opacity });
  const accent = guardColor(input.accent, MIN_CONTRAST.pill, { fallback: '#b3261e' });
  const cap = (f) => (f.tables.os2?.sCapHeight || f.unitsPerEm * 0.7) / f.unitsPerEm;
  const parts = [];

  // Pill (topic label), top-left.
  const P = fitOneLine(fonts.bodyBold.font, input.label || 'Blog', pill.sizes, right - left - pill.padX * 2, pill.tracking);
  const pillTextW = textWidth(fonts.bodyBold.font, P.text, P.size, pill.tracking);
  const pillW = Math.ceil(pillTextW + pill.padX * 2);
  const pillBase = top + pill.height / 2 + (cap(fonts.bodyBold.font) * P.size) / 2;
  parts.push(`<rect x="${left}" y="${top}" width="${pillW}" height="${pill.height}" rx="${pill.radius}" fill="${accent.color}"/>`);
  parts.push(`<path fill="#ffffff" d="${draw(fonts.bodyBold.font, P.text, left + pill.padX, pillBase, P.size, pill.tracking).d}"/>`);

  // Footer: logo badge + brand name (left), domain (right).
  const logo = await logoImage(input.logo, badge);
  const badgeY = H - bottom - badge.height;
  const badgeW = logo.width + badge.pad * 2;
  const mid = badgeY + badge.height / 2;
  parts.push(`<rect x="${left}" y="${badgeY}" width="${badgeW}" height="${badge.height}" rx="${badge.radius}" fill="#ffffff"/>`);
  parts.push(`<image x="${left + badge.pad}" y="${Math.round(mid - logo.height / 2)}" width="${logo.width}" height="${logo.height}" href="${logo.uri}" xlink:href="${logo.uri}"/>`);

  const D = domain ? fitOneLine(fonts.body.font, input.domain || '', domain.sizes, domain.maxWidth, 0, false) : { text: '', size: 0 };
  const domainW = D.text ? textWidth(fonts.body.font, D.text, D.size) : 0;
  if (D.text) parts.push(`<path fill="#ffffff" fill-opacity="0.85" d="${draw(fonts.body.font, D.text, right - domainW, mid + (cap(fonts.body.font) * D.size) / 2, D.size).d}"/>`);

  const brandX = left + badgeW + brand.gap;
  const brandMax = right - (D.text ? domainW + 32 : 0) - brandX;
  const B = fitOneLine(fonts.display.font, input.brandName || '', brand.sizes, brandMax, 0.02);
  if (B.text) parts.push(`<path fill="#ffffff" d="${draw(fonts.display.font, B.text, brandX, mid + (cap(fonts.display.font) * B.size) / 2, B.size, 0.02).d}"/>`);

  // Headline: between the pill and the footer.
  const box = { x1: left, y1: top + pill.height + headline.gapAbove, x2: right, y2: badgeY - headline.gapBelow, ceiling: top + pill.height + headline.ceilingGap, minX: left - headline.overhang };
  const T = fitHeadline(fonts.display.font, input.title, box, headline);
  const headlinePaths = T.paths.map((d) => `<path fill="#ffffff" d="${d}"/>`);

  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`,
    `<defs><pattern id="stripes" width="${stripes.every}" height="${stripes.every}" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="${stripes.width}" height="${stripes.every}" fill="#ffffff" fill-opacity="${stripes.opacity}"/></pattern></defs>`,
    `<rect width="${W}" height="${H}" fill="${bg.color}"/>`,
    `<rect width="${W}" height="${H}" fill="url(#stripes)"/>`,
    `<rect width="${bar}" height="${H}" fill="${accent.color}"/>`,
    ...(input.only === 'headline' ? [] : parts),
    ...headlinePaths,
    `<title>${esc(input.title)}</title>`,
    '</svg>',
  ].join('');

  return {
    svg,
    logoBytes: logo.bytes,
    fontBytes: [fonts.display.bytes, fonts.body.bytes, fonts.bodyBold.bytes],
    layout: {
      headline: { size: T.size, lines: T.lines, ink: T.ink, box },
      label: P, brand: B, domain: D,
      background: bg, accent,
    },
  };
}

// ------------------------------------------------------------------------------------- render ---

/** Cache key: everything that can change a pixel. */
export function coverHash(input, logoBytes, fontBytes, spec = COVER) {
  const h = createHash('sha256');
  h.update(JSON.stringify({ v: COVER_VERSION, f: spec.name, sharp: sharp.versions?.vips, t: input.title, l: input.label, b: input.brandName, d: input.domain, bg: input.background, a: input.accent }));
  h.update(logoBytes ?? '');
  for (const f of fontBytes ?? []) h.update(f);
  return h.digest('hex').slice(0, 16);
}

export const DEFAULT_CACHE_DIR = 'node_modules/.cache/agency-blog-covers';
const byInput = new Map();

/** Lay out, rasterise once, encode each output; read/write the disk cache by content hash. */
async function produce(input, spec, outputs, cacheDir) {
  const { svg, layout, logoBytes, fontBytes } = await layoutCover(input, spec);
  const hash = coverHash(input, logoBytes, fontBytes, spec);
  const file = (k) => join(cacheDir, `${hash}-${k}`);
  if (cacheDir && Object.keys(outputs).every((k) => existsSync(file(k)))) {
    return { files: Object.fromEntries(Object.keys(outputs).map((k) => [k, readFileSync(file(k))])), cached: true, hash, layout };
  }
  const raster = await sharp(Buffer.from(svg), { density: 72 }).resize(spec.width, spec.height).png().toBuffer();
  const files = {};
  for (const [k, encode] of Object.entries(outputs)) files[k] = await encode(sharp(raster));
  if (cacheDir) {
    try {
      mkdirSync(cacheDir, { recursive: true });
      for (const [k, b] of Object.entries(files)) writeFileSync(file(k), b);
    } catch { /* a read-only cache only costs time */ }
  }
  return { files, cached: false, hash, layout };
}
const memo = (kind, input, cacheDir, make) => {
  const key = JSON.stringify([kind, input, cacheDir]);
  if (!byInput.has(key)) byInput.set(key, make());
  return byInput.get(key);
};

/**
 * The 1200×630 cover: { png, cards: { 480: webp, 960: webp } (16:9 left crop for 16:9 cards), hash,
 * layout }. Cached on disk by content hash (unchanged covers are not re-rendered when the build machine
 * keeps node_modules/.cache) and in memory within one build.
 */
export function renderCover(input, { cacheDir = DEFAULT_CACHE_DIR } = {}) {
  return memo('cover', input, cacheDir, async () => {
    const outputs = {
      'cover.png': (img) => img.png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer(),
      ...Object.fromEntries(COVER.card.widths.map((w) => [`card-${w}.webp`, (img) => img.extract({ left: 0, top: 0, width: COVER.card.width, height: COVER.height }).resize(w, Math.round((w * 9) / 16)).webp({ quality: 82 }).toBuffer()])),
    };
    const r = await produce(input, COVER, outputs, cacheDir);
    return { png: r.files['cover.png'], cards: Object.fromEntries(COVER.card.widths.map((w) => [w, r.files[`card-${w}.webp`]])), cached: r.cached, hash: r.hash, layout: r.layout };
  });
}

/** The 4:3 thumbnail (THUMB_4x3) as WebP at each of THUMB_4x3.widths: { thumbs: { 280: webp, 420: webp }, hash, layout }. */
export function renderThumb(input, { cacheDir = DEFAULT_CACHE_DIR } = {}) {
  return memo('thumb', input, cacheDir, async () => {
    const outputs = Object.fromEntries(THUMB_4x3.widths.map((w) => [`thumb-${w}.webp`, (img) => img.resize(w, Math.round((w * 3) / 4)).webp({ quality: 82 }).toBuffer()]));
    const r = await produce(input, THUMB_4x3, outputs, cacheDir);
    return { thumbs: Object.fromEntries(THUMB_4x3.widths.map((w) => [w, r.files[`thumb-${w}.webp`]])), cached: r.cached, hash: r.hash, layout: r.layout };
  });
}

/** Public URLs of a post's cover files (all inside the post's own folder). */
export const coverUrls = (postUrl) => ({
  og: `${postUrl}cover.png`,
  card: Object.fromEntries(COVER.card.widths.map((w) => [w, `${postUrl}cover-${w}.webp`])),
  thumb: Object.fromEntries(THUMB_4x3.widths.map((w) => [w, `${postUrl}cover-thumb-${w}.webp`])),
});
/** File names in /blog/{slug}/: the cover + its 16:9 card crops (every site) … */
export const COVER_FILES = Object.freeze(['cover.png', ...COVER.card.widths.map((w) => `cover-${w}.webp`)]);
/** … and the 4:3 thumbnails (only sites whose cards are 4:3). */
export const THUMB_FILES = Object.freeze(THUMB_4x3.widths.map((w) => `cover-thumb-${w}.webp`));
