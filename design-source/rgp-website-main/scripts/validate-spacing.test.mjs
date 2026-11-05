// Tests for validate-spacing.mjs. Run: node --test scripts/validate-spacing.test.mjs
// Positive cases are real run-together words found upgrading client sites to Astro 7; negative cases are
// correct markup that must stay quiet.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findSpacingIssues } from './validate-spacing.mjs';

const rules = (src) => findSpacingIssues(src).map((i) => i.rule);
const flags = (rule, src) => assert.ok(rules(src).includes(rule), `expected rule ${rule} on:\n${src}\ngot ${JSON.stringify(rules(src))}`);
const clean = (src) => assert.deepEqual(rules(src), [], `expected no findings on:\n${src}`);

// ---------- positives: rules A–D (unchanged) ----------
test('A: text line, then an inline tag', () => flags('A', '<p>\n  Call us at\n  <a href="tel:1">555</a>\n</p>'));
test('B: inline closing tag, then text', () => flags('B', '<p>\n  <a href="/contact/">Send us a message</a>\n  and we will help.\n</p>'));
test('C: text ending in a closing inline tag, then an inline tag', () =>
  flags('C', '<a href="/x/">\n  Learn More<span class="sr-only"> about mold</span>\n  <span aria-hidden="true">→</span>\n</a>'));
test('D: {text expression}, then an inline tag', () => flags('D', '<a href={url}>\n  {item.linkLabel}\n  <span>→</span>\n</a>'));

// ---------- positives: the patterns A–D missed ----------
test('E (pattern 1): badge span at end of line, then a {date} line — "Case StudiesMarch 12"', () =>
  flags('E', '<p class="meta">\n  <span class="badge">{post.categoryName}</span>\n  {post.date}\n</p>'));
test('E: also when the expression line closes the parent', () =>
  flags('E', '<p>\n  <span class="badge">{post.categoryName}</span>\n  {post.date}</p>'));
test('G (pattern 2): <strong>{title}</strong>{text} on one line', () =>
  flags('G', '<li><span><strong>{item.title}</strong>{item.text}</span></li>'));
test('G (pattern 2): <strong>Title</strong>Word on one line — "supportEmergency"', () =>
  flags('G', '<p><strong>One-stop restoration support</strong>Emergency cleanup when you need it.</p>'));
test('A (pattern 3): line ending in a comma, then a link — "cleanup,water damage"', () =>
  flags('A', '<p>\n  We handle storm cleanup,\n  <a href="/water/">water damage restoration</a>, and more.\n</p>'));
test('A (pattern 3): line ending in a period / dash, then a link', () => {
  flags('A', '<p>\n  Drying is measured, not guessed.\n  <a href="/drying/">Structural drying</a> explains how.\n</p>');
  flags('A', '<p>\n  That is an assessment, not a rule —\n  <a href="/mold/">mold removal</a> covers it.\n</p>');
});
test('A (pattern 4): line starting with an inline tag and ending in text, then an inline tag', () =>
  flags('A', '<p>\n  <a href="/mold/">Mold removal</a> and\n  <a href="/odor/">odor removal</a> are separate.\n</p>'));
test('A: a bare "<a" whose attributes continue on the next line', () =>
  flags('A', '<p>\n  Read our guide on\n  <a\n    href="/guide/">drying</a> first.\n</p>'));
test('B: the closing tag ends a multi-line opening tag', () =>
  flags('B', '<p>\n  See <a\n  href="/hardwood/">hardwood floor water damage</a>\n  covers wood flooring.\n</p>'));
test('F (pattern 5): text, then a {expression} line', () => flags('F', '<p>\n  Serving\n  {city}\n</p>'));
test('F (pattern 5): {expression}, then a text line', () => flags('F', '<p>\n  {count}\n  homes restored this year.\n</p>'));
test('H (pattern 6): h1 lines mapped to block spans without a space', () =>
  flags('H', '<h1 class="title">\n  {h1Lines.map((line) => (\n    <span class:list={[\'block md:whitespace-nowrap\', { accent: line.accent }]}>{line.text}</span>\n  ))}\n</h1>'));
test('H: the same on one line', () =>
  flags('H', '<h2>{lines.map((l) => <span class="block">{l}</span>)}</h2>'));

