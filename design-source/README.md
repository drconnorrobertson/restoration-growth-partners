# Preserved RGP design source

Start with [project context and design review](../docs/rgp-design-context.md).

- `rgp-website-main.zip`: unchanged original upload.
- `rgp-website-main/`: every original file extracted unchanged, including dotfiles, workflows, assets, fixtures, and tests.
- `manifest.json`: archive hash plus SHA-256 and size for all 230 files.

The nested Astro project is a design baseline. Its workflows are not installed at the repository root, and the existing static site remains the active site. Run its commands from its own directory only when deliberately previewing it. Make adaptations separately so this baseline remains intact.

## Draft PR status

The original ZIP is complete and unchanged. GitHub push protection blocked one extracted test fixture (`tests/search/hidden-prompt.test.mjs`), so 229 extracted files are present in the draft PR. The manifest retains all 230 entries. See the context document for the pending exception; the complete extracted import remains committed locally.
