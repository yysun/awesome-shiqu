# Build publications from current sources

## Summary

Removed the historical publication snapshot branch lifecycle and local retention. Builds generate current content-hashed JSON, images and HTML from reviewed sources; GitHub Actions checks, builds and deploys without committing generated files. AGENTS.md now requires new or modified code comments to use Chinese.

## Verification

Implementation commit: 0ef7bc2. Node 24.22.1 / pnpm 11.25.0: 88 tests passed, 23 stories / 878 pages validated and built, 220.17 MiB. Production artifact inspection found exactly 23 current version directories and no ZIPs. GitHub Actions run https://github.com/yysun/awesome-shiqu/actions/runs/42083850602 successfully deployed before origin/static-publication was deleted. GitHub's branches API then listed only main.

## Notes

Old open or cached pages may need refreshing after a story update. Canonical story links and current version isolation remain. Failed builds/promotions preserve prior output. No ZIP changes, new dependencies or Git history rewrite.

## Final VR result

VR risk: non-low — deployment lifecycle and historical asset availability change.
VR review round: 1; reviewer: reused.

| Acceptance criterion | Result | Evidence |
| --- | --- | --- |
| CI builds current sources without snapshot restore, commits, repository write permission or retain dependency | Complete | Workflow contains check → build → deploy; successful Actions run `42083850602` has exactly those three jobs. |
| Successful builds publish only current versions and remove updated/withdrawn assets | Complete | Regression tests verify old manifest/image removal, one current version directory, clean/repeated output equivalence and source withdrawal. Inspected production output reports 23 current versions and no ZIPs. |
| Hashes, canonical routes, validation, privacy, attribution/disclosures and failed-build preservation remain intact | Complete | Implementation removes only retention paths; existing public-generation coverage passes. Updated tests verify stable canonical routes and preservation of catalog, manifest and image after validation/promotion failure. |
| README explains current-source builds and refresh tradeoff; required checks pass with supported versions | Complete | README updated; supplied Node 24.22.1 / pnpm 11.25.0 evidence: 88/88 tests, validation of 23 stories / 878 pages, full build at 220.17 MiB, diff check passed. |
| Publish workflow change before remote branch deletion and verify outcome | Complete | `0ef7bc2` is on main; successful deployment preceded deletion. Supplied GitHub evidence shows no active/queued older runs; deletion succeeded and remote-ref query returned empty. Local branch inventory confirms only main/origin/main. |

Owner follow-up complete: AGENTS.md contains the Chinese-comment rule, and new or modified code comments use Chinese. All plan tasks are checked and supported by evidence. No tests rerun during VR.

VR passed: all acceptance criteria complete.