// ---------- negatives ----------
test('punctuation that should touch the tag is not flagged', () => {
  clean('<p>\n  Call <a href="/contact/">our office</a>.\n</p>');
  clean('<p>\n  <a href="/contact/">our office</a>\n  .\n</p>');
  clean('<p>\n  <a href="/a/">Mold</a>,\n</p>');
  clean('<p>See <a href="/a/">service</a>s for details.</p>');
});
test("an explicit {' '} is not flagged", () => {
  clean("<p>\n  Call us at{' '}\n  <a href=\"tel:1\">555</a>\n</p>");
  clean("<p>\n  <span class=\"badge\">{post.categoryName}</span>{' '}\n  {post.date}\n</p>");
  clean("<li><strong>{item.title}</strong>{' '}{item.text}</li>");
  clean("<p>\n  We handle storm cleanup,{' '}\n  <a href=\"/water/\">water damage</a>\n</p>");
  clean("<h1>\n  {h1Lines.map((line) => (\n    <span class=\"block\">{line.text}{' '}</span>\n  ))}\n</h1>");
});
test('block closers and markup-rendering expressions are not text', () => {
  clean('<ul>\n  {items.map((item) => (\n    <li>{item}</li>\n  ))}\n  <span>after</span>\n</ul>');
  clean('<div>\n  {cond && (\n    <p>Hi</p>\n  )}\n</div>');
  clean('<p>\n  <span class="badge">{x}</span>\n  {items.map((i) => <b>{i}</b>)}\n</p>');
});
test('a line ending in &nbsp; already has its space', () => clean('<p>\n  Call us&nbsp;\n  <a href="tel:1">555</a>\n</p>'));
test('text ⏎ text joins with a space and is not flagged', () => clean('<p>\n  We dry homes\n  across the valley.\n</p>'));
test('icon wrappers and empty decorative spans before a {label} are not flagged', () => {
  clean('<li>\n  <span class="dot" aria-hidden="true"></span>\n  {chip}\n</li>');
  clean('<li>\n  <span class="icon" aria-hidden="true"><Icon name="check" /></span>\n  {item}\n</li>');
  clean('<li><span class="dot" aria-hidden="true"></span>{chip}</li>');
  clean('<button><span class="sr-only">Step {i + 1}: </span>{step.title}</button>');
});
test('a string split around a highlight is not flagged', () => {
  clean('<h2>{before}<span class="hl">{word}</span>{after}</h2>');
  clean('<p>{emBefore}{emAfter !== null && <><a href={tel}>{phone}</a>{emAfter}</>}</p>');
});
test('two adjacent tags with no text between them are not flagged', () =>
  clean('<nav>\n  <a href="/a/">Home</a>\n  <a href="/b/">About</a>\n</nav>'));
test('two {expressions} on consecutive lines are not flagged', () => clean('<p class="flex gap-2">\n  {post.date}\n  {post.readTime}\n</p>'));
test('frontmatter, <script>, <style> and comments are skipped', () => {
  clean('---\nconst a = "Call us at"\n---\n<p>Hi</p>');
  clean('<script>\n  const label = "Call us at"\n  el.innerHTML = "<a>x</a>";\n</script>');
  clean('<style>\n  .a { color: red; }\n  <span>\n</style>');
  clean('<!--\n  Explains the layout.\n  <a> is a link\n-->\n<p>Hi</p>');
  clean('{/*\n  Explains the layout.\n  <a> is a link\n*/}\n<p>Hi</p>');
});
test('attribute lines of a multi-line component tag are skipped', () => {
  clean('<Hero\n  eyebrow={proof[1]}\n  h1Lines={lines.map((t, i) => ({\n    text: t.replace(/x/, (m) => m),\n  }))}\n  subhead={hero.subhead}\n  backgroundImage={photo}\n/>');
  clean('{i === 1 && <Tiles\n  leftHeading="What people tell us"\n  rightHeading={s.heading}\n  problems={[\n    { title: \'A\', text: \'B\' },\n  ]}\n/>}');
});
test('object literals inside a mapped array are not text', () =>
  clean('<ul>\n  {[\n    ...site.services.map((svc) => ({ label: svc.label, url: svc.url })),\n    { label: \'Areas We Serve\', url: \'/service-area/\' },\n  ].map((l) => (\n    <li>{l.label}</li>\n  ))}\n</ul>'));
test('block spans mapped outside a heading are not flagged (rule H is headings only)', () =>
  clean('<nav>\n  {links.map((l) => (\n    <a class="block py-2" href={l.url}>{l.label}</a>\n  ))}\n</nav>'));
