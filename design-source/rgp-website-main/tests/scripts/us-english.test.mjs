/**
 * §7 US English: scripts/lib/us-english.mjs (shared by validate:built and validate:artifacts) flags British
 * spellings in customer-facing text, never American ones, and allows listed proper nouns.
 * Run: npm run test:scripts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findUkSpellings, usEnglishMessage } from '../../scripts/lib/us-english.mjs';

test('British spellings are found with their US form', () => {
  const hits = findUkSpellings('We remove Mould and smoke odour, sanitise the area and answer every enquiry.');
  assert.deepEqual(hits.map((h) => [h.uk.toLowerCase(), h.us]), [['mould', 'mold'], ['odour', 'odor'], ['sanitise', 'sanitize'], ['enquiry', 'inquiry']]);
  assert.match(usEnglishMessage(hits), /"Mould" → "mold"/);
});

test('American copy passes, including words that merely contain a British form', () => {
  assert.deepEqual(findUkSpellings('Mold, odor, color, center, license, gray, inquiry, traveled, realistic, programmer, centered layout.'), []);
});

test('a listed proper noun is allowed, the same word elsewhere is not', () => {
  const text = 'Visit the Raleigh Convention Centre. Our centre is open 24/7.';
  assert.deepEqual(findUkSpellings(text, ['Raleigh Convention Centre']).map((h) => h.uk), ['centre']);
  assert.deepEqual(findUkSpellings('Visit the Raleigh Convention Centre.', ['raleigh convention centre']), []);
});
