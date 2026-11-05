#!/usr/bin/env node
/**
 * generate-favicons.mjs — site identity assets from the client logo (CORE_CONTRACTS §26).
 *
 * Writes into public/: favicon-32.png, favicon-192.png, apple-touch-icon.png (180), og-default.png
 * (1200×630), favicon.svg when the source is SVG, and site-identity.json (what was used, when, and
 * whether it is the starter placeholder). BaseLayout links all of them on every page; validate:built
 * requires them and warns (preview) / fails (launch) while site-identity.json says placeholder.
 *
 * Usage: npm run favicons:generate -- <logo.svg|png> [--mark <square-icon.svg|png>] [--bg #hex] [--placeholder]
 *   --mark   a square icon/monogram for the favicon set (wide logos shrink to nothing at 32px). Without it
 *            the logo is fitted onto a square background — acceptable, not ideal; ask the client for a mark.
 *   --bg     background for the square/OG canvases; default = --color-dark from src/styles/theme.css.
 */
import { readFileSync, writeFileSync, existsSync, copyFileSync, mkdirSync } from 'node:fs';
import { extname } from 'node:path';
import sharp from 'sharp';
const argv = process.argv.slice(2);
const opt = (k) => { const i = argv.indexOf(k); return i > -1 ? argv[i + 1] : null; };
const logo = argv.find((a) => !a.startsWith('--') && argv[argv.indexOf(a) - 1] !== '--mark' && argv[argv.indexOf(a) - 1] !== '--bg');
if (!logo || !existsSync(logo)) { console.error('usage: favicons:generate -- <logo.svg|png> [--mark <square.svg|png>] [--bg #hex] [--placeholder]'); process.exit(1); }
const mark = opt('--mark') && existsSync(opt('--mark')) ? opt('--mark') : logo;
const theme = existsSync('src/styles/theme.css') ? readFileSync('src/styles/theme.css', 'utf8') : '';
const bg = opt('--bg') || theme.match(/--color-dark:\s*(#[0-9a-fA-F]{3,8})/)?.[1] || '#0c0f14';
mkdirSync('public', { recursive: true });

const square = async (src, size, pad) => {
  const inner = Math.round(size * (1 - pad * 2));
  const icon = await sharp(src).resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  return sharp({ create: { width: size, height: size, channels: 4, background: bg } }).composite([{ input: icon, gravity: 'centre' }]).png();
};
await (await square(mark, 32, 0.08)).toFile('public/favicon-32.png');
await (await square(mark, 192, 0.12)).toFile('public/favicon-192.png');
await (await square(mark, 180, 0.14)).toFile('public/apple-touch-icon.png');
if (extname(mark).toLowerCase() === '.svg') copyFileSync(mark, 'public/favicon.svg');
// OG default: logo centered on the brand dark canvas, 1200×630
const ogLogo = await sharp(logo).resize(720, 300, { fit: 'inside', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
await sharp({ create: { width: 1200, height: 630, channels: 4, background: bg } }).composite([{ input: ogLogo, gravity: 'centre' }]).png().toFile('public/og-default.png');
writeFileSync('public/site-identity.json', JSON.stringify({ source: logo, mark, background: bg, generatedAt: new Date().toISOString(), placeholder: argv.includes('--placeholder') }, null, 2) + '\n');
console.log(`favicons:generate — favicon-32/192, apple-touch-icon, og-default${extname(mark).toLowerCase() === '.svg' ? ', favicon.svg' : ''} written from ${mark === logo ? logo : `${mark} (mark) + ${logo} (OG)`} on ${bg}${argv.includes('--placeholder') ? '  [PLACEHOLDER — replace before launch]' : ''}`);
