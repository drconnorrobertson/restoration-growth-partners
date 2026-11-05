#!/usr/bin/env node
/**
 * search-setup.mjs — retired 2026-10-21 (owner decision: the agency Search Console and Bing keys live in GitHub,
 * nobody holds them). It used to ask each developer to paste the keys into a hidden prompt and saved them in
 * ~/.config/agency-website-builder/; that prompt could spill a paste into the shell. Kept only to point people
 * at the replacement. See CORE_CONTRACTS §28.
 */
console.error(`✗ search:setup is retired — there is nothing to set up on this computer any more.

  Everyone:   npm run gsc -- <status|verify|submit|inspect>   and   npm run bing -- <status|verify|submit>
              run on GitHub ("Search engines" workflow in agent-website-builder); you only need your gh login.
  Owner only: npm run search:connect   (once — stores the Google sign-in and Bing key as GitHub organization secrets)

  Old keys saved by search:setup in ~/.config/agency-website-builder/ (google-oauth-client.json, google-token.json,
  bing-api-key) are no longer used — delete them. (pagespeed-api-key is still read by perf:check if present.)`);
process.exit(1);
