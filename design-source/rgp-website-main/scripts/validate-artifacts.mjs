#!/usr/bin/env node
/**
 * Layer-2 validators for the pipeline's handoff artifacts (PIPELINE.md,
 * Rejection Encoding Rule: component > validator > schema > prose).
 *
 * Validates, when present in the artifacts dir:
 *   messaging-pack.yaml   (schema: docs/.../schemas/messaging-pack.yaml)
 *   design-recipe.yaml    (schema: docs/.../schemas/design-recipe.yaml)
 *   active-page-map.yaml  (schema: docs/.../schemas/active-page-map.yaml)
 *
 * Usage:
 *   node scripts/validate-artifacts.mjs [dir]
 * With no dir: validates ./artifacts if any artifact exists there, otherwise
 * ./artifacts/examples (the fixtures), so `npm run check` always exercises
 * this machinery. Client builds put real artifacts in ./artifacts/.
 *
 * Exit 1 on any ERROR. WARNINGs print but do not fail.
 *
 * Born from a real failure (2026-08-28, first pilot): the homepage H2 rule
 * lived in the copywriter skill (Stage 4b) while the homepage H2 was produced
 * as a Messaging Pack field (Stage 4a), and nothing bridged them. 37k words of
 * prose rules, zero automated checks. These ~250 lines are the bridge.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { SEO_LIMITS, containsPhrase, locationLabel, allowedTitles, suggestTitleRule, servicePhraseProblem, KEYWORD_PAGE_TYPES, LOCAL_PAGE_TYPES } from '../src/utils/seo.mjs';
import { findUkSpellings, readExceptions, usEnglishMessage } from './lib/us-english.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];
const warnings = [];
const err = (file, msg) => errors.push(`${file}: ${msg}`);
const warn = (file, msg) => warnings.push(`${file}: ${msg}`);

// ---------------------------------------------------------------- shared

// §7 hard-block phrases — internal planning language that must never render.
const BANNED = [
  'service architecture', 'approved rollout', 'source reserved',
  'review source reserved', 'widget-ready', 'launch input', 'proof plan',
  'page map', 'page targets', 'target cities',
  'city-service pages are deferred', 'lorem ipsum', 'placeholder',
];
const DOC_URL = /^https:\/\/docs\.google\.com\/document\/d\/[A-Za-z0-9_-]+/;
// §7 soft-flag words — legitimate English; warn, never fail.
const SOFT = ['brief', 'candidate', 'deferred', 'mockup', 'targets'];
const US_EXCEPTIONS = readExceptions(ROOT);

const CLAIM_STATES = [
  'visible_preview_allowed', 'launch_proof_required',
  'badge_asset_required', 'never_without_explicit_approval',
];

/**
 * Variants that exist as BUILT starter components. A recipe naming anything
 * else selects a component that does not exist (design-recipe.yaml rule #2).
 * UPDATE THIS MAP IN THE SAME COMMIT THAT SHIPS A NEW VARIANT COMPONENT.
 */
const BUILT_VARIANTS = {
  header: ['utility_strip_sticky_header', 'mega_menu_grouped_services'],
  hero: ['image_backed_split_form', 'premium_full_bleed'],
  proof_band: ['transition_strip'],
  service_cards: ['image_overlay_grid', 'icon_plus_media_cards'],
  process: ['dark_timeline_cards', 'numbered_connector_steps'],
  differentiator: ['dark_advantage_board'],
  reviews: ['real_widget_stacked', 'reserved_polished_state'],
  service_area: ['map_with_county_accordions', 'regional_service_explorer'],
  faq: ['premium_cards_sticky_intro'],
  final_cta: ['dark_phone_first_band'],
  footer: ['full_nap_service_footer'],
  mobile_sticky_cta: ['show_after_hero'],
};

const isBlank = (v) => v === undefined || v === null || String(v).trim() === '';

// §28 page SEO — shared checks for copy artifacts and the Messaging Pack.
const STATE_ABBR = /^[A-Z]{2}$/;
const seoTitles = new Map(); // title -> [files]   (duplicates across the site are an error)
const seoMetas = new Map();  // description -> [files]

