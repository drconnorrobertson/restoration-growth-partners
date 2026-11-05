/**
 * Automatic blog cover (§29, src/utils/blog-cover.mjs): fit, contrast fallback, labels, determinism.
 * Run: npm run test:blog (from starter/).
 *
 * WHY THE HEADLINE ALWAYS FITS (the proof the first two tests check):
 * The headline wraps greedily and breaks a word between letters when the word alone is wider than a line.
 * If a title needed a 4th line, then for line 1 and line 3, "the line's text + the first word of the next
 * line" would each be wider than the line — so the title's total width would exceed 2 × line width.
 * A title is ≤ 60 characters (schema), so its width is ≤ 60 × (widest glyph advance). At the smallest
 * size, 60 × widest advance < 2 × line width ⇒ 4 lines are impossible ⇒ ≤ 3 lines, and 3 lines of the
 * smallest size are far shorter than the headline box. layoutCover additionally checks the real ink
 * bounding box of every glyph on every render and throws (failing the build) if it ever leaves the box.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import {
  COVER, MIN_CONTRAST, THUMB_4x3, contrast, coverHash, coverLabel, domainOf, fitHeadline, guardColor,
  layoutCover, loadCoverFonts, parseHex, readThemeColors, renderCover, renderThumb, textWidth,
} from '../../src/utils/blog-cover.mjs';

const base = { title: 'How Long Does Structural Drying Take?', label: 'Water Damage', brandName: 'Example Restoration Co.', domain: 'example.com', ...readThemeColors('src/styles/theme.css'), logo: 'src/assets/brand/logo.png' };
const { display } = loadCoverFonts();
const font = display.font;
const FORMATS = [COVER, THUMB_4x3]; // the 1200×630 cover and the 4:3 card thumbnail obey the same proof
const headlineBox = async (spec) => (await layoutCover(base, spec)).layout.headline.box;

// Every character the display font can draw, uppercased as the cover does.
const drawable = [...new Set(Object.keys(font.tables.cmap.glyphIndexMap).map((c) => String.fromCodePoint(Number(c)).toUpperCase()))]
  .filter((c) => c.length === 1 && c.trim() && !/\p{M}/u.test(c) && font.charToGlyph(c).index > 0);

const WORST = [
  'W'.repeat(60),
  'M'.repeat(60),
  'WWWWWWWWWWWWWWWWWW WWWWWWWWWWWWWWWWWW WWWWWWWWWWWWWWWWWW WWW', // words that just miss the line
  'Water Damage Restoration Mitigation Dehumidification Extract', // long real words, 60 chars
  'Why Does My Basement Smell Musty After Heavy Rain? (A Guide)',
  'Mold, Moisture & Mildew: What Homeowners Should Know—Today!!',
];

test('the widest glyph × 60 characters is narrower than two lines at the smallest size (so ≤ 3 lines)', async () => {
  for (const spec of FORMATS) {
  const MIN = spec.headline.sizes.at(-1);
  const box = await headlineBox(spec);
  // Widest advance of ANY glyph in the font (a superset of what a title can use), kerning ignored (it only
  // narrows pairs here; tracking on the headline is 0).
  const widest = Math.max(...Array.from({ length: font.numGlyphs }, (_, i) => font.glyphs.get(i).advanceWidth || 0));
  const maxTitleWidth = 60 * (widest / font.unitsPerEm) * MIN;
  assert.ok(maxTitleWidth < 2 * (box.x2 - box.x1), `${spec.name}: 60 × widest glyph = ${maxTitleWidth.toFixed(0)}px must be < 2 lines = ${2 * (box.x2 - box.x1)}px`);
  }
});

test('worst-case 60-character titles fit at the smallest size — and at the size the cover picks', async () => {
  for (const spec of FORMATS) {
  const MIN = spec.headline.sizes.at(-1);
  const box = await headlineBox(spec);
  for (const t of [...WORST, ...drawable.map((c) => c.repeat(60))]) {
    assert.ok(t.length <= 60);
    const min = fitHeadline(font, t, box, { ...spec.headline, sizes: [MIN] });
    assert.ok(min.lines.length <= 3, `${t}: ${min.lines.length} lines at ${MIN}px`);
    const picked = fitHeadline(font, t, box, spec.headline);
    assert.ok(picked.lines.length <= spec.headline.maxLines);
    assert.ok(picked.ink.x2 <= box.x2 && picked.ink.y2 <= box.y2 && picked.ink.y1 >= box.ceiling && picked.ink.x1 >= box.minX, `${t}: ink inside the box`);
    for (const l of picked.lines) assert.ok(textWidth(font, l, picked.size) <= box.x2 - box.x1);
  }
  }
});

test('rendered pixels: no headline ink outside the headline box (worst-case title)', async () => {
  for (const spec of FORMATS) for (const title of ['W'.repeat(60), WORST[2], 'Å'.repeat(60), 'Ï'.repeat(60), 'ÉQUIPE ÅJQ, '.repeat(5)]) {
    const { svg, layout } = await layoutCover({ ...base, title, only: 'headline' }, spec);
    const { data, info } = await sharp(Buffer.from(svg)).raw().toBuffer({ resolveWithObject: true });
    const b = layout.headline.box;
    let outside = 0;
    for (let y = 0; y < info.height; y++) for (let x = spec.bar; x < info.width; x++) {
      const i = (y * info.width + x) * info.channels;
      const bright = data[i] > 128 && data[i + 1] > 128 && data[i + 2] > 128; // stripes are ~bg + 3.5% white
      if (bright && (x < b.minX - 1 || x > b.x2 + 1 || y < b.ceiling - 1 || y > b.y2 + 1)) outside++;
    }
    assert.equal(outside, 0, `${spec.name}: ${outside} headline pixel(s) outside the box for "${title}"`);
  }
});

test('a title the font cannot draw fails loudly instead of rendering boxes', async () => {
  await assert.rejects(layoutCover({ ...base, title: 'Fire Damage 🔥 Checklist' }), /no glyph for/);
  const ok = await layoutCover({ ...base, title: 'Café Ceiling Leak — What “Wet” Means' }); // accents, dashes, curly quotes are covered
  assert.match(ok.layout.headline.lines.join(' '), /CAFÉ/);
});

test('contrast guard: a light accent / background is darkened until white text passes WCAG AA', () => {
  const pill = guardColor('#ffcc00', MIN_CONTRAST.pill);
  assert.ok(pill.adjusted);
  assert.ok(contrast([255, 255, 255], parseHex(pill.color)) >= 3, `${pill.color} vs white`);
  const bg = guardColor('#7fb3ff', MIN_CONTRAST.headline, { overlay: COVER.stripes.opacity });
  assert.ok(bg.adjusted && bg.ratio >= 4.5);
  const keep = guardColor('#121820', MIN_CONTRAST.headline, { overlay: COVER.stripes.opacity });
  assert.equal(keep.color, '#121820');
  assert.equal(keep.adjusted, false, 'a passing colour is used exactly as given');
  assert.equal(guardColor('', MIN_CONTRAST.headline).color, '#121820', 'missing colour → the default dark');
  assert.equal(guardColor('not-a-colour', MIN_CONTRAST.headline).color, '#121820');
  // Same input, same output — no randomness.
  assert.deepEqual(guardColor('#ffcc00', 3), guardColor('#ffcc00', 3));
});

test('the cover uses the guarded colours', async () => {
  const { layout, svg } = await layoutCover({ ...base, accent: '#fff200', background: '#e8e8e8' });
  assert.ok(layout.accent.adjusted && layout.background.adjusted);
  assert.ok(svg.includes(layout.accent.color) && svg.includes(layout.background.color));
});

test('topic labels come from the parent page by fixed rules; a site override wins', () => {
  assert.equal(coverLabel({ id: 'water-damage-restoration', label: 'Water Damage Restoration' }), 'Water Damage');
  assert.equal(coverLabel({ id: 'fire-damage-restoration', label: 'Fire Damage Restoration' }), 'Fire & Smoke');
  assert.equal(coverLabel({ id: 'mold-remediation', label: 'Mold Remediation' }), 'Mold');
  assert.equal(coverLabel({ id: 'storm-damage-restoration', label: 'Storm Damage Restoration' }), 'Storm');
  assert.equal(coverLabel({ id: 'asbestos-abatement', label: 'Asbestos Abatement' }), 'Asbestos');
  assert.equal(coverLabel({ id: 'environmental-services/asbestos-testing', label: 'Asbestos Testing' }), 'Asbestos');
  assert.equal(coverLabel({ id: 'biohazard-cleanup', label: 'Biohazard Cleanup' }), 'Biohazard');
  assert.equal(coverLabel({ id: 'reconstruction', label: 'Reconstruction' }), 'Reconstruction');
  assert.equal(coverLabel({ id: 'mold-remediation', label: 'Mold Remediation' }, { 'mold-remediation': 'Mold & Air Quality' }), 'Mold & Air Quality');
  assert.equal(domainOf('https://www.romexterra.com'), 'romexterra.com');
});

test('long brand names and domains shrink, then end in "…", and never reach each other', async () => {
  const { layout } = await layoutCover({ ...base, brandName: 'The Very Long Name Restoration and Reconstruction Company of the Greater Metro Area LLC', domain: 'theverylongnamerestorationandreconstructioncompany.com' });
  assert.ok(layout.brand.truncated && layout.brand.text.endsWith('…'));
  assert.equal(layout.brand.size, COVER.brand.sizes.at(-1));
  assert.ok(layout.domain.size <= COVER.domain.sizes[0]);
  const long = await layoutCover({ ...base, label: 'Commercial Water Damage Restoration and Large Loss Recovery Services for Property Managers' });
  assert.ok(long.layout.label.size <= COVER.pill.sizes[0]);
});

test('deterministic: the same input gives the same bytes; the cache returns them without re-rendering', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'covers-'));
  const a = await renderCover({ ...base, title: 'Determinism Check One' }, { cacheDir: '' });
  const b = await renderCover({ ...base, title: 'Determinism Check One', brandName: base.brandName }, { cacheDir: dir });
  assert.ok(a.png.equals(b.png), 'same PNG bytes');
  assert.equal(a.hash, b.hash);
  const meta = await sharp(a.png).metadata();
  assert.deepEqual([meta.format, meta.width, meta.height], ['png', 1200, 630]);
  for (const w of COVER.card.widths) {
    const m = await sharp(a.cards[w]).metadata();
    assert.deepEqual([m.format, m.width, m.height], ['webp', w, Math.round((w * 9) / 16)]);
  }
  assert.equal(readdirSync(dir).length, 1 + COVER.card.widths.length, 'cache files written');
  const c = await renderCover({ ...base, title: 'Determinism Check One', domain: base.domain }, { cacheDir: dir }); // new input object, same values
  assert.ok(c.png.equals(a.png));
  assert.notEqual(coverHash({ ...base, title: 'Other' }), coverHash(base), 'a different title is a different cover');
  const t = await renderThumb({ ...base, title: 'Determinism Check One' }, { cacheDir: '' });
  for (const w of THUMB_4x3.widths) {
    const m = await sharp(t.thumbs[w]).metadata();
    assert.deepEqual([m.format, m.width, m.height], ['webp', w, (w * 3) / 4]);
  }
});
