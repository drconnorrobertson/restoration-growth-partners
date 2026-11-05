/**
 * WebMCP declarative attributes (§28 Agentic Browsing) — Chrome's form-as-tool API, not yet in Astro's
 * HTML types. RequestServicePanel uses them; validate:built enforces them on lead forms.
 */
declare namespace astroHTML.JSX {
  interface FormHTMLAttributes {
    toolname?: string;
    tooldescription?: string;
    toolautosubmit?: boolean | 'true' | 'false';
  }
  interface InputHTMLAttributes {
    toolparamdescription?: string;
  }
  interface SelectHTMLAttributes {
    toolparamdescription?: string;
  }
  interface TextareaHTMLAttributes {
    toolparamdescription?: string;
  }
}