/** Lengths + presence for any page's seo block; returns { title, meta }. */
function checkSeoBlock(file, seo) {
  const title = String(seo?.title ?? '').trim();
  const meta = String(seo?.meta_description ?? '').trim();
  if (!title) err(file, 'seo.title empty (§28)');
  else if (title.length > SEO_LIMITS.title) err(file, `seo.title is ${title.length} characters — limit ${SEO_LIMITS.title} (§28)`);
  if (!meta) err(file, 'seo.meta_description empty (§28)');
  else if (meta.length > SEO_LIMITS.meta) err(file, `seo.meta_description is ${meta.length} characters — limit ${SEO_LIMITS.meta} (§28)`);
  if (title) seoTitles.set(title, [...(seoTitles.get(title) ?? []), file]);
  if (meta) seoMetas.set(meta, [...(seoMetas.get(meta) ?? []), file]);
  return { title, meta };
}

/** keyword + city must appear in each of the given [label, text] pairs (§28). */
function requireKeywordAndCity(file, keyword, city, pairs) {
  for (const [label, text] of pairs) {
    if (!containsPhrase(text, keyword)) err(file, `${label} must contain the primary keyword "${keyword}" (§28): "${text ?? ''}"`);
    if (city && !containsPhrase(text, city)) err(file, `${label} must contain the city "${city}" (§28): "${text ?? ''}"`);
  }
}

/** Walk every string in an object tree; call fn(path, string). */
function walkStrings(node, fn, path = '') {
  if (typeof node === 'string') fn(path, node);
  else if (Array.isArray(node)) node.forEach((v, i) => walkStrings(v, fn, `${path}[${i}]`));
  else if (node && typeof node === 'object')
    for (const [k, v] of Object.entries(node)) walkStrings(v, fn, path ? `${path}.${k}` : k);
}

function scanLanguage(file, doc) {
  walkStrings(doc, (path, s) => {
    const lower = s.toLowerCase();
    for (const phrase of BANNED)
      if (lower.includes(phrase)) err(file, `§7 banned phrase "${phrase}" at ${path}`);
    for (const word of SOFT)
      if (new RegExp(`\\b${word}\\b`, 'i').test(s)) warn(file, `§7 soft-flag word "${word}" at ${path} — reviewer judgment needed`);
    // §7 US English (owner decision 2026-11-02): approved copy never carries British spellings.
    const ukHits = findUkSpellings(s, US_EXCEPTIONS);
    if (ukHits.length) err(file, `${usEnglishMessage(ukHits)} (at ${path})`);
  });
}

// ------------------------------------------------------- messaging pack

