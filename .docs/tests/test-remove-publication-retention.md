# Current-source publication verification

1. In a disposable fixture workspace, build a selected ZIP, record its manifest and image paths and canonical route. Update the ZIP at the same path and rebuild: catalog and HTML use the new hash, old version directory is absent, canonical route is unchanged. A clean build from those sources produces identical public files.
2. After a successful build, corrupt the source and try again: validation fails and previous catalog/assets remain unchanged. Simulate final rename failure: previous complete output is restored.
3. Remove the selected ZIP and rebuild: catalog is empty and old story assets are absent.
4. Run the full existing Node suite and complete production collection validation/build; privacy, attribution, source/AI disclosures, project-subpath paths, HTML and manifest loading still pass.
5. Publish main with the simplified workflow. Inspect its successful check/build/deploy jobs and confirm no retain job. Confirm no old retention run remains active; delete the remote snapshot branch and verify its absence. Deployment artifact includes current assets and no source ZIPs.

## Executed evidence — 2026-11-05

- Scenarios 1–3: tests/static-publication.test.mjs passed, including content changes, removal of old manifest/image directories, unchanged canonical route, byte-identical repeated/clean dist, validation failure, simulated promotion failure and withdrawal. Test workspaces were disposable; no fixtures entered the production collection.
- Scenario 4: Node 24.22.1 / pnpm 11.25.0: pnpm test 88/88; pnpm validate 23 stories / 878 pages; pnpm build 23 stories / 878 pages, 220.17 MiB. Existing HTML, privacy, manifest/loading and project-subpath tests passed. Production dist has exactly one version directory per catalog story (23 total) and no ZIPs.
- Scenario 5: implementation 0ef7bc2 pushed to main; https://github.com/yysun/awesome-shiqu/actions/runs/42083850602 passed check/build/deploy with no retention job. GitHub reported no active/queued runs before deletion. Remote deletion succeeded and git ls-remote --heads origin static-publication returned no refs. No source history rewrite.
