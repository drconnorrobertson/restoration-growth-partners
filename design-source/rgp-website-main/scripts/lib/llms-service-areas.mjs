/**
 * The "## Service areas" section of /llms.txt (CORE_CONTRACTS §21; postbuild.mjs writes the file).
 *
 * City hubs live at /{city}-{st}/ with each city's OWN state (src/data/cities.ts `state`; pages/[citySlug].astro
 * builds the route the same way). Clients span states — Phantom is NC + SC, C&B is DE + MD — and deriving the
 * suffix from site.stateAbbr alone dropped every other-state hub from llms.txt. The text says hubs link to the
 * city's service pages ONLY for hubs that have city-service pages built under them; a city with a hub and no
 * city-service pages (Phantom) gets no such claim. Phantom fixed both in its own repo (a65fc5c, 2026-10-09);
 * the fix was lost when the starter postbuild was re-ported, so it lives here now.
 *
 * Pure over the finished build: `built(route)` and `childrenOf(route)` are postbuild's dist helpers.
 */
export const hubUrl = (city) => `/${city.slug}-${city.state.toLowerCase()}/`;

/** @returns {{ text: string, hubs: object[] }} the section ('' when no hub was built) and the built hubs */
export function serviceAreasSection({ cities, origin, built, childrenOf, link }) {
  const hubs = cities.filter((c) => built(hubUrl(c)));
  if (!hubs.length) return { text: '', hubs };
  const states = [...new Set(hubs.map((c) => c.state.toLowerCase()))];
  const examples = states.map((st) => `${origin}${hubUrl(hubs.find((c) => c.state.toLowerCase() === st))}`);
  const withServices = hubs.filter((c) => childrenOf(hubUrl(c)).length > 0).length;
  const n = hubs.length;

  let text = `## Service areas\n\n`;
  const areaIndex = ['/service-area/', '/service-areas/'].find(built);
  if (areaIndex) text += `${link(areaIndex, `All ${n} cities served`)}\n`;
  text += `\n${n === 1 ? 'The 1 city has' : `Each of the ${n} cities has`} a hub page at ${origin}/{city}-${states.length > 1 ? `{${states.join('|')}}` : states[0]}/ ` +
    `(for example ${examples.join(' and ')})` +
    (withServices === n ? `, linking to that city's service pages. `
      : withServices ? `. ${withServices} of the ${n} hubs ${withServices === 1 ? 'links' : 'link'} to that city's service pages. `
      : '. ') +
    `The complete inventory is in the sitemap.\n\n`;
  return { text, hubs };
}