function validateMessagingPack(file, doc) {
  const req = (path, v) => { if (isBlank(v)) err(file, `required field empty: ${path}`); };

  req('meta.client', doc.meta?.client);
  req('meta.primary_service_page_target_area', doc.meta?.primary_service_page_target_area);
  req('hero.h1', doc.hero?.h1);
  req('hero.subhead', doc.hero?.subhead);
  req('hero.primary_cta_label', doc.hero?.primary_cta_label);
  req('hero.secondary_cta_label', doc.hero?.secondary_cta_label);
  req('form.emergency_notice', doc.form?.emergency_notice);

  const lines = doc.hero?.h1_line_groups ?? [];
  if (!Array.isArray(lines) || lines.length < 2)
    err(file, `hero.h1_line_groups needs >= 2 explicit lines (§24 line control), found ${lines.length ?? 0}`);

  const bullets = doc.hero?.trust_bullets ?? [];
  if (bullets.length < 4 || bullets.length > 6)
    err(file, `hero.trust_bullets must have 4-6 entries, found ${bullets.length}`);
  bullets.forEach((b, i) => {
    if (isBlank(b?.text)) err(file, `trust_bullets[${i}].text empty`);
    if (!CLAIM_STATES.includes(b?.claim_state))
      err(file, `trust_bullets[${i}].claim_state "${b?.claim_state}" not a valid §6 state`);
  });

  for (const h of ['intro_heading', 'services_heading', 'process_heading',
    'differentiator_heading', 'review_heading', 'service_area_heading',
    'faq_heading', 'final_cta_heading', 'footer_summary'])
    req(`sections.${h}`, doc.sections?.[h]);

  // THE SEAM FIX: the first content heading is a local-SEO H2 and must carry
  // the primary target area (rule previously lived only in the copywriter
  // skill, scoped to "local SEO pages", and never reached this artifact).
  const target = doc.meta?.primary_service_page_target_area;
  const intro = doc.sections?.intro_heading;
  if (!isBlank(target) && !isBlank(intro) &&
      !intro.toLowerCase().includes(String(target).toLowerCase()))
    err(file, `sections.intro_heading must contain the primary target area "${target}" (homepage local-H2 rule)`);

  if (!isBlank(doc.hero?.h1) && !isBlank(intro) &&
      doc.hero.h1.trim().toLowerCase() === intro.trim().toLowerCase())
    err(file, 'sections.intro_heading duplicates the H1 — first H2 must differ from H1');

  // §28: the homepage title is "#1 Restoration Company in {City}, {ST} | {Brand}" (brand dropped when
  // it does not fit); the meta description carries the target area.
  const { title, meta } = checkSeoBlock(file, doc.seo);
  if (!isBlank(target)) {
    const city = String(target).replace(/,\s*[A-Z]{2}$/, '');
    const loc = locationLabel(city, doc.meta?.primary_service_page_target_state);
    if (!STATE_ABBR.test(String(doc.meta?.primary_service_page_target_state ?? '')))
      err(file, 'meta.primary_service_page_target_state must be the two-letter state, e.g. "TN" (§28)');
    const allowed = allowedTitles('homepage', { location: loc, brand: doc.meta?.client });
    if (title && allowed?.length && !allowed.includes(title))
      err(file, `seo.title "${title}" does not follow the homepage title rule — use "${allowed[0]}" (§28)`);
    if (meta && !containsPhrase(meta, city)) err(file, `seo.meta_description must contain the primary target area "${city}" (§28)`);
  }

  (doc.claims_register ?? []).forEach((c, i) => {
    if (!CLAIM_STATES.includes(c?.claim_state))
      err(file, `claims_register[${i}].claim_state "${c?.claim_state}" not a valid §6 state`);
  });

  if (doc.banned_confirmed !== true)
    err(file, 'banned_confirmed must be true — producer must confirm the §7 scan');

  scanLanguage(file, { hero: doc.hero, proof_band: doc.proof_band, sections: doc.sections, form: doc.form });
}

// -------------------------------------------------------- design recipe

function validateRecipe(file, doc, recipePath = join(dir, 'design-recipe.yaml')) {
  if (isBlank(doc.meta?.messaging_pack_ref))
    err(file, 'meta.messaging_pack_ref empty — recipe is invalid without an approved pack');

  for (const [slot, value] of Object.entries(doc.variants ?? {})) {
    const built = BUILT_VARIANTS[slot];
    if (!built) { warn(file, `unknown variant slot "${slot}"`); continue; }
    if (!built.includes(value))
      err(file, `variants.${slot}: "${value}" is not a BUILT variant (built: ${built.join(', ')})`);
  }

  const pbp = doc.variant_options?.post_body_sections?.process;
  if (pbp !== undefined && !['auto', 'always', 'never'].includes(pbp))
    err(file, `variant_options.post_body_sections.process must be auto|always|never, found "${pbp}"`);

  const count = doc.variant_options?.process_step_count;
  if (count !== undefined) {
    if (!Number.isInteger(count) || count < 3 || count > 5)
      err(file, `variant_options.process_step_count must be an integer 3-5, found ${count}`);
    else if (count !== 3) {
      const justified = (doc.exceptions ?? []).some((e) =>
        JSON.stringify(e).toLowerCase().includes('step'));
      if (!justified)
        err(file, `process_step_count=${count} deviates from the default (3) with no recorded justification in exceptions[] — deviations are allowed but must be deliberate`);
    }
  }

  const tokens = doc.brand?.tokens ?? {};
  for (const t of ['primary', 'accent', 'dark', 'surface'])
    if (isBlank(tokens[t])) err(file, `brand.tokens.${t} empty`);
  if (!['brand_guidelines', 'logo_derived_needs_approval'].includes(doc.brand?.token_source))
    err(file, `brand.token_source "${doc.brand?.token_source}" invalid`);
  if (!['self_hosted_woff2', 'system_fonts'].includes(doc.brand?.typography?.hosting_plan))
    err(file, `brand.typography.hosting_plan "${doc.brand?.typography?.hosting_plan}" invalid (§20)`);

  (doc.pages ?? []).forEach((p, i) => {
    if (isBlank(p?.url)) err(file, `pages[${i}].url empty`);
    if (!Array.isArray(p?.schema_plan) && isBlank(p?.schema_plan)) err(file, `pages[${i}].schema_plan missing (§22)`);
    if (isBlank(p?.navigation_inclusion)) err(file, `pages[${i}].navigation_inclusion missing (§23)`);
  });

  if (doc.meta?.status === 'Approved' &&
      !['Pass', 'Fail Accepted By Human'].includes(doc.meta?.rubric_result))
    err(file, `Approved recipe requires rubric_result Pass or Fail Accepted By Human, found "${doc.meta?.rubric_result}"`);
  // Gate 4 is VISUAL approval (owner decision 2026-09-11, after a build assembled 617 pages before the
  // human had seen a single screenshot). An Approved recipe must sit next to the packet the human saw.
  if (doc.meta?.status === 'Approved') {
    const gate4 = join(dirname(recipePath), 'design', 'gate4');
    for (const shot of ['mobile-initial.png', 'mobile-scrolled.png', 'desktop.png', 'tablet.png'])
      if (!existsSync(join(gate4, shot)))
        err(file, `Approved recipe but design/gate4/${shot} is missing — Gate 4 is approved from the §24 screenshots of the THEMED previews, never from a document`);
  }
}

