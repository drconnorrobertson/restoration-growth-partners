/**
 * Shared site data — single source for phone/DNI, NAP, navigation, and claims-bearing values.
 * Every component reads from here; nothing hard-codes a phone number or address (§9, §22).
 * Values below are realistic example data for the template preview routes ONLY (§17).
 * A client build (Rule Zero) fills this file from the verified intake + approved copy artifacts —
 * it is THE per-client swap point together with theme.css.
 */
export const site = {
  name: 'Restoration Growth Partners',
  legalName: 'Restoration Growth Partners',
  /**
   * Display format is FUNCTIONAL, not cosmetic (§9): the call-tracking swapper
   * matches numbers by pattern, and `(555) 000-1234` is a recognized format.
   * A number formatted any other way (e.g. `555 000 1234`) is silently skipped
   * and that CTA loses call attribution. Keep this shape.
   */
  phoneDisplay: '(304) 944-3324',
  /** Approved tracking/DNI-capable tel: source — QA fails any other phone href (§9). */
  phoneHref: 'tel:+13049443324',
  emergencyAvailability: '24/7',
  primaryMarket: 'St. Petersburg',
  stateAbbr: 'FL',
  /** Claims rendered anywhere must exist here with a claim state (§6). */
  claims: [
    { text: '24/7 Emergency Service', state: 'visible_preview_allowed' },
    { text: 'Free Estimates', state: 'visible_preview_allowed' },
    { text: 'Locally Owned & Operated', state: 'visible_preview_allowed' },
    { text: 'Licensed & Insured', state: 'launch_proof_required' },
  ],
  services: [
    { id: 'water-damage-restoration', label: 'Water Damage Restoration', url: '/water-damage-restoration/' },
    { id: 'fire-damage-restoration', label: 'Fire Damage Restoration', url: '/fire-damage-restoration/' },
    { id: 'mold-remediation', label: 'Mold Remediation', url: '/mold-remediation/' },
  ],
  nav: [
    { label: 'Home', url: '/' },
    { label: 'Services', url: '/#services' },
    { label: 'Service Areas', url: '/#areas' },
    { label: 'Reviews', url: '/#reviews' },
    { label: 'Contact', url: '/contact/' },
  ],
  /**
   * Header utility links and footer legal links — the shell reads these, never hardcodes them.
   * A client without one of these pages REMOVES the entry (no dead links, §15); the operational
   * page templates under components/templates/ build the pages themselves.
   */
  utilityNav: [
    { id: 'about', label: 'About', url: '/about/' },
    { id: 'reviews', label: 'Reviews', url: '/reviews/' },
    { id: 'contact', label: 'Contact', url: '/contact/' },
  ],
  legalLinks: [
    { label: 'Privacy Policy', url: '/privacy-policy/' },
    { label: 'Terms', url: '/terms/' },
  ],
  socialLinks: [] as { platform: string; url: string }[],
  /** Public contact email — shown on the contact page. */
  email: 'info@example-restoration.com',

  /**
   * NAP cards — must match approved GBP data EXACTLY on real builds (§13):
   * business name, address, and phone as they appear on the Google Business
   * Profile, per location. Every approved GBP location must be listed.
   * Source: one `{Brand} {City} NAP Info` tab per GBP in the client's Local SEO Sheet (intake reads
   * every tab ending in "NAP Info"). The footer, the contact page, and the schema all read this array.
   */
  locations: [
    {
      /** New office (James, 2026-11-04). GBP and citations still show the old Morgantown address — update them before launch. */
      name: 'Restoration Growth Partners',
      address: '15 8th St N #115, St. Petersburg, FL 33701',
      phone: '(304) 944-3324',
    },
  ] as {
    /** Exact GBP name ("Optimized GBP Name" row) — the visible heading, so the name matches the listing. */
    name: string;
    /**
     * This location's own legal entity ("Legal Business Name" in its NAP Info tab). Multi-location
     * clients often run each office as a separate LLC; it renders under the GBP name and as the
     * schema `legalName` (§13, §22). Omit only when it equals `site.legalName`.
     */
    legalName?: string;
    address: string;
    phone: string;
    gbpUrl?: string;
    hours?: string;
    /**
     * Cities THIS location serves — its own GBP service areas (≤20, Google's limit). Locations never
     * overlap: each city belongs to the nearest office, confirmed by the AM (§22). Rendered as this
     * location's schema `areaServed`. Omit for a single-location client (site-wide areas are used).
     */
    areaServed?: string[];
    /**
     * Map pin coordinates for this location, from its Google Business Profile.
     * The service-area map renders markers ONLY from this array — the same
     * source the footer NAP cards and LocalBusiness schema use — so pins,
     * printed addresses, and structured data cannot drift apart (§15, §22).
     * A location without coords renders no pin (and is a QA flag, not a guess).
     */
    lat?: number;
    lng?: number;
  }[],
  footerBlurb:
    'Emergency restoration for homes and businesses across the Example City area — mitigation through rebuild, one call.',

  /**
   * ---------------------------------------------------------------------------
   * SITE-WIDE CUSTOMER-FACING COPY — REPLACE EVERY VALUE BELOW PER CLIENT.
   * ---------------------------------------------------------------------------
   * These strings appear in the shared shell (footer, sticky CTA, lead form), so
   * they render on EVERY page. They live here — in the per-client data file the
   * build agent must fill (§ build procedure step 3) — and deliberately NOT as
   * component defaults: a component default would let a build silently ship this
   * placeholder wording to a real client, which is exactly how sites start
   * reading as mass-produced. Source: the approved Homepage Messaging Pack.
   */
  footerCta: {
    heading: 'Talk to a restoration crew now',
    support:
      "Damage spreads by the hour. Call and a real person answers — or send the form and we'll respond within one business day.",
  },

  /**
   * Site-wide reusable SECTIONS. These render identically on the homepage and on
   * every inner page (owner decision 2026-08-25: "needs to be the same as the
   * home page… we'll reuse that"), so their content lives here once instead of
   * being re-passed per page — which is how two pages drift out of sync.
   * The design recipe picks ONE process variant and ONE service-area variant per
   * client; every page then uses that same choice.
   */
  process: {
    eyebrow: 'Simple process',
    heading: 'What happens after you call',
    support:
      "We've made the process simple. One call, and we handle everything — from the first response to the final nail.",
    steps: [
      { title: 'Call anytime, day or night', text: 'Tell us what happened. A real person answers, asks the right questions, and gets a crew moving.' },
      { title: 'Assess & stabilize', text: 'We stop the damage from spreading, document everything for your claim, and walk you through the plan.' },
      { title: 'Restore & rebuild', text: 'From cleanup through reconstruction, one team carries your property back to normal.' },
    ],
  },

  serviceArea: {
    eyebrow: 'Where we work',
    heading: 'Serving Example City and Surrounding Communities',
    intro: 'Fast emergency response across our core service area. Click any city to explore dedicated service pages.',
    caption: 'Shaded service area — Example City metro',
    mapCenter: [41.85, -87.75] as [number, number],
    mapZoom: 9,
    polygon: [
      [42.15, -88.2],
      [42.2, -87.7],
      [41.85, -87.55],
      [41.5, -87.8],
      [41.6, -88.25],
    ] as [number, number][],
    /** Counties → city hubs → approved city-service pages (from the page map). */
    counties: [
      {
        name: 'Example County',
        cities: [
          {
            name: 'Example City',
            url: '/service-areas/example-city/',
            services: [
              { label: 'Example City Water Damage Restoration', url: '/service-areas/example-city/water-damage-restoration/' },
              { label: 'Example City Fire Damage Restoration', url: '/service-areas/example-city/fire-damage-restoration/' },
              { label: 'Example City Mold Remediation', url: '/service-areas/example-city/mold-remediation/' },
              { label: 'Example City Reconstruction', url: '/service-areas/example-city/reconstruction/' },
            ],
          },
          {
            name: 'Northtown',
            url: '/service-areas/northtown/',
            services: [
              { label: 'Northtown Water Damage Restoration', url: '/service-areas/northtown/water-damage-restoration/' },
              { label: 'Northtown Fire Damage Restoration', url: '/service-areas/northtown/fire-damage-restoration/' },
              { label: 'Northtown Mold Remediation', url: '/service-areas/northtown/mold-remediation/' },
            ],
          },
          { name: 'Southville', url: '/service-areas/southville/' },
        ],
      },
      {
        name: 'Neighbor County',
        cities: [{ name: 'Easton' }, { name: 'Westfield' }, { name: 'Lakeside' }],
      },
    ],
  },
  form: {
    /** Response-time promise: a real client commitment — confirm before shipping. */
    responseNotice: 'Non-emergency requests are returned within one business day.',
    emergencyNoticeLead: 'Currently experiencing an emergency?',
  },
  /**
   * The two OPTIONAL standard forms (§11): a Careers application and a Partner inquiry. Both post to the same agency
   * router as the request form; each goes to its OWN workflow in the client's GoHighLevel (never the lead workflow,
   * never New Leads, never the office call). Turn one on only when the intake says the client wants it, then put
   * CareersForm / PartnerForm on a page (FormPageTemplate). A form that is on but whose router webhook is not set up
   * yet (site.leadRouter.careersReady / partnerReady, written by `npm run leadrouter:setup`) shows "not configured"
   * and refuses submissions. Sensitive data is never asked for: no driver's licence / permit NUMBER, SSN, date of
   * birth, or bank details (validate:built fails a form that asks; the router drops such fields).
   * Every visible string here is customer-facing: confirm it with the client like the rest of site.ts.
   */
  forms: {
    careers: {
      enabled: false,
      /** Positions offered as a list ("Water Mitigation Technician", …). Empty = a free-text "Position" field. */
      positions: [] as string[],
      /** Résumé upload (required) into the client's GHL Media folder — needs the router's résumé folder (setup --resume-folder). */
      resumeUpload: true,
      /** Optional cover letter (same folder). Only shown with resumeUpload. */
      coverLetter: true,
      linkedin: false,
      /** Street, city, state, ZIP (optional fields). */
      address: true,
      /** "Relevant experience" box. */
      experience: true,
      /**
       * Yes/No questions. id: lowercase letters, digits, underscores (≤ 34) — it is the GHL key `q_<id>`, so keep it
       * readable ("drivers_license" → "Drivers License: Yes" in the client's email). followUp: a "how many?" number
       * shown only after "Yes". Ask whether someone HAS a licence — never for its number.
       */
      questions: [
        { id: 'drivers_license', label: "Do you have a valid driver's license?", required: true },
        { id: 'accidents_past_3_years', label: 'Have you had any accidents in the past three years?', followUp: 'If yes, how many?' },
        { id: 'moving_violations_past_3_years', label: 'Have you had any moving violations in the past three years?', followUp: 'If yes, how many?' },
      ] as { id: string; label: string; required?: boolean; followUp?: string }[],
      successMessage: 'Thank you — your application is in. Our hiring team reviews every application and will contact you if your experience is a match.',
    },
    partner: {
      enabled: false,
      /** "I am a…" choices. Empty = not asked. */
      partnerTypes: ['Insurance agent or adjuster', 'Property manager', 'Real estate agent', 'Plumber or contractor', 'Other'] as string[],
      jobTitle: true,
      /** Morning / Afternoon / Evening. */
      preferredContactTime: true,
      successMessage: 'Thank you — your inquiry is in. We will be in touch within one business day.',
    },
  },
  /** GHL "Sales Calls – Strategy Session" (30 min) — every book-a-call CTA uses this calendar. */
  booking: {
    calendarUrl: 'https://api.leadconnectorhq.com/widget/booking/XOMzwYYPPwonprc5gAA2',
  },
  // ---------------------------------------------------------------- launch + platform config

  /**
   * PRE-LAUNCH SWITCH (§17). While true, every page emits <meta name="robots" content="noindex,nofollow">
   * and postbuild writes a Disallow-all robots.txt. Launch = set false, rebuild, and pass
   * `npm run validate:launch`. /templates/ routes pass noindex explicitly and stay noindex regardless.
   */
  previewMode: true,
  /** Production origin — canonical URLs, sitemap, robots, and schema all derive from it (§21, §22). No trailing slash. */
  siteUrl: 'https://www.restorationgrowthpartners.com',
  /** Full state + regional label used by schema areaServed (§22). */
  stateName: 'Florida',
  regionName: 'United States',
  /** City-hub links for the footer areas band — from the approved page map's city hubs (§15). */
  footerAreaLinks: [] as { label: string; url: string }[],
  /** LeadConnector DNI scripts (§9). Empty = not loaded. */
  callTracking: {
    numberPoolUrl: 'https://backend.leadconnectorhq.com/appengine/loc/WQcLWHOkVEIyh4jHsMbq/pool/RLK3hhYJ1sSNdbLoDIwq/number_pool.js',
    userSessionUrl: 'https://backend.leadconnectorhq.com/appengine/js/user_session.js',
  },
  /** Review widget IDs per placement (§16). Empty = ReviewSection renders its reserved state — must be real before launch. */
  reviews: { homepage: '', inner: '', reviewsPage: '' },
  /** GTM preferred; GA4 only when not using GTM. Empty = nothing loads. */
  analytics: { gtmId: '', ga4Id: '' },
  /**
   * PostHog product analytics — ONE shared project for every client site, "RGP - Clients" (id 676619) in
   * the agency's PostHog organization (owner decision 2026-10-20). projectKey is that project's PUBLIC key
   * ("phc_…"), safe in the repo by design (it only sends events) — keep the default.
   * Every event carries `client` (this slug — the lead router's clientId unless set here), `client_name`
   * (site.name) and `environment: preview|production` (site.previewMode), so one client's numbers are a
   * filter on `client` and preview traffic never pollutes production. PostHog stays off until the client
   * slug is known; `npm run validate:launch` fails while it is off.
   */
  posthog: { projectKey: 'phc_yLVrpCGHETeBLv3x8UgEBbxkRgzhGM7R9HcXEV3yBF8c', apiHost: 'https://us.i.posthog.com', client: 'rgp' },
  /**
   * IndexNow (Bing, Yandex, Naver, Seznam, Yep — Google does not participate). The key is created by the
   * agency (8–128 letters, digits, dashes), is public by design, and postbuild publishes it as
   * /{key}.txt. After Search Console accepts the sitemap, `npm run indexnow:submit` sends the URLs.
   * `npm run validate:launch` fails while it is empty.
   */
  indexNow: { key: '' },
  /**
   * Blog (§29). Posts live in src/content/posts/. The schedule is NOT set here: it is the same for every
   * client — one post per Wednesday at 06:00 UTC (PUBLISH_SLOT in src/utils/blog-schedule.mjs), published by
   * .github/workflows/publish-scheduled-posts.yml.
   * scheduleFrom (optional ISO date): posts published before it (migrated history) are exempt from the
   * Wednesday/one-per-date rules. Empty = every post follows them.
   */
  blog: {
    scheduleFrom: '',
    postsPerPage: 12,
    /** /blog/ copy — customer-facing, so REPLACED per client from approved copy like every string above. */
    heading: 'Restoration Advice and Updates',
    intro: 'Practical guidance from the crews who do the work.',
    description: 'Practical restoration advice: what to do after water, fire, or mold damage, and what the work involves.',
    /**
     * Company author (§29, owner decision 2026-10-14): every post is by the COMPANY — never a person. The
     * byline shows the logo + "By {site.name}" + date; the "About {site.name}" box after the article shows
     * the logo, the name, this snippet and links to the About and Contact pages (site.utilityNav ids
     * 'about' / 'contact', when present). BlogPosting author + publisher = the Organization.
     * about: 1–3 sentences of APPROVED company copy from the intake — never invented. Empty = site.footerBlurb.
     */
    about: '',
    /**
     * Automatic cover image (§29) for every published post WITHOUT heroImage: og:image, twitter:image,
     * BlogPosting image and the /blog/ card. Drawn by src/utils/blog-cover.mjs from the post title, a topic
     * label from the post's parent, theme.css (--color-dark background, --color-accent pill/bar), this logo,
     * site.name and the siteUrl domain. Nothing here is a judgment call; defaults work for every client.
     *  · logo:   the client logo file (PNG/WebP/SVG/JPG) — shown on a white badge, so any logo colour works.
     *  · labels: optional { parentPageId: 'Pill label' } overrides; default = fixed keyword rules
     *            (Water Damage / Fire & Smoke / Mold / Storm, else the parent's label minus service words).
     *  · font:   optional path to the client's heavy display face as TTF/OTF/WOFF (not WOFF2); empty = the
     *            bundled Barlow Condensed Black (OFL, src/assets/fonts/cover/).
     */
    cover: {
      logo: 'src/assets/brand/logo.png',
      labels: {} as Record<string, string>,
      font: '',
    },
  },
  /**
   * Agency lead router (§11, §27). submitUrl is the ONE router every client uses (rgp-lead-router);
   * clientId / siteId / turnstileSiteKey are per client and are written by `npm run leadrouter:setup`
   * (never by hand). RequestServicePanel disables the form until submitUrl + clientId are set — an
   * unconfigured router fails loudly instead of swallowing leads.
   * careersReady / partnerReady are also written by `npm run leadrouter:setup`: true once the router has that form's
   * own GHL webhook (and, for careers with résumé upload, its résumé folder). Until then those forms stay disabled.
   */
  leadRouter: {
    submitUrl: 'https://rgp-lead-router.login-cce.workers.dev/submit',
    clientId: '',
    siteId: '',
    turnstileSiteKey: '',
    careersReady: false,
    partnerReady: false,
  },
};

export type Site = typeof site;
