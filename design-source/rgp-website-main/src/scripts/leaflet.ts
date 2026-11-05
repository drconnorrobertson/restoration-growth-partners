/**
 * Leaflet + its stylesheet as ONE lazily imported chunk (§15/§28). The map components import this
 * module only when a map nears the viewport.
 *
 * The CSS is imported as a string (`?inline`) and injected here. A plain `import '…leaflet.css'`
 * does NOT stay lazy: Astro still links CSS from dynamically imported modules in the page <head>,
 * and that render-blocking leaflet stylesheet is exactly what PageSpeed flagged on client sites.
 * validate:built fails any page that links a leaflet stylesheet up front.
 */
import css from 'leaflet/dist/leaflet.css?inline';
import L from 'leaflet';

if (!document.querySelector('style[data-leaflet-css]')) {
  const style = document.createElement('style');
  style.dataset.leafletCss = '';
  style.textContent = css;
  document.head.append(style);
}

export default L;