// ------------------------------------------------------------- page map

function validatePageMap(file, doc) {
  if (isBlank(doc.meta?.client)) err(file, 'meta.client empty');
  if (isBlank(doc.meta?.primary_service_page_target_area))
    err(file, 'meta.primary_service_page_target_area empty — root service pages cannot be localized without it');
  if (!STATE_ABBR.test(String(doc.meta?.primary_service_page_target_state ?? '')))
    err(file, 'meta.primary_service_page_target_state must be the two-letter state of the target area, e.g. "TN" — titles and headings use "{City}, {ST}" (§28)');

  const pages = doc.pages ?? [];
  const urls = new Set(); const ids = new Set();
  const cityHubs = new Set(
    pages.filter((p) => p.page_type === 'city_hub').map((p) => String(p.city ?? '').toLowerCase()));

  pages.forEach((p, i) => {
    const at = `pages[${i}] (${p?.url ?? p?.page_id ?? '?'})`;
    if (isBlank(p?.page_id)) err(file, `${at}: page_id empty — stable IDs are required`);
    else if (ids.has(p.page_id)) err(file, `${at}: duplicate page_id`);
    else ids.add(p.page_id);

    if (isBlank(p?.url)) err(file, `${at}: url empty`);
    else {
      if (urls.has(p.url)) err(file, `${at}: duplicate url`);
      urls.add(p.url);
      if (!p.url.startsWith('/') || !p.url.endsWith('/'))
        err(file, `${at}: urls must start and end with "/"`);
      if (p.url.startsWith('/services/'))
        err(file, `${at}: /services/... prefix is forbidden for generated restoration pages (build spec)`);
    }

    if (p?.page_type === 'city_service' && !cityHubs.has(String(p.city ?? '').toLowerCase()))
      err(file, `${at}: city_service page has no approved city_hub for "${p.city}" in this map`);

    // §28: every SEO page carries its keyword (the master Page Map's Primary Keyword, WITHOUT the
    // location) so titles are built from it and every heading can be checked against it.
    if (KEYWORD_PAGE_TYPES.includes(p?.page_type) && isBlank(p?.primary_keyword))
      err(file, `${at}: primary_keyword empty — copy it from the master Page Map's "Primary Keyword" (location removed) (§28)`);
    // §28 title exception: copied from the master Page Map's "Title Service Phrase" column, never invented.
    if (!isBlank(p?.title_service_phrase)) {
      if (!LOCAL_PAGE_TYPES.includes(p?.page_type))
        err(file, `${at}: title_service_phrase is only for parent_hub/service/city_hub/city_service pages (§28)`);
      const problem = servicePhraseProblem(p?.primary_keyword, p.title_service_phrase);
      if (problem) err(file, `${at}: ${problem} (§28)`);
    }
    if (['city_hub', 'city_service'].includes(p?.page_type) && !STATE_ABBR.test(String(p?.state ?? '')))
      err(file, `${at}: state must be the city's two-letter state, e.g. "MS" (§28 — "{City}, {ST}" in titles and headings)`);

    if (p?.brief?.required === true && isBlank(p?.brief?.brief_status))
      err(file, `${at}: brief.required is true but brief_status is unset`);
    if (p?.brief?.brief_status === 'Assigned') {
      // A brief is a Google Doc that was OPENED — never a sheet row, a status column, or a local export.
      if (!DOC_URL.test(String(p?.brief?.brief_ref ?? '')))
        err(file, `${at}: brief_status Assigned but brief_ref is not a Google Doc URL (REFERENCES.md — the Content Briefs tab links the Doc; local files and sheet rows are not briefs)`);
      if (isBlank(p?.brief?.brief_title))
        err(file, `${at}: brief_status Assigned but brief_title empty — read the Doc's metadata and record its title (proof it was opened, not inferred)`);
    }

    if (isBlank(p?.navigation_inclusion) ||
        (Array.isArray(p?.navigation_inclusion) && p.navigation_inclusion.length === 0))
      err(file, `${at}: navigation_inclusion missing (§23 — no accidental orphans)`);

    if (p?.status === 'Ready To Build' && (p?.blockers ?? []).length > 0)
      err(file, `${at}: status Ready To Build with open blockers`);
  });

  (doc.excluded_pages ?? []).forEach((p, i) => {
    if (isBlank(p?.reason)) err(file, `excluded_pages[${i}]: reason empty — exclusions feed the client review packet`);
  });
}

