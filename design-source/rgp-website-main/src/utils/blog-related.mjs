/**
 * Related posts are never empty (CORE_CONTRACTS §29, owner decision 2026-10-14). A post shows its own
 * `related` posts that are PUBLISHED, in the brief's order; when fewer than RELATED_MIN (3) of them are live
 * — e.g. the first post of a batch, whose related posts are all still scheduled — the list is filled up to 3
 * with other PUBLISHED posts, deterministically: same group (parent hub / category) first, then any post,
 * each newest first as the pool is ordered. Never the post itself, never twice, never an unpublished post
 * (the pool holds published posts only). Plain .mjs so tests import the same rule the pages use.
 */
export const RELATED_MIN = 3;

/**
 *   chosen:    the post's own related items that are published, in order (kept as they are, even beyond min)
 *   pool:      every PUBLISHED candidate, already sorted newest first with a deterministic tie-break
 *   key:       item → identity (slug or URL); self = the post's own key
 *   sameGroup: item → true when it shares the post's parent hub / category
 */
/**
 * @template T
 * @param {{ chosen: T[]; pool: T[]; key: (item: T) => string; self: string; sameGroup?: (item: T) => boolean; min?: number }} args
 * @returns {T[]}
 */
export function fillRelated({ chosen, pool, key, self, sameGroup = (_item) => false, min = RELATED_MIN }) {
  const out = [];
  const seen = new Set([self]);
  const add = (item) => {
    const k = key(item);
    if (seen.has(k)) return;
    seen.add(k);
    out.push(item);
  };
  for (const item of chosen) add(item);
  for (const list of [pool.filter(sameGroup), pool]) {
    for (const item of list) {
      if (out.length >= min) return out;
      add(item);
    }
  }
  return out;
}
