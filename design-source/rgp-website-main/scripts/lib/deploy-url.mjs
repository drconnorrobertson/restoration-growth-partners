/**
 * Which address `npm run deploy:verify` smoke-tests (CORE_CONTRACTS §25). Pure functions; the script does the I/O.
 *
 * The link Vercel posts on the GitHub commit status is its DASHBOARD page (vercel.com/<team>/<project>/<id>), and
 * the deployment's own `<project>-<hash>.vercel.app` address sits behind Vercel Deployment Protection. Smoke-testing
 * either reports `/` as 308/302 and robots/llms/sitemap as 404 while the site is fine, so neither is ever used:
 *   1. `--url <address>` — always wins.
 *   2. Launched site (`site.previewMode === false`): the production URL, `site.siteUrl`.
 *   3. Pre-launch (`previewMode` true): the Vercel project's stable production alias (a `*.vercel.app` domain on the
 *      project, which every push to `main` updates), looked up from the Vercel API. Its name can be shortened by
 *      Vercel (CVW: `client-central-valley-water-restora.vercel.app`), so it is read, never guessed.
 */

const PLACEHOLDER_HOST = /(^|\.)example\.(com|org|net)$/i;

const originOf = (value) => {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.origin : null;
  } catch { return null; }
};

/** `https://vercel.com/<team>/<project>/<deploymentId>` (the GitHub status link) → { team, project }, else null. */
export function vercelProjectFromStatusUrl(statusUrl) {
  try {
    const u = new URL(statusUrl);
    if (u.hostname !== 'vercel.com') return null;
    const [team, project] = u.pathname.split('/').filter(Boolean);
    return team && project ? { team, project } : null;
  } catch { return null; }
}

/**
 * From the Vercel project-domains response (`/v9/projects/<p>/domains?production=true`), the stable production
 * alias: a verified, non-redirecting `*.vercel.app` domain that belongs to production (no git branch / custom env).
 */
export function pickStableAlias(response) {
  const domains = Array.isArray(response?.domains) ? response.domains : [];
  const alias = domains.find((d) => d && typeof d.name === 'string' && /\.vercel\.app$/i.test(d.name)
    && d.verified !== false && !d.redirect && !d.gitBranch && !d.customEnvironmentId);
  return alias ? `https://${alias.name.toLowerCase()}` : null;
}

/**
 * The smoke-test origin and why it was chosen.
 * Returns { url, source } — or { url: null, problem } with the exact fix; the caller fails the run on a problem.
 *   cliUrl: the --url value; site: { previewMode, siteUrl } from src/data/site.ts (null if unreadable);
 *   alias: the stable production alias from pickStableAlias (null if the lookup failed).
 */
export function chooseSmokeUrl({ cliUrl = null, site = null, alias = null } = {}) {
  if (cliUrl) {
    const url = originOf(cliUrl.includes('://') ? cliUrl : `https://${cliUrl}`);
    return url ? { url, source: '--url' } : { url: null, problem: `--url "${cliUrl}" is not a web address` };
  }
  if (!site) {
    return { url: null, problem: 'could not read site.previewMode / site.siteUrl from src/data/site.ts — run from the client repo root, or pass --url <production or alias address>' };
  }
  if (site.previewMode === false) {
    const url = originOf(site.siteUrl || '');
    if (!url || PLACEHOLDER_HOST.test(new URL(url).hostname)) {
      return { url: null, problem: `site.previewMode is false but site.siteUrl is "${site.siteUrl || ''}" — set the real production URL in src/data/site.ts, or pass --url` };
    }
    return { url, source: 'site.siteUrl (launched site)' };
  }
  if (alias) {
    const url = originOf(alias);
    if (url) return { url, source: "the Vercel project's stable production alias (site.previewMode is true)" };
  }
  return {
    url: null,
    problem: "site.previewMode is true and the Vercel project's stable *.vercel.app address could not be looked up "
      + '(needs `vercel login` as a member of the agency Vercel team). Re-run with --url https://<alias>.vercel.app '
      + '(Vercel → Project → Settings → Domains). The per-deployment link is protected and is never tested.',
  };
}