// ------------------------------------------------- final page copy (sprint)

// Copy Sprint output: one final-page-copy artifact per page in <dir>/copy/.
// Validated so the sprint's parallel writers get mechanical verification —
// the lead never takes an agent's word for claim safety or completeness.
function validatePageCopy(file, doc, pageMap) {
  if (isBlank(doc.meta?.page_id)) err(file, 'meta.page_id empty — must match the active page map');
  if (isBlank(doc.meta?.page_url)) err(file, 'meta.page_url empty');
  if (isBlank(doc.meta?.brief_used)) err(file, 'meta.brief_used empty — copy without a brief source is unreviewable');
  else if (doc.meta.brief_used !== 'structured-requirements' && !DOC_URL.test(String(doc.meta.brief_used)))
    err(file, `meta.brief_used "${doc.meta.brief_used}" is not a Google Doc URL or "structured-requirements" — copy must be written from the brief Doc, never a local export`);
  if (pageMap) {
    const page = (pageMap.pages ?? []).find((p) => p.page_id === doc.meta?.page_id || p.url === doc.meta?.page_url);
    if (!page) err(file, `page ${doc.meta?.page_id ?? doc.meta?.page_url} is not in the active page map — copy for an unapproved page`);
    else if (page.brief?.brief_status === 'Assigned' && doc.meta?.brief_used !== page.brief?.brief_ref)
      err(file, `meta.brief_used does not match the page map's brief_ref for ${page.url} — the copy was written from something other than the assigned brief`);
  }
  if (!['Draft', 'Ready For Review', 'Approved'].includes(doc.meta?.status))
    err(file, `meta.status "${doc.meta?.status}" invalid`);
  if (isBlank(doc.copy?.h1) && isBlank(doc.copy?.body)) err(file, 'copy.h1 and copy.body both empty');

  // §28 page SEO. Every page type has a title rule in src/utils/seo.mjs (PAGE_TITLE_RULES); the copy
  // artifact records the rule's output for review and must equal one of the patterns it allows.
  const { title, meta } = checkSeoBlock(file, doc.seo);
  const mapped = pageMap && (pageMap.pages ?? []).find((p) => p.page_id === doc.meta?.page_id || p.url === doc.meta?.page_url);
  const pageType = mapped?.page_type ?? doc.meta?.page_type;
  const kw = mapped?.primary_keyword;
  const city = String(mapped?.city || pageMap?.meta?.primary_service_page_target_area || '').replace(/,\s*[A-Z]{2}$/, '').trim();
  const loc = locationLabel(city, mapped?.state || pageMap?.meta?.primary_service_page_target_state);
  const ctx = { keyword: kw, location: loc, brand: pageMap?.meta?.client, servicePhrase: mapped?.title_service_phrase, headline: doc.copy?.h1, label: doc.copy?.h1 };
  // Without a page map there is no brand or location to build from; lengths are still checked above.
  const allowed = pageMap ? allowedTitles(pageType, ctx) : undefined;
  if (allowed === null) {
    // A page type with no approved rule yet: never guess silently — propose one for the owner.
    const s = suggestTitleRule(pageType, ctx);
    err(file, `page_type "${pageType}" has no title rule yet (§28). Suggested: "${s.pattern}"${s.example ? ` (e.g. "${s.example}")` : ''} — ${s.reason}. Once approved, add it to PAGE_TITLE_RULES in src/utils/seo.mjs`);
  } else if (allowed && allowed.length === 0) {
    // No pattern fits in 60 characters: the one case where a person writes the title (§28).
    if (isBlank(doc.seo?.title_exception))
      err(file, `no allowed "${pageType}" title fits ${SEO_LIMITS.title} characters here — a person writes seo.title and records why in seo.title_exception (§28)`);
  } else if (allowed && title && !allowed.includes(title)) {
    err(file, `seo.title "${title}" does not follow the ${pageType} title rule — use "${allowed[0]}" (§28; built by src/utils/seo.mjs, never hand-written)`);
  }
  if (KEYWORD_PAGE_TYPES.includes(pageType) && kw) {
    const firstH2 = (doc.copy?.body ?? []).find((b) => b?.level === 'h2' || b?.h2 !== undefined) ?? {};
    const local = LOCAL_PAGE_TYPES.includes(pageType) ? city : '';
    requireKeywordAndCity(file, kw, local, [
      ['seo.title', title],
      ['seo.meta_description', meta],
      ['copy.h1', doc.copy?.h1],
      ['first H2', firstH2.h2 ?? firstH2.heading],
    ]);
  }
  // City pages RENDER FROM DATA (cities.ts + cityServiceContent.ts with {city}/{county} tokens) —
  // writing 600 individual city artifacts is the thin-content-at-scale failure the generators
  // exist to prevent (PIPELINE → Copy Sprint Rule; C&B build 2026-09-10 planned 88 agents × 7 pages).
  if (['city_hub', 'city_service'].includes(String(doc.meta?.page_type)))
    err(file, `page_type ${doc.meta.page_type}: city pages are generated from per-city data, not per-page copy artifacts — write the service content ONCE with {city}/{county} tokens into cityServiceContent, and the factual per-city dataset into cities.ts`);
  scanLanguage(file, doc.copy ?? {});
  (doc.claims_used ?? []).forEach((c, i) => {
    if (isBlank(c?.state)) err(file, `claims_used[${i}] missing claim state (§6)`);
  });
}

