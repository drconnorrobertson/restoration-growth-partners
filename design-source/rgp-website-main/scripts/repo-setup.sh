#!/usr/bin/env bash
# Create the client's PRIVATE GitHub repo under the AGENCY ORGANIZATION and push main (CORE_CONTRACTS §25).
# Usage: npm run repo:setup [-- <slug>]   (slug defaults to the folder name)
# Pushes as the person running it (or the shared company login where it is signed in) via a repo-LOCAL credential helper — your global `gh` login is untouched.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; cd "$ROOT"
OWNER=$(node -p "require('./hosting.json').githubOwner")      # the GitHub organization
SHARED=$(node -p "require('./hosting.json').githubUser")     # shared company login
TEAM=$(node -p "require('./hosting.json').githubTeam")       # team that gets push on every client repo
BRANCH=$(node -p "require('./hosting.json').productionBranch")
SLUG="${1:-$(basename "$ROOT")}"
command -v gh >/dev/null || { echo "✗ gh CLI required"; exit 1; }
# Who acts: the shared company login if it is signed in on this machine, else the active gh login if it is an ACTIVE member of the org.
ME=$(gh api user --jq .login 2>/dev/null || true)
if gh auth token --user "$SHARED" >/dev/null 2>&1; then USERNAME=$SHARED
elif [ -n "$ME" ] && [ "$(gh api "orgs/$OWNER/memberships/$ME" --jq .state 2>/dev/null || true)" = "active" ]; then USERNAME=$ME
else echo "✗ gh is not signed in as a member of $OWNER — run: gh auth login (with your own GitHub account, which must be in the $OWNER org). Refusing to create a client repo anywhere else."; exit 1; fi
# GitHub "workflow" permission (§25): the starter ships .github/workflows/*, and GitHub rejects pushing them without
# the token's `workflow` scope — check the pushing account BEFORE creating or committing anything.
node scripts/check-gh-workflow-scope.mjs --user "$USERNAME" || exit 1
[ -d .git ] || git init -q
# commit identity = the acting GitHub account's no-reply address, so Vercel can match the commit author to a team member (a local Mac address gets the deploy BLOCKED)
git config --local user.email "$(gh api "users/$USERNAME" --jq .id)+$USERNAME@users.noreply.github.com"
git config --local user.name >/dev/null 2>&1 || git config --local user.name "$USERNAME"
# secrets guard — nothing that looks like a key may be tracked (§25)
if git ls-files -z | xargs -0 grep -lE '(sk_live_[0-9A-Za-z]+|AKIA[0-9A-Z]{16}|-----BEGIN (RSA |OPENSSH |EC )?PRIVATE KEY|ghp_[A-Za-z0-9]{36}|xox[baprs]-[0-9A-Za-z-]+)' 2>/dev/null | head -1 | grep -q .; then
  echo "✗ secret-looking content in tracked files — remove it (and rotate the key) before creating the repo"; exit 1; fi
grep -qE '^\.env' .gitignore 2>/dev/null || printf '.env\n.env.*\n' >> .gitignore
git add -A; git diff --cached --quiet || git commit -qm "Client site from agency starter"
git branch -M "$BRANCH"
# repo-local identity: reset the helper list, then answer with the agency account's token
git config --local --replace-all credential.helper ''
git config --local --add credential.helper "!f() { echo username=$USERNAME; echo password=\$(gh auth token --user $USERNAME); }; f"
TOKEN=$(gh auth token --user "$USERNAME")
if GH_TOKEN=$TOKEN gh repo view "$OWNER/$SLUG" >/dev/null 2>&1; then echo "· repo $OWNER/$SLUG already exists — reusing";
else GH_TOKEN=$TOKEN gh repo create "$OWNER/$SLUG" --private --description "Client website (agency Astro starter)" --disable-wiki >/dev/null && echo "· created private repo $OWNER/$SLUG"; fi
GH_TOKEN=$TOKEN gh api -X PUT "orgs/$OWNER/teams/$TEAM/repos/$OWNER/$SLUG" -f permission=push >/dev/null 2>&1 && echo "· $TEAM can push to it" || echo "! could not add $SLUG to the $TEAM team (needs a team maintainer or org owner) — ask one to add it or teammates cannot push"
git remote get-url origin >/dev/null 2>&1 || git remote add origin "https://github.com/$OWNER/$SLUG.git"
git push -u origin "$BRANCH"
VIS=$(GH_TOKEN=$TOKEN gh repo view "$OWNER/$SLUG" --json visibility -q .visibility)
[ "$VIS" = "PRIVATE" ] || { echo "✗ repo visibility is $VIS, not PRIVATE — fix in GitHub before continuing"; exit 1; }
echo "✓ https://github.com/$OWNER/$SLUG · private · $BRANCH pushed as $USERNAME"
