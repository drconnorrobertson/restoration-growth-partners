/**
 * Agency web form rules (CORE_CONTRACTS §11 "three standard forms", §27 lead routing). Pure functions over one
 * page's HTML, shared by validate:built, the forms tests and the form components (CareersForm imports
 * isSensitiveField to refuse a sensitive question at build time).
 *
 * Every page, templates included — a page fails when
 *   · ANY form asks for sensitive personal data: a field whose name, id, placeholder or aria-label, or a label /
 *     legend in the form, reads like a driver's licence or permit NUMBER, SSN / tax id, date of birth, bank, card or
 *     account number, passport, password. "Do you have a valid driver's license?" (Yes/No) is fine; the number is not.
 *     Keep SENSITIVE_PATTERNS in sync with rgp-lead-router src/lib.ts isSensitiveField (the router drops such fields).
 *   · a lead form (data-lead-form) is missing a router contract field (client_id, site_id, form_type, form_location,
 *     page_url, idempotency_key, the company_website honeypot), has a form_type that is not one of the three standard
 *     forms, or a data-form-type that disagrees with its form_type (the router routes by form_type: a careers form
 *     posting request_service would ring the client's office);
 *   · a form uploads files without method="post" enctype="multipart/form-data", or a file input appears anywhere but a
 *     career_application form's `resume` / `cover_letter` (the only files the router accepts).
 */
export const FORM_TYPES = ['request_service', 'career_application', 'partner_enquiry'];

const SENSITIVE_PATTERNS = [
  /(?:^|[^a-z])(ssn|sin|dob|itin|ein|cvv|cvc)(?:$|[^a-z])/,
  /social.?security/, /tax.?id/, /(licen[cs]e|dl|permit).?(no|num|number|#)(?:$|[^a-z])/, /date.?of.?birth|birth.?date|birthday/,
  /bank|routing|iban|swift/, /account.?(no|num|number)/, /credit.?card|debit.?card|card.?(no|num|number)/, /passport/, /password/,
];
/** True when a field name or label text reads like sensitive personal data agency forms never collect. */
export function isSensitiveField(text) {
  const n = String(text ?? '').toLowerCase().replace(/[’']/g, '');
  return SENSITIVE_PATTERNS.some((r) => r.test(n));
}

const attrsOf = (s) => {
  const a = {};
  for (const m of s.matchAll(/([^\s=/"'>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) a[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? '';
  return a;
};
const decode = (s) => s.replace(/&#39;|&#x27;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const text = (s) => decode(s.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const REQUIRED_HIDDEN = ['client_id', 'site_id', 'form_type', 'form_location', 'page_url', 'idempotency_key'];

/** @returns {string[]} one message per defect (empty = every form on the page follows the rules) */
export function checkLeadForms(html) {
  const errors = [];
  for (const [, rawAttrs, body] of html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)) {
    const form = attrsOf(rawAttrs);
    const lead = 'data-lead-form' in form;
    const label = `form${form.toolname ? ` "${form.toolname}"` : form['data-form-type'] ? ` (${form['data-form-type']})` : ''}`;
    const fields = [...body.matchAll(/<(input|select|textarea)\b([^>]*)>/gi)].map(([, tag, a]) => ({ tag: tag.toLowerCase(), a: attrsOf(a) }));

    // Sensitive personal data — any form, any field, any label.
    const flagged = new Set();
    for (const { a } of fields) {
      for (const k of ['name', 'id', 'placeholder', 'aria-label']) if (a[k] && isSensitiveField(a[k])) flagged.add(`${k}="${a[k]}"`);
    }
    for (const [, t] of body.matchAll(/<(?:label|legend)\b[^>]*>([\s\S]*?)<\/(?:label|legend)>/gi)) if (isSensitiveField(text(t))) flagged.add(`label "${text(t).slice(0, 60)}"`);
    for (const f of flagged)
      errors.push(`${label} asks for sensitive personal data (${f}) — agency forms never collect driver's licence/permit numbers, SSNs, dates of birth or bank/card details; ask "Do you have a valid driver's license?" (Yes/No) instead (§11)`);

    // Files: multipart post, careers résumé / cover letter only.
    const files = fields.filter((f) => f.tag === 'input' && (f.a.type ?? '').toLowerCase() === 'file');
    const value = (name) => fields.find((f) => f.a.name === name)?.a.value;
    const formType = value('form_type');
    if (files.length) {
      if ((form.method ?? '').toLowerCase() !== 'post' || (form.enctype ?? '').toLowerCase() !== 'multipart/form-data')
        errors.push(`${label} has a file input but is not method="post" enctype="multipart/form-data" — the file would never be sent (§11)`);
      for (const f of files)
        if (formType !== 'career_application' || !['resume', 'cover_letter'].includes(f.a.name))
          errors.push(`${label}: file input name="${f.a.name ?? ''}" — the router accepts files only as a careers form's "resume" / "cover_letter" (§27)`);
    }

    if (!lead) continue;
    // Router contract.
    const names = new Set(fields.map((f) => f.a.name));
    for (const n of REQUIRED_HIDDEN) if (!names.has(n)) errors.push(`lead ${label} has no "${n}" field — the router refuses it (§27)`);
    if (!names.has('company_website')) errors.push(`lead ${label} has no company_website honeypot (§27)`);
    if (formType !== undefined && !FORM_TYPES.includes(formType))
      errors.push(`lead ${label} form_type="${formType}" — use one of the three standard forms: ${FORM_TYPES.join(', ')} (§11)`);
    if (form['data-form-type'] && formType !== undefined && form['data-form-type'] !== formType)
      errors.push(`lead ${label} says data-form-type="${form['data-form-type']}" but sends form_type="${formType}" — the router routes by form_type (§27)`);
  }
  return errors;
}
