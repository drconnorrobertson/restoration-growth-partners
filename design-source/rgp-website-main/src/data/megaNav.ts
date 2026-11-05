/**
 * Mega-menu navigation tree.
 *
 * GENERATED FROM THE ACTIVE PAGE MAP on a client build — never hand-authored per client.
 * A hand-authored menu drifts from the page map the first time a page is added.
 * Columns SCROLL rather than truncate (max-height + overflow-y), so every approved page is
 * reachable from the header. Column headings are links to their hub, never dead labels.
 *
 * In the starter this file derives an EXAMPLE tree from site.ts so /templates/mega-menu/ has
 * something realistic to render. Replace it with the page-map-generated tree on a client build.
 */
import { site } from './site';

export interface NavLeaf { label: string; url: string }
export interface NavColumn {
  /** Column heading — ALWAYS a link to the hub, never a dead label. */
  label: string;
  url: string;
  children: NavLeaf[];
}
export interface MegaMenu {
  id: string;
  label: string;
  /** Dark intro panel shown at the left of the open menu. */
  intro: { title: string; body: string; ctaLabel: string; ctaUrl: string };
  columns: NavColumn[];
}

export const servicesMenu: MegaMenu = {
  id: 'services',
  label: 'Services',
  intro: {
    title: 'Restoration Services',
    body: 'Emergency response, mitigation, cleanup, documentation, and rebuild support.',
    ctaLabel: 'All services',
    ctaUrl: '/services/',
  },
  columns: site.services.map((s) => ({
    label: s.label,
    url: s.url,
    children: [1, 2, 3].map((n) => ({ label: `${s.label} example page ${n}`, url: `${s.url}example-${n}/` })),
  })),
};

export const serviceAreasMenu: MegaMenu = {
  id: 'service-areas',
  label: 'Service Areas',
  intro: {
    title: 'Where We Work',
    body: 'Every city we serve has its own hub page linking to that city\'s service pages.',
    ctaLabel: 'All service areas',
    ctaUrl: '/service-area/',
  },
  columns: site.serviceArea.counties.map((c) => ({
    label: `${c.name}`,
    url: '/service-area/',
    children: c.cities.map((ct) => ({ label: ct.name, url: ct.url })),
  })),
};

export const megaMenus: MegaMenu[] = [servicesMenu, serviceAreasMenu];
