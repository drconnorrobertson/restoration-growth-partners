/**
 * US English spelling (CORE_CONTRACTS §7, owner decision 2026-11-02): every customer-facing word on an agency
 * site uses American spelling — "mold", "odor", "color", "center", "sanitize", "inquiry", "license".
 *
 * findUkSpellings(text) returns the British spellings found in a piece of VISIBLE text, each with the US form, so
 * validate:built (rendered pages) and validate:artifacts (approved copy) can fail on them. Only unambiguous
 * British-only forms are listed: a word that is also correct American English never appears here.
 *
 * A real proper noun that uses a British spelling (a business called "… Centre", a street "Grey Ave") is allowed by
 * listing it, one per line, in the client repo's artifacts/us-english-exceptions.txt — exact phrase, any case.
 * Pure functions; no I/O except readExceptions().
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// British form → American form. Inflections are listed explicitly so nothing over-matches.
export const UK_TO_US = {
  colour: 'color', colours: 'colors', coloured: 'colored', colouring: 'coloring', discoloured: 'discolored', discolouration: 'discoloration',
  odour: 'odor', odours: 'odors', odourless: 'odorless',
  mould: 'mold', moulds: 'molds', mouldy: 'moldy',
  centre: 'center', centres: 'centers', centred: 'centered',
  metre: 'meter', metres: 'meters', litre: 'liter', litres: 'liters', fibre: 'fiber', fibres: 'fibers', fibreglass: 'fiberglass',
  neighbour: 'neighbor', neighbours: 'neighbors', neighbouring: 'neighboring', neighbourhood: 'neighborhood', neighbourhoods: 'neighborhoods',
  behaviour: 'behavior', behaviours: 'behaviors', favour: 'favor', favourite: 'favorite', favourites: 'favorites', favourable: 'favorable',
  honour: 'honor', honoured: 'honored', labour: 'labor', vapour: 'vapor', harbour: 'harbor', rumour: 'rumor', humour: 'humor', endeavour: 'endeavor',
  licence: 'license', licences: 'licenses', defence: 'defense', offence: 'offense',
  organise: 'organize', organised: 'organized', organising: 'organizing', organisation: 'organization', organisations: 'organizations',
  recognise: 'recognize', recognised: 'recognized', realise: 'realize', realised: 'realized', apologise: 'apologize',
  minimise: 'minimize', minimised: 'minimized', minimising: 'minimizing', maximise: 'maximize', prioritise: 'prioritize',
  specialise: 'specialize', specialised: 'specialized', specialises: 'specializes', specialising: 'specializing',
  sanitise: 'sanitize', sanitised: 'sanitized', sanitising: 'sanitizing', sanitisation: 'sanitization',
  deodorise: 'deodorize', deodorised: 'deodorized', deodorising: 'deodorizing', deodorisation: 'deodorization',
  neutralise: 'neutralize', neutralised: 'neutralized', stabilise: 'stabilize', stabilised: 'stabilized', stabilisation: 'stabilization',
  utilise: 'utilize', utilised: 'utilized', standardise: 'standardize', customise: 'customize', customised: 'customized',
  authorise: 'authorize', authorised: 'authorized', authorisation: 'authorization', categorise: 'categorize', emphasise: 'emphasize',
  analyse: 'analyze', analysed: 'analyzed', analysing: 'analyzing', paralysed: 'paralyzed',
  catalogue: 'catalog', programme: 'program', programmes: 'programs', cheque: 'check', cheques: 'checks',
  grey: 'gray', tyre: 'tire', tyres: 'tires', aluminium: 'aluminum', jewellery: 'jewelry', storey: 'story', storeys: 'stories',
  kerb: 'curb', plough: 'plow', sulphur: 'sulfur', fulfil: 'fulfill', enrol: 'enroll',
  travelled: 'traveled', travelling: 'traveling', cancelled: 'canceled', cancelling: 'canceling', modelled: 'modeled', labelled: 'labeled',
  enquiry: 'inquiry', enquiries: 'inquiries', enquire: 'inquire', whilst: 'while', learnt: 'learned', spelt: 'spelled',
  practise: 'practice', practised: 'practiced',
};

const WORD = new RegExp(`\\b(${Object.keys(UK_TO_US).join('|')})\\b`, 'gi');

/** @returns {{uk: string, us: string}[]} unique British spellings in `text` (exceptions removed first). */
export function findUkSpellings(text, exceptions = []) {
  let t = String(text ?? '');
  for (const e of exceptions) if (e) t = t.replace(new RegExp(e.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), ' ');
  const seen = new Map();
  for (const [, w] of t.matchAll(WORD)) {
    const k = w.toLowerCase();
    if (!seen.has(k)) seen.set(k, { uk: w, us: UK_TO_US[k] });
  }
  return [...seen.values()];
}

/** Proper-noun exceptions from <repo>/artifacts/us-english-exceptions.txt (one phrase per line; # comments). */
export function readExceptions(repoRoot) {
  const f = join(repoRoot, 'artifacts', 'us-english-exceptions.txt');
  if (!existsSync(f)) return [];
  return readFileSync(f, 'utf8').split('\n').map((l) => l.replace(/#.*/, '').trim()).filter(Boolean);
}

export const usEnglishMessage = (hits) =>
  `British spelling in customer-facing text: ${hits.map((h) => `"${h.uk}" → "${h.us}"`).join(', ')} — agency sites use US English (§7). A real proper noun goes in artifacts/us-english-exceptions.txt`;
