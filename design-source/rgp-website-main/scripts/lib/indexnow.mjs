/**
 * IndexNow (Bing, Yandex, Naver, Seznam, Yep — Google does not participate), CORE_CONTRACTS §28.
 * Shared by `npm run indexnow:submit` (scripts/indexnow-submit.mjs, by hand) and the post-deploy job
 * (scripts/search-notify.mjs). Every function takes its fetch so tests never touch the network.
 */
export const ENDPOINT = 'https://api.indexnow.org/indexnow';
export const KEY_PATTERN = /^[A-Za-z0-9-]{8,128}$/;
export const BATCH = 10000;

export const MEANING = {
  200: 'accepted',
  202: 'received; the key is still being validated',
  400: 'bad request (invalid format)',
  403: 'key not valid (key file missing or does not match)',
  422: 'URLs do not belong to the host, or the key does not match',
  429: 'too many requests — stop and try later; do not resubmit unchanged URLs',
};

/** Throws a plain message unless {origin}/{key}.txt is live and contains exactly the key. */
export async function checkKeyFile({ origin, key, fetchFn = fetch }) {
  if (!KEY_PATTERN.test(key ?? '')) throw new Error('site.indexNow.key is empty or invalid (8–128 letters, digits, dashes)');
  const keyLocation = `${String(origin).replace(/\/$/, '')}/${key}.txt`;
  let res;
  try { res = await fetchFn(keyLocation, { headers: { 'cache-control': 'no-cache' } }); }
  catch (e) { throw new Error(`could not fetch ${keyLocation}: ${e.message}`); }
  const body = (await res.text()).trim();
  if (res.status !== 200 || body !== key) throw new Error(`${keyLocation} returned ${res.status}${res.status === 200 ? ' with the wrong content' : ''} — deploy the build (postbuild writes the key file) first`);
  return keyLocation;
}

/** Every <loc> in a sitemap, following a sitemap index. */
export async function sitemapUrls(url, fetchFn = fetch, seen = new Set()) {
  if (seen.has(url)) return [];
  seen.add(url);
  const res = await fetchFn(url, { headers: { 'cache-control': 'no-cache' } });
  if (res.status !== 200) throw new Error(`${url} returned ${res.status}`);
  const xml = await res.text();
  const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]);
  if (/<sitemapindex/i.test(xml)) return (await Promise.all(locs.map((l) => sitemapUrls(l, fetchFn, seen)))).flat();
  return locs;
}

/**
 * POST the URLs to IndexNow in batches. Throws on any batch that is not 200/202 (the message says which and why).
 * `dryRun` prints what would be sent and sends nothing. Returns the number of URLs sent.
 */
export async function submitIndexNow({ origin, key, urls, fetchFn = fetch, log = console.log, dryRun = false }) {
  const base = String(origin).replace(/\/$/, '');
  const host = new URL(base).host;
  const keyLocation = `${base}/${key}.txt`;
  const list = [...new Set(urls)];
  const foreign = list.filter((u) => { try { return new URL(u).host !== host; } catch { return true; } });
  if (foreign.length) throw new Error(`${foreign.length} URL(s) are not on ${host} (e.g. ${foreign[0]}) — IndexNow rejects them (422)`);
  if (!list.length) throw new Error('no URLs to submit');
  for (let i = 0; i < list.length; i += BATCH) {
    const urlList = list.slice(i, i + BATCH);
    if (dryRun) { urlList.slice(0, 5).forEach((u) => log(`  ${u}`)); if (urlList.length > 5) log(`  … and ${urlList.length - 5} more`); continue; }
    const res = await fetchFn(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ host, key, keyLocation, urlList }),
    });
    const meaning = MEANING[res.status] ?? 'unexpected response';
    if (res.status !== 200 && res.status !== 202) throw new Error(`batch of ${urlList.length}: HTTP ${res.status} — ${meaning}`);
    log(`  ✓ batch of ${urlList.length}: HTTP ${res.status} — ${meaning}`);
  }
  return list.length;
}
