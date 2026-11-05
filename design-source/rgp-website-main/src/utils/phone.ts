/**
 * Normalize a display phone to an E.164 tel: href (§9).
 * Stripping punctuation alone drops the country code — `(555) 000-1234` becomes
 * `tel:9728101411`, which is not the approved href format and which dialers and
 * call-tracking handle inconsistently. Assumes NANP when no country code is present.
 */
export function telHref(display: string): string {
  const digits = display.replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) return `tel:${digits}`;
  if (digits.length === 10) return `tel:+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `tel:+${digits}`;
  return `tel:${digits}`;
}
