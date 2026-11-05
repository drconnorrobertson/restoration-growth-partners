/**
 * The three standard agency forms (CORE_CONTRACTS §11, §27): Request Service, Careers application, Partner enquiry.
 *
 * Unit: scripts/lib/form-checks.mjs (shared with validate:built) fails a form that asks for sensitive personal data
 *   (licence/permit number, SSN, date of birth, bank/card details — by field name or label), a lead form without the
 *   router contract fields, a form_type that is not one of the three, a data-form-type that disagrees with it, and file
 *   uploads anywhere but a careers form's résumé / cover letter in a multipart post. "Do you have a valid driver's
 *   license?" passes.
 * Build (tests/forms/astro-test.config.mjs: test Turnstile key, client id, Careers connected / Partner not):
 *   · Careers (/templates/careers/) posts to the router: client_id, form_type=career_application, multipart, résumé +
 *     optional cover letter with the router's file types, the Yes/No questions with hidden "how many?" follow-ups,
 *     Turnstile widget + status live region inside the form, WebMCP tool, its own status region with phone-first error;
 *   · Partner (/templates/partners/) is NOT connected: visible notice, no action, submit disabled — never posting to a
 *     router that would refuse it;
 *   · the starter ships both forms OFF: no real page renders either;
 *   · validate:built passes, and fails once a licence-number field or a wrong form_type is put into the built page;
 *     validate:launch names a disabled Careers/Partner form on a real page.
 * Browser behaviour (held submit, "Verifying…", file attach, follow-ups) is verified by hand on a local preview — see
 * the PR that added this file. Run: npm run test:forms (builds into tests/forms/.tmp-standard/).
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { checkLeadForms, isSensitiveField } from '../../scripts/lib/form-checks.mjs';
import { ROOT, buildFormsSite } from './build.mjs';

const TMP = join(ROOT, 'tests/forms/.tmp-standard');
const TEST_SITE_KEY = '1x00000000000000000000AA'; // = astro-test.config.mjs (Cloudflare's always-pass test key)
let DIST;
const env = { ...process.env, BLOG_POSTS_DIR: join(ROOT, 'tests/blog/fixtures/posts'), BLOG_QA_DIR: join(ROOT, 'tests/blog/fixtures/qa') };
const validate = (dir, ...args) => spawnSync('node', ['scripts/validate-built-html.mjs', dir, ...args], { cwd: ROOT, env, encoding: 'utf8' });
function* walk(dir) { for (const e of readdirSync(dir)) { const p = join(dir, e); if (statSync(p).isDirectory()) yield* walk(p); else yield p; } }
const page = (route) => readFileSync(join(DIST, route, 'index.html'), 'utf8');
const formOf = (html, type) => html.match(new RegExp(`<form\\b[^>]*data-form-type="${type}"[^>]*>[\\s\\S]*?</form>`))?.[0];

// --- unit -----------------------------------------------------------------------------------------
const HIDDEN = ['client_id', 'site_id', 'form_location', 'page_url', 'idempotency_key'].map((n) => `<input type="hidden" name="${n}" value="x">`).join('');
const HONEYPOT = '<div aria-hidden="true"><label>Company website<input type="text" name="company_website"></label></div>';
const careers = (extra = '', attrs = 'method="post" enctype="multipart/form-data"', type = 'career_application') =>
  `<form ${attrs} data-lead-form data-form-type="career_application" toolname="apply_for_job">${HIDDEN}<input type="hidden" name="form_type" value="${type}">${HONEYPOT}` +
  `<fieldset><legend>Do you have a valid driver's license? *</legend><label><input type="radio" name="q_drivers_license" value="Yes"> Yes</label></fieldset>` +
  `<label for="r">Résumé *</label><input id="r" type="file" name="resume">${extra}</form>`;

test('check: a complete careers form with a Yes/No licence question passes', () => {
  assert.deepEqual(checkLeadForms(careers()), []);
  assert.equal(isSensitiveField("Do you have a valid driver's license?"), false);
});

test('check: sensitive personal data fails — by field name, id, placeholder, or label/legend text', () => {
  for (const [extra, what] of [
    ['<input type="text" name="q_drivers_license_number">', /name="q_drivers_license_number"/],
    ['<label for="dl">Driver&#39;s License Number*</label><input id="dl" name="q_x">', /label "Driver's License Number\*"/],
    ['<input name="ssn">', /name="ssn"/],
    ['<label for="s">Social Security Number</label><input id="s" name="q_y">', /Social Security/],
    ['<input name="q_z" placeholder="Date of birth">', /placeholder="Date of birth"/],
    ['<input name="q_dob">', /name="q_dob"/],
    ['<fieldset><legend>Bank account for direct deposit</legend><input name="q_w"></fieldset>', /Bank account/],
    ['<input name="routing_number">', /routing_number/],
    ['<input name="q_card" aria-label="Credit card number">', /Credit card/],
  ]) {
    const errors = checkLeadForms(careers(extra));
    assert.ok(errors.some((e) => what.test(e) && /sensitive personal data/.test(e)), `${extra}\n→ ${errors.join('\n')}`);
  }
  // Any form, not only lead forms.
  assert.equal(checkLeadForms('<form><label for="a">SSN</label><input id="a" name="a"></form>').length, 1);
});

test('check: a wrong or mismatched form_type, missing router fields, or a bad upload fails', () => {
  assert.match(checkLeadForms(careers('', undefined, 'job_application')).join('\n'), /form_type="job_application" — use one of the three standard forms/);
  assert.match(checkLeadForms(careers('', undefined, 'request_service')).join('\n'), /data-form-type="career_application" but sends form_type="request_service"/);
  assert.match(checkLeadForms(careers('', 'method="post"')).join('\n'), /not method="post" enctype="multipart\/form-data"/);
  assert.match(checkLeadForms(careers('<input type="file" name="photo">')).join('\n'), /file input name="photo"/);
  const partnerWithFile = `<form method="post" enctype="multipart/form-data" data-lead-form data-form-type="partner_enquiry">${HIDDEN}<input type="hidden" name="form_type" value="partner_enquiry">${HONEYPOT}<input type="file" name="resume"></form>`;
  assert.match(checkLeadForms(partnerWithFile).join('\n'), /accepts files only as a careers form's/);
  const bare = '<form data-lead-form data-form-type="partner_enquiry"><input type="hidden" name="form_type" value="partner_enquiry"></form>';
  const errors = checkLeadForms(bare).join('\n');
  for (const n of ['client_id', 'site_id', 'form_location', 'page_url', 'idempotency_key']) assert.match(errors, new RegExp(`no "${n}" field`));
  assert.match(errors, /no company_website honeypot/);
});

// --- build ----------------------------------------------------------------------------------------
before(() => { DIST = buildFormsSite(TMP); });

test('build: the Careers form posts to the router as a multipart career_application with résumé, cover letter and Yes/No questions', () => {
  const html = page('templates/careers');
  const form = formOf(html, 'career_application');
  assert.ok(form, 'careers form rendered');
  assert.match(form, /^<form\b[^>]*\bmethod="post"[^>]*\benctype="multipart\/form-data"[^>]*\baction="https:\/\/rgp-lead-router\.login-cce\.workers\.dev\/submit"/);
  assert.match(form, /name="client_id" value="forms-test"/);
  assert.match(form, /name="form_type" value="career_application"/);
  assert.match(form, /name="form_location" value="careers"/);
  for (const n of ['site_id', 'page_url', 'idempotency_key', 'company_website', 'name', 'phone', 'email', 'position', 'street_address', 'city', 'state', 'postal_code', 'experience', 'message'])
    assert.match(form, new RegExp(`name="${n}"`), n);
  assert.match(form, /<input id="careers-resume" name="resume" type="file" required accept="\.pdf,\.doc,\.docx,application\/pdf,application\/msword,application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document"/);
  assert.match(form, /<input id="careers-cover" name="cover_letter" type="file" accept=/);
  assert.doesNotMatch(form, /name="cover_letter"[^>]*required/, 'cover letter is optional');
  assert.match(form, /<input type="radio" name="q_drivers_license" value="Yes" required/);
  assert.match(form, /<input type="radio" name="q_drivers_license" value="No" required/);
  assert.match(form, /data-follow-up="q_accidents_past_3_years" hidden[\s\S]*?name="q_accidents_past_3_years_count" type="number"/);
  assert.match(form, new RegExp(`class="cf-turnstile[^"]*" data-sitekey="${TEST_SITE_KEY}"`));
  assert.match(form, /data-turnstile-status role="status" aria-live="polite"/);
  assert.match(form, /toolname="apply_for_job"/);
  assert.doesNotMatch(form, /<button type="submit" disabled/);
  assert.deepEqual(checkLeadForms(html), []);
  // Its own result region: shows only for form_location=careers, error copy is phone-first.
  assert.match(html, /data-form-status="career_application" data-form-location="careers" hidden role="status" data-success-text="[^"]+" data-error-text="Something went wrong sending your application\. Please try again, or call \(555\) 000-1234\."/);
  assert.doesNotMatch(html, /Careers form not connected yet/);
});

test('build: the Partner form is NOT connected in this build — notice shown, no action, submit disabled', () => {
  const html = page('templates/partners');
  const form = formOf(html, 'partner_enquiry');
  assert.ok(form, 'partner form rendered');
  assert.match(html, /Partner form not connected yet/);
  assert.doesNotMatch(form.match(/^<form\b[^>]*>/)[0], /\baction=/);
  assert.match(form, /<button type="submit" disabled/);
  assert.match(form, /name="form_type" value="partner_enquiry"/);
  assert.match(form, /name="company_name" type="text" required/);
  assert.match(form, /<textarea id="partner-message" name="message" rows="4" required/);
  assert.match(form, /name="partner_type"/);
  assert.match(form, /name="preferred_contact_time" value="Morning"/);
  assert.doesNotMatch(form, /type="file"/);
  assert.deepEqual(checkLeadForms(html), []);
});

test('build: the starter ships both forms OFF — no real page renders either', () => {
  for (const f of walk(DIST)) {
    const rel = relative(DIST, f);
    if (!rel.endsWith('.html') || rel.startsWith('templates/')) continue;
    const html = readFileSync(f, 'utf8');
    assert.doesNotMatch(html, /data-form-type="(career_application|partner_enquiry)"/, rel);
  }
});

test('build: one shared lead-form module (status scoping, follow-ups, file checks) runs on every form page', () => {
  // Each component's <script> is a tiny entry that imports the same lead-forms chunk; ES modules run it once per page.
  const modulesOf = (html) => {
    const entries = [...html.matchAll(/<script\b[^>]*\bsrc="(\/_astro\/[^"]+)"/g)].map((m) => m[1]);
    const imported = entries.flatMap((e) => [...readFileSync(join(DIST, e), 'utf8').matchAll(/import\s*"\.\/([^"]+)"/g)].map((m) => `/_astro/${m[1]}`));
    return new Set([...entries, ...imported]);
  };
  const careers = modulesOf(page('templates/careers'));
  const wiring = [...careers].find((f) => { const js = readFileSync(join(DIST, f), 'utf8'); return js.includes('form_status') && js.includes('data-follow-up') && js.includes('setCustomValidity'); });
  assert.ok(wiring, `lead-forms module loaded by the careers page (${[...careers].join(', ')})`);
  assert.ok(modulesOf(page('templates/partners')).has(wiring), 'the partner page loads the same module');
  assert.ok(modulesOf(page('templates/contact-page')).has(wiring), 'the request form pages load the same module');
});

test('build: validate:built passes, and fails on a licence-number field or a mismatched form_type', () => {
  const ok = validate(DIST);
  assert.equal(ok.status, 0, `validate:built should pass:\n${ok.stdout}\n${ok.stderr}`);
  const file = join(DIST, 'templates/careers/index.html');
  const html = readFileSync(file, 'utf8');
  try {
    writeFileSync(file, html.replace('<label for="careers-message"', '<label for="dl">Driver&#39;s License Number *</label><input id="dl" name="dl_number" type="text" toolparamdescription="x"><label for="careers-message"'));
    const bad = validate(DIST);
    assert.notEqual(bad.status, 0);
    assert.match(bad.stderr, /asks for sensitive personal data/);
    writeFileSync(file, html.replace('name="form_type" value="career_application"', 'name="form_type" value="request_service"'));
    const wrong = validate(DIST);
    assert.notEqual(wrong.status, 0);
    assert.match(wrong.stderr, /data-form-type="career_application" but sends form_type="request_service"/);
  } finally {
    writeFileSync(file, html);
  }
});

test('build: validate:launch names a disabled Careers/Partner form on a real page (template previews are exempt)', () => {
  const copy = join(TMP, 'launch');
  cpSync(DIST, join(copy, 'dist'), { recursive: true });
  cpSync(join(ROOT, 'hosting.json'), join(copy, 'hosting.json'));
  const run = (dir) => spawnSync('node', ['scripts/validate-built-html.mjs', dir, '--launch'], { cwd: ROOT, env, encoding: 'utf8' }).stderr;
  assert.doesNotMatch(run(join(copy, 'dist')), /Careers\/Partner form is DISABLED/, 'template previews never trip it');
  writeFileSync(join(copy, 'dist/404.html'), readFileSync(join(copy, 'dist/404.html'), 'utf8').replace('</main>', `${formOf(page('templates/partners'), 'partner_enquiry')}</main>`));
  assert.match(run(join(copy, 'dist')), /a Careers\/Partner form is DISABLED — the router has no GHL workflow for it yet[^\n]*404\.html \(partner_enquiry\)/);
});
