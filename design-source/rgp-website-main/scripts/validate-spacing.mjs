#!/usr/bin/env node
/**
 * validate-spacing.mjs — no run-together words under Astro 7's whitespace rules (added 2026-10-07;
 * rules E–H added 2026-10-13 after the 13-site Astro 7 upgrade found glued words A–D missed).
 *
 * Astro 7 compiles .astro markup with JSX whitespace rules (compressHTML: 'jsx', the default): a line
 * break next to a tag or a {expression} is REMOVED, not turned into a space. So this source
 *     <a href="/contact/">Send us a message</a>
 *     and we will point you in the right direction.
 * renders "Send us a messageand we will…". The built-HTML checks cannot see it (they read text with
 * tags replaced by spaces), so it is caught here, in the source, where it starts.
 * (Text ⏎ text is safe: JSX joins two text lines with one space.)
 *
 * Fails when, in the markup of any src/**\/*.astro file:
 *   A) a line ending in text — a word, or sentence punctuation / a dash like "," "." ":" "—" — is followed by a line
 *      starting with an inline tag. The first line may itself start with a tag.
 *        "Call us at" ⏎ "<a …>"        "cleanup," ⏎ "<a …>water damage restoration</a>"
 *        "<a href="/a/">Mold</a> and" ⏎ "<a href="/b/">…"
 *   B) a line ending with an inline closing tag is followed by text        ("</a>" ⏎ "and we will")
 *   C) a line that starts with text and ends with an inline closing tag is followed by a line
 *      starting with an inline tag   ("Learn More<span class="sr-only">…</span>" ⏎ "<span>→</span>")
 *   D) a line ending with a {text expression} is followed by a line starting with an inline tag
 *      ("{item.linkLabel}" ⏎ "<span>→</span>"). Block closers like ")}" are not text and are skipped.
 *   E) a line ending with an inline element that holds words is followed by a line starting with a
 *      {text expression} ("<span class="badge">{post.categoryName}</span>" ⏎ "{post.date}" → "Case StudiesMarch 12").
 *      Icon wrappers, empty dots and aria-hidden elements hold no words and are skipped.
 *   F) text and a {text expression} on consecutive lines, either order
 *      ("Serving" ⏎ "{city}" → "Serving{city}";  "{count}" ⏎ "homes restored" → "120homes restored")
 *   G) on ONE line, an inline element that holds words, closed and immediately followed by a word or a
 *      {text expression} ("<strong>{item.title}</strong>{item.text}"  "<strong>Title</strong>If water…"
 *      → "TitleIf water") — no line break involved, so this is glued in every Astro version. If the data
 *      already ends the title with a space, {' '} is still harmless (HTML collapses the double space).
 *   H) inside an <h1>–<h6>, a .map() that renders each line as an inline tag with the class "block"
 *      ("{h1Lines.map((line) => (" ⏎ "<span class="block">{line.text}</span>"). On screen each line is
 *      its own row, but the heading's text (textContent — what crawlers, AI readers and SEO tools
 *      extract) is "Water DamageRestoration". Fix: {' '} inside the span after the text:
 *      <span class="block">{line.text}{' '}</span>.
 * Fix (A–G): keep both on one line with a real space, or make the space explicit with {' '} at the end
 * of the first line (G: add a space or {' '} between the tag and what follows).
 * {' '} is harmless inside flex/grid containers (whitespace between their items is not rendered).
 *
 * Not flagged: punctuation that should touch the tag ("</a>." "</a>," "</a>)"), "</a>s" (plural),
 * a line ending in an HTML entity ("&nbsp;" is already a space), {' '} already present, block closers
 * (")}" "))}"), expressions that render markup (they contain "<" or "=>"), frontmatter, <script>/<style>,
 * multi-line opening tags, <!-- --> and {/* *\/} comments, two adjacent tags with no text between them,
 * and two {expressions} on consecutive lines (usually flex items, e.g. a date and a read time).
 *
 * Out of scope (the source cannot tell whether they glue, so check them in the browser — see §17):
 * two inline elements on consecutive lines ("<span>Top</span>" ⏎ "<span>Full-Service</span>") — nearly
 * always flex/block items or responsive alternates (sm:hidden / hidden sm:inline); flagging them gave
 * ~270 findings on the 13 already-verified sites. Text from data files, markdown, a CMS or set:html.
 *
 * Usage: node scripts/validate-spacing.mjs [srcDir]   Exit 1 on any finding.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = resolve(process.argv[2] ?? join(ROOT, 'src'));

const INLINE = 'a|span|strong|em|b|i|small|abbr|time|code|mark|q|cite|u|s|sup|sub|kbd';
const OPEN_INLINE = new RegExp(`^<(?:${INLINE})(?=[\\s>/])`);
const OPENS_INLINE = new RegExp(`^<(?:${INLINE})(?=[\\s>/]|$)`); // also a bare "<a" whose attributes follow on the next lines
const CLOSE_INLINE_END = new RegExp(`</(?:${INLINE})>$`);
const TEXT_END = /[\p{L}\p{N}%'"’”]$/u;
const TEXT_START = /^[\p{L}\p{N}(“"'‘$#&—–-]/u;
const PUNCT_END = /[.,;:!?…—–)]$/u; // sentence punctuation or a dash ending a text line (rule A)
const ENTITY_END = /&(?:#\d+|#x[\da-f]+|[a-z]\w*);$/i; // "&nbsp;" at the end is already a space
const SPACE_EXPR = /\{\s*(['"`])\s+\1\s*\}/; // {' '}
const CLOSE_INLINE_THEN = new RegExp(`</(?:${INLINE})>(?=\\{|[\\p{L}\\p{N}]{2})`, 'gu');
const HEADING_OPEN = /<h[1-6](?=[\s>])/g;
const HEADING_OPEN_ONE = /<h[1-6](?=[\s>])/;
const HEADING_CLOSE = /<\/h[1-6]>/g;

/** Index just past the `}` that closes the `{` at `start`, or -1 when it does not close on this line. */
function closeBrace(line, start) {
  let depth = 0;
  let quote = null;
  for (let i = start; i < line.length; i++) {
    const c = line[i];
    if (quote) { if (c === '\\') i++; else if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'" || c === '`') quote = c;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return i + 1;
  }
  return -1;
}

/** A {…} whose output is plain text: not a comment, not {' '}, no markup ("<") and no callback ("=>"). */
function isTextExpression(group) {
  const inner = group.slice(1, -1).trim();
  if (!inner || inner.startsWith('/*') || inner.startsWith('...')) return false;
  if (/^[\w$]+\s*:/.test(inner) || /^['"][^'"]*['"]\s*:/.test(inner)) return false; // object literal { label: … }
  if (SPACE_EXPR.test(group)) return false;
  return !/<|=>/.test(inner);
}

/** The line starts with a {text expression}, e.g. "{post.date}" or "{item}</li>". */
function startsWithTextExpression(line) {
  if (!line.startsWith('{')) return false;
  const end = closeBrace(line, 0);
  return end > 0 && isTextExpression(line.slice(0, end));
}

/** The line ends with a {text expression}, e.g. "<p>{intro}" or "{post.date}". */
function endsWithTextExpression(line) {
  if (!line.endsWith('}')) return false;
  for (let s = line.lastIndexOf('{'); s >= 0; s = line.lastIndexOf('{', s - 1)) {
    if (closeBrace(line, s) === line.length) return isTextExpression(line.slice(s));
  }
  return false;
}

/** The line ends in text: a word or sentence punctuation, not a tag, an expression or an entity. */
function endsWithText(line) {
  if (/^[{})]/.test(line) || line.includes('=>')) return false; // "=>": a JavaScript line, not text
  return TEXT_END.test(line) || (PUNCT_END.test(line) && !ENTITY_END.test(line));
}

/**
 * Index of the `>` that ends an opening tag — outside quotes and {…}, not the ">" of "=>" — searching from `from`
 * with `state.depth` open braces carried over from the tag's earlier lines (updated in place); -1 if none.
 */
function tagEnd(line, from = 0, state = { depth: 0 }) {
  let quote = null;
  for (let i = from; i < line.length; i++) {
    const c = line[i];
    if (quote) { if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'" || c === '`') quote = c;
    else if (c === '{') state.depth++;
    else if (c === '}') state.depth--;
    else if (c === '>' && state.depth <= 0 && line[i - 1] !== '=') return i;
  }
  return -1;
}

/**
 * The inline element closed by the `</tag>` at `closeIdx` carries visible words of its own: its opening tag is on
 * this line, it is not aria-hidden, its content has a letter/digit or a {text expression}, and that content does not
 * already end with a space. Icon wrappers (`<span aria-hidden="true"><Icon …/></span>`), empty dots and
 * `<span class="sr-only">Step 1: </span>` are not words that can glue.
 */
function closesWords(line, closeIdx) {
  const name = line.slice(closeIdx + 2).match(/^\w+/)[0];
  const tags = new RegExp(`<(/?)${name}(?=[\\s>/])`, 'g');
  const stack = [];
  for (const m of line.slice(0, closeIdx).matchAll(tags)) { if (m[1]) stack.pop(); else stack.push(m.index); }
  if (!stack.length) return null;
  const open = stack.pop();
  const openEnd = tagEnd(line, open);
  if (openEnd < 0) return null;
  const openTag = line.slice(open, openEnd + 1);
  const inner = line.slice(openEnd + 1, closeIdx);
  if (/aria-hidden=(?:"true"|'true'|\{true\})/.test(openTag)) return null;
  if (/\s$|\{\s*(['"`])\s+\1\s*\}$/.test(inner)) return null;
  const words = inner.replace(/<[^>]*>/g, '');
  if (!/[\p{L}\p{N}]/u.test(words.replace(/\{[^{}]*\}/g, '')) && !/\{[^{}]+\}/.test(words)) return null;
  return { open, openTag };
}

/** Class tokens of the first tag on the line include "block" (also "md:block"; not "inline-block"). */
function hasBlockClass(tag) {
  const cls = tag.match(/\bclass(?::list)?=(?:"([^"]*)"|'([^']*)'|\{(.*)\})/);
  return !!cls && /(?<![\w-])block(?![\w-])/.test(cls[1] ?? cls[2] ?? cls[3]);
}

export function findSpacingIssues(source) {
  const lines = source.split('\n');
  let n = 0;
  if (lines[0]?.trim() === '---') { n = 1; while (n < lines.length && lines[n].trim() !== '---') n++; n++; }
  const issues = [];
  const flag = (rule, line, text) => issues.push({ rule, line: line + 1, text });
  let inBlock = false; // <script> / <style> body
  let inTag = false; // attribute lines of a multi-line opening tag
  let tagState = { depth: 0 }; // open { of that tag's attribute expressions
  let inComment = null; // closing marker of a multi-line comment: '-->' or '*/}'
  let heading = 0; // open <h1>–<h6> elements
  let prevCode = ''; // previous non-blank markup line (rule H)
  for (; n < lines.length; n++) {
    let cur = lines[n].trim();
    let afterTag = false; // cur is the rest of a line that ended a multi-line opening tag
    if (inComment) { if (cur.includes(inComment)) inComment = null; continue; }
    if (/^<(script|style)\b/.test(cur) && !/<\/(script|style)>/.test(cur)) { inBlock = true; continue; }
    if (inBlock) { if (/<\/(script|style)>/.test(cur)) inBlock = false; continue; }
    if (inTag) {
      // The tag ends on this line; check any markup after it ('href="/x">hardwood floors</a>').
      const end = tagEnd(cur, 0, tagState);
      if (end < 0 && !/>\s*$/.test(cur) && !/^\/?>/.test(cur)) continue;
      inTag = false;
      cur = end < 0 ? '' : cur.slice(end + 1).trim();
      if (!cur) continue;
      afterTag = true;
    }
    if (/^<[A-Za-z][\w.-]*(\s[^>]*)?$/.test(cur)) { inTag = true; tagState = { depth: 0 }; tagEnd(cur, 0, tagState); continue; }
    // An opening tag that starts mid-line and continues on the next lines ("{i === 1 && <Tiles").
    const midTag = cur.search(/<[A-Za-z][\w.-]*(\s[^<>]*)?$/);
    if (midTag > 0) {
      tagState = { depth: 0 };
      if (tagEnd(cur, midTag, tagState) < 0) { inTag = true; continue; }
    }
    if (cur.startsWith('<!--') && !cur.includes('-->')) { inComment = '-->'; continue; }
    if (cur.startsWith('{/*') && !cur.includes('*/}')) { inComment = '*/}'; continue; }
    if (!cur || cur.startsWith('{/*') || cur.startsWith('<!--')) continue;

    // H) heading lines rendered by .map() as block-styled inline tags, with no {' '} between them.
    const headingAtStart = heading;
    heading = Math.max(0, heading + (cur.match(HEADING_OPEN)?.length ?? 0) - (cur.match(HEADING_CLOSE)?.length ?? 0));
    if (headingAtStart > 0 || HEADING_OPEN_ONE.test(cur)) {
      const sameLine = cur.match(new RegExp(`\\.map\\(.*?=>\\s*\\(?\\s*(<(?:${INLINE})(?=[\\s>/])[^>]*>)`));
      const ownLine = OPEN_INLINE.test(cur) && /\.map\(.*=>\s*\(?$/.test(prevCode) ? cur.match(/^<[^>]*>/) : null;
      const tag = sameLine?.[1] ?? ownLine?.[0];
      if (tag && hasBlockClass(tag)) {
        // The mapped element: up to the line that closes the .map() — ")}" / "))}" — or 8 lines.
        let body = cur;
        if (!(sameLine && /\)\}$/.test(cur))) {
          for (let k = n + 1; k < lines.length && k <= n + 8; k++) { body += `\n${lines[k].trim()}`; if (/^\)+\}/.test(lines[k].trim())) break; }
        }
        if (!SPACE_EXPR.test(body)) flag('H', n, `${cur.slice(0, 100)}  (heading lines glued in the page text)`);
      }
    }
    prevCode = cur;

    // G) same line: inline closing tag immediately followed by a word or a {text expression}.
    const visible = cur.replace(/<!--.*?-->/g, '').replace(/\{\/\*.*?\*\/\}/g, '');
    for (const m of visible.matchAll(CLOSE_INLINE_THEN)) {
      const after = m.index + m[0].length;
      if (visible[after] === '{') {
        const end = closeBrace(visible, after);
        if (end < 0 || !isTextExpression(visible.slice(after, end))) continue;
      }
      const el = closesWords(visible, m.index);
      if (!el) continue;
      // "{before}<span>{term}</span>{after}" splits one string around a highlight; the pieces carry their own spaces.
      if (visible[after] === '{' && /\}\s*(?:\{[^{}]*(?:&&|\?)\s*\(?\s*)?(?:<>)?\s*$/.test(visible.slice(0, el.open))) continue;
      flag('G', n, visible.slice(Math.max(0, m.index - 30), after + 30));
      break;
    }

    if (n >= lines.length - 1) break;
    let k = n + 1;
    while (k < lines.length && !lines[k].trim()) k++;
    const next = (lines[k] ?? '').trim();
    if (!next) continue;
    const pair = `${cur.slice(-45)} ⏎ ${next.slice(0, 45)}`;

    const curIsText = !/^[<{})]/.test(cur) && TEXT_END.test(cur);
    const textThenTag = !/^[<{})]/.test(cur) && CLOSE_INLINE_END.test(cur);
    // A {expression} at the end of a line that outputs text — not a block closer like ")}" and not an explicit {' '}.
    const textExpression = /\}$/.test(cur) && !/^[)\]}]+$/.test(cur) && !/\{\s*(['"])\s+\1\s*\}$/.test(cur) && !/^\{\/\*/.test(cur);
    const nextIsInline = OPEN_INLINE.test(next);
    const nextOpensInline = OPENS_INLINE.test(next);
    const nextIsExpression = startsWithTextExpression(next);
    const nextIsText = TEXT_START.test(next);
    if (curIsText && nextIsInline) flag('A', n, pair);
    else if (endsWithText(cur) && nextOpensInline) flag('A', n, pair);
    else if (CLOSE_INLINE_END.test(cur) && nextIsText) flag('B', n, pair);
    else if (textThenTag && nextIsInline && !afterTag) flag('C', n, pair);
    else if (textExpression && nextIsInline) flag('D', n, pair);
    else if (CLOSE_INLINE_END.test(cur) && nextIsExpression && closesWords(cur, cur.lastIndexOf('</'))) flag('E', n, pair);
    else if (endsWithText(cur) && nextIsExpression) flag('F', n, pair);
    else if (endsWithTextExpression(cur) && nextIsText && !next.startsWith('<')) flag('F', n, pair);
  }
  return issues;
}

const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
if (import.meta.url === `file://${process.argv[1]}`) {
  const found = [];
  for (const file of walk(SRC).filter((f) => f.endsWith('.astro'))) {
    for (const it of findSpacingIssues(readFileSync(file, 'utf8'))) found.push(`  ${relative(ROOT, file)}:${it.line}  [${it.rule}] ${it.text}`);
  }
  if (found.length) {
    console.error(`✗ validate:spacing — ${found.length} place(s) where Astro 7 glues words together (rules A–H in the script header):`);
    console.error(found.join('\n'));
    console.error("  Fix: put both on one line with a space, or end the first line with {' '} to keep the space (H: {' '} inside the span).");
    process.exit(1);
  }
  console.log('✓ validate:spacing — no run-together words under Astro 7 whitespace rules (rules A–H)');
}
