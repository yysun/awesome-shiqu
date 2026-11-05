# Build from current story sources

ZIPs in Git are the reviewed source. Keeping generated historical JSON and images in a second branch duplicates storage and adds a repository-writing deployment job. The owner accepts that an old open or cached page may need a refresh after a story update.

## Acceptance criteria

- [x] CI builds from checked-out sources and deploys the resulting Pages artifact without restoring or committing publication snapshots, requiring repository write permission, or depending on a retention job.
- [x] Every successful build contains only current source versions; updating or withdrawing a story removes obsolete public assets, including on repeated local builds.
- [x] Current content-hashed asset URLs, canonical routes, ZIP validation, public-field/privacy controls, attribution, source and AI disclosures remain intact. Failed builds/promotions preserve the previous complete output.
- [x] README describes current-source builds and the refresh tradeoff. Node 24 / pinned pnpm tests, validation and full build pass.
- [x] Publish the workflow change to main before deleting origin/static-publication; verify the new workflow and branch absence.

No source ZIP edits, reader redesign, cache fallback, or replacement historical archive. Existing Git history is not rewritten.
