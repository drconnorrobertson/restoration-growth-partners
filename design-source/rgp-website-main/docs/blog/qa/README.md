# Blog QA records (CORE_CONTRACTS §29 → "QA record")

One file per post: `docs/blog/qa/{slug}.md` (the slug = the post file name). The QA reviewer writes it after
auditing the post against its brief and fixing the post file (Stage F step 3, `restoration-page-copywriter`
→ Blog Mode → "Batch"). This README is not a record.

**Enforced:** every post with `draft: false` must have a record whose first 10 lines include

    Verdict: Ready              ← or: Verdict: Ready after fixes
    Reviewer: <who reviewed>    ← e.g. QA-W03 (Sonnet 5.5, high)

`npm run check` (`validate:blog-qa`), `npm run build` / `check:built` (postbuild) and `validate:built` fail
naming each non-draft post whose record is missing, has another verdict, or has no reviewer. Drafts are
exempt. A post with an open question uses `Verdict: Needs answer` and stays `draft: true` until the human
answers and the record is updated.

## Template

```markdown
# QA record — {slug}

Verdict: Ready after fixes
Reviewer: QA-W03 (Sonnet 5.5, high)
Date: 2026-10-14
Brief: {row_id} — {brief Doc URL or local copy}
Words: 1,180 (brief range 1,000–1,400)

## What QA fixed
- Removed "the EPA says…" — not in the brief's sources.
- Reordered Step 1–3: people out → gas → electricity → water → photos.
- Closing section now links /water-damage-restoration/ and the phone line.

## Checked
Facts vs sources · attribution · safety order · company claims (intake only, once each) · links · length ·
title ≤ 60 / description ≤ 160 · rendered text (no glued words)

## Open questions for the human
- None.
```

Related files (Stage F): `docs/blog/schedule.tsv` (the slot of every scheduled brief) and
`docs/blog/skipped.tsv` (briefs not scheduled for this client, with the reason). `npm run blog:review` builds
the developer review page from the posts, these records and the build's own covers.
