#!/usr/bin/env node
/**
 * validate-contrast.mjs — WCAG AA text contrast for the client theme (§20/§24/§28).
 *
 * Reads the tokens in src/styles/theme.css (the one per-client file) and checks:
 *   1. every text-on-background token pair the shared components render (PAIRS below), and
 *   2. every opacity text class used in src/ (text-on-dark/60, text-white/90, …), blended over each
 *      background that class sits on, so a muted footer label is measured as the visitor sees it.
 * Normal text needs 4.5:1 (WCAG AA, and Lighthouse/axe color-contrast). There is no large-text
 * exemption here: eyebrows and labels are small bold caps, and one rule is easier to keep.
 *
 * Added 2026-10-05: contrast failures were in the PageSpeed fix logs of several client sites, the
 * starter's own default accent-bright failed on all three dark backgrounds, and DESIGN_TOKENS.md
 * records muted-on-dark as the most repeated design feedback item. Until now this was a manual QA step.
 *
 * Usage: node scripts/validate-contrast.mjs   (part of `npm run check`)
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const MIN = 4.5;
const THEME = 'src/styles/theme.css';

// Text token → backgrounds it is rendered on by the shared components. Keep in sync when a component
// puts a token on a new background.
const PAIRS = {
  ink: ['surface', 'surface-2', 'white'],
  'ink-muted': ['surface', 'surface-2', 'white'],
  accent: ['white', 'surface', 'surface-2'],          // links, eyebrows, prices on light sections
  'brand-2-text': ['white', 'surface', 'surface-2'],
  white: ['accent', 'accent-hover', 'brand-2', 'dark', 'dark-2', 'dark-3'], // buttons, dark sections
  'on-dark': ['dark', 'dark-2', 'dark-3'],
  'accent-bright': ['dark', 'dark-2', 'dark-3'],      // eyebrows, highlighted hero line, footer phones
};
// Backgrounds an opacity text class can sit on (worst case is checked).
const OPACITY_BACKGROUNDS = { 'on-dark': ['dark', 'dark-2', 'dark-3'], white: ['accent', 'brand-2', 'dark', 'dark-2', 'dark-3'] };

const css = readFileSync(THEME, 'utf8');
const tokens = { white: '#ffffff', black: '#000000' };
for (const [, name, value] of css.matchAll(/--color-([\w-]+)\s*:\s*(#[0-9a-f]{3,8})\s*;/gi)) tokens[name] = value;

const rgb = (hex) => {
  let h = hex.replace('#', '');
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
};
const lum = (c) => {
  const [r, g, b] = c.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
const blend = (fg, bg, alpha) => fg.map((v, i) => v * alpha + bg[i] * (1 - alpha));
const hex = (c) => '#' + c.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('');

/** Nearest passing color: move the text token's lightness away from the background, keep its hue. */
function suggest(fgHex, bgs) {
  const [r, g, b] = rgb(fgHex);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  const fromHsl = (L) => {
    const c = (1 - Math.abs(2 * L - 1)) * s, x = c * (1 - Math.abs((h % 2) - 1)), m = L - c / 2;
    const [a, bb, cc] = h < 1 ? [c, x, 0] : h < 2 ? [x, c, 0] : h < 3 ? [0, c, x] : h < 4 ? [0, x, c] : h < 5 ? [x, 0, c] : [c, 0, x];
    return [a + m, bb + m, cc + m];
  };
  const lighter = lum(rgb(bgs[0])) < 0.18;
  for (let step = 1; step <= 100; step++) {
    const L = l + (lighter ? 1 : -1) * step * 0.005;
    if (L < 0 || L > 1) break;
    const c = fromHsl(L);
    if (bgs.every((bg) => ratio(c, rgb(bg)) >= MIN)) return hex(c);
  }
  return null;
}

let errors = 0;
const fail = (msg) => { errors++; console.error(`  ✗ ${msg}`); };

for (const [fg, bgs] of Object.entries(PAIRS)) {
  if (!tokens[fg]) continue; // token not defined in this theme
  const present = bgs.filter((b) => tokens[b]);
  const failing = present.filter((b) => ratio(rgb(tokens[fg]), rgb(tokens[b])) < MIN);
  if (!failing.length) continue;
  const detail = failing.map((b) => `${b} ${ratio(rgb(tokens[fg]), rgb(tokens[b])).toFixed(2)}:1`).join(', ');
  const fix = suggest(tokens[fg], present.map((b) => tokens[b]));
  fail(`--color-${fg} ${tokens[fg]} fails AA text contrast on ${detail} (needs ${MIN}:1)${fix ? ` — nearest passing value with the same hue: ${fix}` : ''}`);
}

// Opacity text classes actually used in src/.
function* sourceFiles(dir) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) yield* sourceFiles(p);
    else if (/\.(astro|tsx?|jsx?|mdx?)$/.test(entry)) yield p;
  }
}
const uses = new Map(); // "on-dark/45" -> Set(files)
for (const f of sourceFiles('src')) {
  for (const [, cls] of readFileSync(f, 'utf8').matchAll(/(?<![\w:-])text-((?:on-dark|white)\/\d{1,3})\b/g)) {
    if (!uses.has(cls)) uses.set(cls, new Set());
    uses.get(cls).add(f);
  }
}
for (const [cls, files] of [...uses].sort()) {
  const [token, pct] = cls.split('/');
  const alpha = Number(pct) / 100;
  const failing = OPACITY_BACKGROUNDS[token].filter((b) => tokens[b] && ratio(blend(rgb(tokens[token]), rgb(tokens[b]), alpha), rgb(tokens[b])) < MIN);
  if (!failing.length) continue;
  const minAlpha = [...Array(101).keys()].map((n) => n / 100).find((a) =>
    OPACITY_BACKGROUNDS[token].every((b) => !tokens[b] || ratio(blend(rgb(tokens[token]), rgb(tokens[b]), a), rgb(tokens[b])) >= MIN));
  const detail = failing.map((b) => `${b} ${ratio(blend(rgb(tokens[token]), rgb(tokens[b]), alpha), rgb(tokens[b])).toFixed(2)}:1`).join(', ');
  fail(`text-${cls} fails AA on ${detail} — used in ${[...files].map((f) => f.replace(/^src\//, '')).join(', ')}; the lowest passing opacity with this theme is text-${token}/${Math.round(minAlpha * 100)}`);
}

if (errors) {
  console.error(`\n✗ validate:contrast failed — ${errors} text contrast problem(s). Fix the token in ${THEME} or raise the opacity class; never lower the bar (§24).`);
  process.exit(1);
}
console.log(`✓ validate:contrast passed — ${Object.keys(PAIRS).length} text tokens on their backgrounds and ${uses.size} opacity text class(es) meet WCAG AA ${MIN}:1.`);
