/**
 * RGP's own site has no city or service-area pages. postbuild.mjs (llms.txt) still reads this list,
 * so it stays as an empty export.
 */
export interface City {
  slug: string;
  name: string;
  county: string;
  state: string;
  zone: 'home' | 'near' | 'outer';
  near: string[];
}

export const cities: City[] = [];