// ---------------------------------------------------------------- redirect map

// Stage 2 output (schemas/redirect-map.yaml). Rebuilds only. Every old URL that mattered gets
// a decision; internal destinations must exist in the page map so no redirect lands on a 404.
function validateRedirectMap(file, doc, pageMapUrls) {
  if (isBlank(doc.meta?.client)) err(file, 'meta.client empty');
  if (isBlank(doc.meta?.source_site)) err(file, 'meta.source_site empty — the old domain being redirected');
  if (!['Draft', 'Ready For Review', 'Approved'].includes(doc.meta?.status))
    err(file, `meta.status "${doc.meta?.status}" invalid`);
  const froms = new Set();
  const rows = doc.redirects ?? [];
  rows.forEach((r, i) => {
    const at = `redirects[${i}] (${r?.from ?? '?'})`;
    if (isBlank(r?.from) || !String(r.from).startsWith('/')) err(file, `${at}: from must be an old-site path starting with "/"`);
    else if (froms.has(r.from)) err(file, `${at}: duplicate from`);
    else froms.add(r.from);
    if (![301, 410].includes(r?.status)) err(file, `${at}: status must be 301 or 410, found ${r?.status}`);
    if (r?.status === 301) {
      if (isBlank(r?.to)) err(file, `${at}: 301 needs a destination`);
      else if (String(r.to).startsWith('/')) {
        if (pageMapUrls && !pageMapUrls.has(r.to)) err(file, `${at}: destination ${r.to} is not in the active page map — a redirect must never land on a 404`);
      } else if (!/^https?:\/\//.test(r.to)) err(file, `${at}: destination must be a site path or absolute URL`);
    }
    if (isBlank(r?.reason)) err(file, `${at}: reason empty — record why this mapping (rankings, backlinks, equivalent page)`);
  });
  rows.forEach((r, i) => {
    if (r?.status === 301 && froms.has(r.to)) err(file, `redirects[${i}]: ${r.from} → ${r.to} chains into another redirect — point at the final destination`);
  });
  (doc.unmapped_old_urls ?? []).forEach((u, i) => {
    if (isBlank(u?.url) || isBlank(u?.reason)) err(file, `unmapped_old_urls[${i}] needs url + reason (deliberate 404s are decisions, not omissions)`);
  });
}

// ---------------------------------------------------------------- runner

const VALIDATORS = {
  'messaging-pack.yaml': validateMessagingPack,
  'design-recipe.yaml': validateRecipe,
  'active-page-map.yaml': validatePageMap,
};

let dir = process.argv[2] ? resolve(process.argv[2]) : join(ROOT, 'artifacts');
const hasReal = existsSync(dir) &&
  readdirSync(dir).some((f) => Object.keys(VALIDATORS).includes(f));
if (!process.argv[2] && !hasReal) dir = join(ROOT, 'artifacts', 'examples');

let ran = 0;
for (const [name, fn] of Object.entries(VALIDATORS)) {
  const p = join(dir, name);
  if (!existsSync(p)) continue;
  ran++;
  try { fn(name, parse(readFileSync(p, 'utf8'))); }
  catch (e) { err(name, `failed to parse: ${e.message}`); }
}

const rm = join(dir, 'redirect-map.yaml');
if (existsSync(rm)) {
  ran++;
  let pageMapUrls = null;
  const pm = join(dir, 'active-page-map.yaml');
  if (existsSync(pm)) { try { pageMapUrls = new Set((parse(readFileSync(pm, 'utf8')).pages ?? []).map((p) => p.url)); } catch { /* reported above */ } }
  try { validateRedirectMap('redirect-map.yaml', parse(readFileSync(rm, 'utf8')), pageMapUrls); }
  catch (e) { err('redirect-map.yaml', `failed to parse: ${e.message}`); }
}

const copyDir = join(dir, 'copy');
if (existsSync(copyDir)) {
  let pageMapDoc = null;
  const pmPath = join(dir, 'active-page-map.yaml');
  if (existsSync(pmPath)) { try { pageMapDoc = parse(readFileSync(pmPath, 'utf8')); } catch { /* reported above */ } }
  for (const f of readdirSync(copyDir).filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'))) {
    ran++;
    try { validatePageCopy(`copy/${f}`, parse(readFileSync(join(copyDir, f), 'utf8')), pageMapDoc); }
    catch (e) { err(`copy/${f}`, `failed to parse: ${e.message}`); }
  }
}

// §28: no two pages share a title or a meta description (the homepage pack included)
for (const [kind, seen] of [['seo.title', seoTitles], ['seo.meta_description', seoMetas]])
  for (const [text, files] of seen)
    if (files.length > 1) err(files.join(', '), `duplicate ${kind} "${text.slice(0, 80)}" — every page needs its own (§28)`);

if (ran === 0) {
  console.error(`validate-artifacts: no artifacts found in ${dir}`);
  process.exit(1);
}
console.log(`validate-artifacts: ${ran} artifact(s) checked in ${dir}`);
warnings.forEach((w) => console.warn(`  WARN  ${w}`));
errors.forEach((e) => console.error(`  ERROR ${e}`));
console.log(`  ${errors.length} error(s), ${warnings.length} warning(s)`);
process.exit(errors.length ? 1 : 0);
