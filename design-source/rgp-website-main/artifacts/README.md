# Pipeline artifacts

Client builds place their approved handoff artifacts here:

- `messaging-pack.yaml`   — Stage 4a output (homepage copy, locked)
- `design-recipe.yaml`    — Stage 5 output (variants, tokens, per-page plans)
- `active-page-map.yaml`  — Stage 1+3 output (pages, briefs, navigation)

`npm run check` validates whatever is here via `scripts/validate-artifacts.mjs`.
When this directory has no artifacts (the bare starter), the fixtures in
`examples/` are validated instead so the validators themselves are always
exercised. The fixtures must stay VALID — they double as worked examples of
each schema.
