/**
 * Wiring for every agency lead form (CORE_CONTRACTS §11, §27): the shared Request Service panel, the Careers
 * application and the Partner inquiry. Imported by all three components; Astro bundles it once per page.
 *
 * The router REQUIRES `page_url` and a unique `idempotency_key`, and it verifies Turnstile — so these forms already
 * depend on JavaScript. Generating the key here is therefore safe. Attribution is read from the landing URL and kept
 * in sessionStorage so a lead submitted three pages later still carries the campaign that brought them in.
 *
 * The router answers a browser post with a 303 back to page_url?form_status=success|error&form_location=…. The
 * message shows ONLY in the form that was sent: a Careers / Partner form's own status region when form_location is
 * that form's; otherwise every Request Service panel on the page (hero + footer), exactly as before.
 *
 * Careers: the résumé / cover-letter inputs are checked in the browser with the router's own rules (PDF/DOC/DOCX by
 * file signature, 10 MB) so a wrong file is caught before the upload; a Yes/No question's "how many?" follow-up shows
 * (and becomes required) only after "Yes".
 */
const KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'gclid', 'fbclid'];
const DEFAULT_TEXT = {
  success: 'Thank you — your request is in. We will be in touch shortly. If this is urgent, please call.',
  error: 'Something went wrong sending that. Please try again, or call us directly.',
};
const MAX_FILE_BYTES = 10 * 1024 * 1024; // = the router's MAX_RESUME_BYTES
const SIGNATURES: Record<string, number[]> = { pdf: [0x25, 0x50, 0x44, 0x46], doc: [0xd0, 0xcf, 0x11, 0xe0], docx: [0x50, 0x4b, 0x03, 0x04] };

const params = new URLSearchParams(location.search);
const forms = [...document.querySelectorAll<HTMLFormElement>('form[data-lead-form]')];
const fieldValue = (form: HTMLFormElement, name: string) => form.querySelector<HTMLInputElement>(`[name="${name}"]`)?.value ?? '';

// Persist first-touch attribution for the session.
for (const k of KEYS) {
  const v = params.get(k);
  if (v && !sessionStorage.getItem(`attr:${k}`)) {
    try { sessionStorage.setItem(`attr:${k}`, v); } catch { /* private mode */ }
  }
}

// Surface the router's redirect-back result in the form that was sent, then clean the URL.
const formStatus = params.get('form_status');
if (formStatus) {
  const ok = formStatus === 'success';
  const sentFrom = params.get('form_location') ?? '';
  // A Careers / Partner form owns its result; anything else (or no location) is a Request Service result.
  const owner = forms.find((f) => f.dataset.formType && f.dataset.formType !== 'request_service' && fieldValue(f, 'form_location') === sentFrom);
  for (const el of document.querySelectorAll<HTMLElement>('[data-form-status]')) {
    const type = el.dataset.formStatus || 'request_service';
    const mine = owner ? type === owner.dataset.formType && el.dataset.formLocation === sentFrom : type === 'request_service';
    if (!mine) continue;
    el.hidden = false;
    el.className =
      'rounded-sm border-l-4 px-4 py-3 text-sm leading-snug ' +
      (ok ? 'border-green-600 bg-green-50 text-green-900' : 'border-amber-500 bg-amber-50 text-amber-900');
    el.textContent = (ok ? el.dataset.successText : el.dataset.errorText) || DEFAULT_TEXT[ok ? 'success' : 'error'];
    if (owner) el.scrollIntoView({ block: 'center' }); // a long application form: bring the result into view
  }
  params.delete('form_status');
  params.delete('form_location');
  const q = params.toString();
  history.replaceState({}, '', location.pathname + (q ? `?${q}` : ''));
}

for (const form of forms) {
  const set = (sel: string, value: string) => {
    const el = form.querySelector<HTMLInputElement>(sel);
    if (el) el.value = value;
  };
  set('[data-page-url]', location.href.split('?')[0]);
  for (const k of KEYS) set(`[data-utm="${k}"]`, params.get(k) || sessionStorage.getItem(`attr:${k}`) || '');

  form.addEventListener('submit', () => {
    // Fresh key per attempt so a genuine resubmit is not swallowed as a duplicate.
    set('[data-idempotency]', typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
    // Request Service only: fold City/ZIP into the message so it is never lost, whatever the destination maps.
    if ((form.dataset.formType || 'request_service') !== 'request_service') return;
    const city = form.querySelector<HTMLInputElement>('[name="city"]');
    const message = form.querySelector<HTMLTextAreaElement>('[name="message"]');
    if (city && city.value.trim() && message && !message.value.includes('City/ZIP:')) {
      message.value = `City/ZIP: ${city.value.trim()}\n\n${message.value}`.trim();
    }
  });

  // "How many?" follow-ups: shown and required only after "Yes".
  for (const follow of form.querySelectorAll<HTMLElement>('[data-follow-up]')) {
    const input = follow.querySelector<HTMLInputElement>('input');
    const sync = () => {
      const yes = form.querySelector<HTMLInputElement>(`input[name="${follow.dataset.followUp}"][value="Yes"]`)?.checked ?? false;
      follow.hidden = !yes;
      if (input) { input.required = yes; if (!yes) input.value = ''; }
    };
    for (const r of form.querySelectorAll<HTMLInputElement>(`input[name="${follow.dataset.followUp}"]`)) r.addEventListener('change', sync);
    sync();
  }

  // Résumé / cover letter: one PDF, DOC or DOCX (checked by its first bytes, like the router), 10 MB at most.
  for (const input of form.querySelectorAll<HTMLInputElement>('input[type="file"][data-document]')) {
    const statusEl = form.querySelector<HTMLElement>(`#${input.id}-status`);
    const label = input.dataset.document || 'file';
    const say = (text: string, bad: boolean) => {
      if (!statusEl) return;
      statusEl.textContent = text;
      statusEl.classList.toggle('text-amber-900', bad);
    };
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) { input.setCustomValidity(''); say(input.required ? 'No file selected.' : 'Optional — no file selected.', false); return; }
      const ext = /\.([a-z0-9]+)$/i.exec(file.name)?.[1]?.toLowerCase() ?? '';
      let problem = '';
      if (!(ext in SIGNATURES)) problem = `Your ${label} must be a PDF, DOC, or DOCX file.`;
      else if (file.size <= 0 || file.size > MAX_FILE_BYTES) problem = `Your ${label} must be 10 MB or smaller.`;
      else {
        const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
        if (!SIGNATURES[ext].every((b, i) => head[i] === b)) problem = `Your ${label} must be a PDF, DOC, or DOCX file.`;
      }
      input.setCustomValidity(problem);
      if (problem) { say(problem, true); input.reportValidity(); }
      else say(`Selected: ${file.name} (${file.size < 1048576 ? `${Math.max(1, Math.round(file.size / 1024))} KB` : `${(file.size / 1048576).toFixed(1)} MB`}).`, false);
    });
  }
}

export {}; // a module: its top-level names stay out of the page's global scope
