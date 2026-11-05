/**
 * Load heavy, below-the-fold things only when the visitor approaches them (CORE_CONTRACTS §15/§28).
 *
 * Why this exists: PageSpeed audits on several client sites flagged the same pattern — maps,
 * review widgets and chat loading their JavaScript, CSS and data on page load even though they sit
 * far down the page. That costs render-blocking CSS, long main-thread tasks and wasted bytes.
 *
 * Trigger rules (never a timer):
 *   · IntersectionObserver with a pre-warm margin (default 300px) — loads just before it scrolls in.
 *   · A scroll/resize proximity check as the fallback. A map once shipped IO-only and stayed a
 *     placeholder for some visitors; the fallback catches that WITHOUT a setTimeout, which would
 *     load the asset during PageSpeed's lab run and defeat the point.
 *   · Already near the viewport at load (short page, deep link) → runs immediately.
 */

type Options = { rootMargin?: number };

const nearViewport = (el: Element, margin: number) => {
  const r = el.getBoundingClientRect();
  return r.top < window.innerHeight + margin && r.bottom > -margin;
};

/** Run `run` once, the first time `el` comes within `rootMargin` px of the viewport. */
export function whenNear(el: Element, run: () => void, { rootMargin = 300 }: Options = {}): void {
  let done = false;
  const fire = () => {
    if (done) return;
    done = true;
    io?.disconnect();
    removeEventListener('scroll', check);
    removeEventListener('resize', check);
    run();
  };
  const check = () => { if (nearViewport(el, rootMargin)) fire(); };
  const io = 'IntersectionObserver' in window
    ? new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) fire(); }, { rootMargin: `${rootMargin}px` })
    : null;
  io?.observe(el);
  addEventListener('scroll', check, { passive: true });
  addEventListener('resize', check, { passive: true });
  check();
}

const loaded = new Map<string, Promise<void>>();

/** Inject a third-party <script> once per page (async), resolving when it has loaded. */
export function loadScriptOnce(src: string, attrs: Record<string, string> = {}): Promise<void> {
  if (!loaded.has(src)) {
    loaded.set(src, new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.async = true;
      for (const [k, v] of Object.entries(attrs)) s.setAttribute(k, v);
      s.onload = () => resolve();
      s.onerror = () => reject(new Error(`failed to load ${src}`));
      document.body.appendChild(s);
    }));
  }
  return loaded.get(src)!;
}
