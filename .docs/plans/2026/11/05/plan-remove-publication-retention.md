# Remove publication retention

Story: remove-publication-retention. Git base: 8425bb2.
Risk: non-low — deployment dependencies and historical public-asset availability change. The owner explicitly accepts refreshing old pages after source updates.

AR risk: non-low — historical asset availability and deployment lifecycle change.
AR review round: 1; reviewer: new (independent review agent).
AR passed: no blocking architecture flaws.

Owner follow-up: add a Chinese-language rule in AGENTS.md requiring new or modified code comments to use Chinese; apply it to comments changed in this task.

## Decision and tasks

Keep current content-addressed publication generation. Remove only historical retention and its CI storage lifecycle. Stage and promote complete builds with existing rollback behavior.

- [x] Remove snapshot restore/upload/retain steps and contents-write permission from .github/workflows/pages.yml; deploy depends on build.
- [x] Remove retainPublications and both old-dist/environment restore paths; clean obsolete ignore entry and explain the new lifecycle in README.
- [x] Adapt regression coverage: source updates remove all previous version files, clean and repeated builds agree, withdrawal removes assets, failed validation/promotion keeps previous output. Remove obsolete snapshot-shell tests.
- [ ] Run pnpm test, pnpm validate, pnpm build under Node 24.22.1 and pnpm 11.25.0. Check diff and independently review the complete change.
- [ ] Push the workflow update to main, observe successful Actions deployment, then delete static-publication and verify it remains absent.

## Validation and rollout

See .docs/tests/test-remove-publication-retention.md. No viewer UI changes; artifact-level regression tests and the actual workflow cover the changed boundaries. Historical version URLs intentionally expire at the next successful deploy. Existing rollback and privacy coverage must continue passing. Do not delete the branch while an old retain workflow is running; verify active runs during rollout. Never force push or rewrite source history.

TT: Node 24.22.1 / pnpm 11.25.0: pnpm test passed 88/88; pnpm validate passed 23 stories / 878 pages; pnpm build passed 23 stories / 878 pages, 220.17 MiB. git diff --check passed. The first sandboxed test attempt could not bind the preview server; the complete rerun with localhost access passed.
