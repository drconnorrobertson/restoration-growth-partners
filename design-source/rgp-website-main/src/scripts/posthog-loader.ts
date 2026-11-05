/**
 * PostHog loader (§19/§28). Tiny on purpose: the SDK chunk is imported on the visitor's FIRST INPUT
 * (pointer move or tap, key, scroll, wheel), never during page load and never on a timer.
 *
 * Why: PageSpeed flagged the PostHog SDK (~100 KB compressed, ~300 KB of script to run) on client
 * sites as unused JavaScript and main-thread work. Lighthouse produces no input, so the lab run never
 * downloads it. Real visitors almost always move, tap or scroll within a second or two.
 * Nothing measured is lost: the web-vitals observers read buffered entries, so LCP/CLS/INP from
 * before init are still reported, and the session recording starts from a full snapshot.
 *
 * Known trade-off (owner-visible, §19): a visit with NO input at all (opened and closed untouched)
 * sends no PostHog pageview, and the very first click is not autocaptured. GA4/GTM still record both.
 * Pages without #posthog-config (site.posthog.projectKey unset) do nothing.
 */
const cfgEl = document.getElementById('posthog-config');

if (cfgEl) {
  const INPUTS = ['pointermove', 'pointerdown', 'touchstart', 'keydown', 'scroll', 'wheel'] as const;
  let started = false;
  const start = () => {
    if (started) return;
    started = true;
    for (const type of INPUTS) removeEventListener(type, start, true);
    import('./posthog-init').then((m) => m.initPostHog(JSON.parse(cfgEl.textContent || '{}')));
  };
  for (const type of INPUTS) addEventListener(type, start, { capture: true, passive: true });
}
