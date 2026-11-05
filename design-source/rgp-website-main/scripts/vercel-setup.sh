#!/usr/bin/env bash
# Link this client repo to a Vercel project in the agency scope and connect it to GitHub so EVERY push
# deploys: main → production URL, other branches → preview URLs (CORE_CONTRACTS §25).
# Also creates the blog-publish deploy hook and stores it as the repo's Actions secret (scripts/vercel-hook-setup.mjs).
# Usage: npm run vercel:setup [-- <slug>]     Requires: npm run repo:setup done; `vercel login` done (role Member or Owner);
# the Vercel GitHub App installed on the agency GitHub organization (one-time, done 2026-10-08).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; cd "$ROOT"
TEAM=$(node -p "require('./hosting.json').vercelTeam")
SLUG="${1:-$(basename "$ROOT")}"
command -v vercel >/dev/null || { echo "✗ vercel CLI required (npm i -g vercel)"; exit 1; }
vercel whoami >/dev/null 2>&1 || { echo "✗ not logged in to Vercel — run: vercel login (with your company email)"; exit 1; }
vercel teams ls 2>&1 | grep -qw "$TEAM" || { echo "✗ this Vercel login is not a member of the $TEAM team — run: vercel login (with your company email)"; exit 1; }
git remote get-url origin >/dev/null 2>&1 || { echo "✗ no GitHub remote — run npm run repo:setup first"; exit 1; }
vercel link --yes --scope "$TEAM" --project "$SLUG" >/dev/null && echo "· linked to project $SLUG (scope $TEAM)"
if ! vercel git connect --yes --scope "$TEAM" >/dev/null 2>&1; then
  echo "✗ could not connect the GitHub repo to Vercel. Usually the Vercel GitHub App is not installed on the agency GitHub account."
  echo "  Human step: Vercel dashboard → Settings → Git → install the GitHub App for $(node -p "require('./hosting.json').githubOwner"), grant this repo, then rerun."; exit 1; fi
echo "· git connected — pushes to $(node -p "require('./hosting.json').productionBranch") deploy to production, other branches to previews"
# Build machine: every client project runs on the machine named in hosting.json (standard). A faster machine only
# shortens builds and costs ~3x per build; it does not change how fast the site loads (CORE_CONTRACTS §25).
# Selection is FIXED: with "elastic" Vercel moves a project to a bigger machine on its own (seen 2026-10-13).
MACHINE=$(node -p "require('./hosting.json').buildMachine")
PID=$(node -p "require('./.vercel/project.json').projectId"); OID=$(node -p "require('./.vercel/project.json').orgId")
if ! printf '{"resourceConfig":{"buildMachineType":"%s","buildMachineSelection":"fixed"}}' "$MACHINE" | vercel api "/v9/projects/$PID?teamId=$OID" -X PATCH -H 'Content-Type: application/json' --input - >/dev/null 2>&1; then
  echo "✗ could not set the Vercel build machine to $MACHINE (needs a team owner/admin login). Set it: Vercel project → Settings → Build and Deployment → Build Machine → Standard, then rerun."; exit 1; fi
echo "· build machine set to $MACHINE"
# Blog publishing (§29) + "Tell search engines" (§28): the deploy hook "publish-scheduled-posts" (branch main) stored as the
# repo's Actions secret VERCEL_DEPLOY_HOOK_URL — Vercel → GitHub directly, nobody sees the URL — and "Automatically expose
# System Environment Variables" on. Idempotent; needs a Member/Owner Vercel role (Developer gets 403). Alone: npm run vercel:hook
node scripts/vercel-hook-setup.mjs --project "$PID"
URL=$(vercel deploy --yes --scope "$TEAM" 2>/dev/null | tail -1)
echo "✓ first deployment: $URL   (site.previewMode is true → noindex; this URL is the Gate 4 preview)"
