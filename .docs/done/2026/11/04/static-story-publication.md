# Static story publication

## Summary

Normal reading now serves complete HTML, immutable public manifests and original HTTP image bytes. ZIPs remain source evidence in the repository and are excluded from deployment. Browser enhancement retains modes, progress, favourites and recommendations; local ZIP preview remains separate. Chinese routes remain, with encoded canonical/sitemap URLs.

## Verification

Node 24.22.1/pnpm 11.25.0: `pnpm test`: 89/89 passed, `pnpm validate` and `pnpm build` passed across 22 stories/808 images (209.56 MiB). In-app browser verified initial/no-script reading, lazy HTTP images, cache reuse, project prefix, old links, local preview and reading state. Independent CR passed after review fixes.

## Notes

Local implementation milestones: `dbdef5e`, `80dcfb2`. No push or live deployment performed. CI saves immutable resources on `static-publication` before Pages deployment; that branch needs Actions write access. Retained selected-story versions count toward 950 MiB, with explicit failure at capacity. Withdrawal prunes an ID from subsequent deployment and current snapshot while retaining source Git history. Owner confirmed unchanged ZIP limits and Chinese route names.

Final browser preview: `/Users/esun/.codex/visualizations/2026/11/04/01a1a6c2-e9dc-7473-b06d-ae73260f1efb/static-story-publication.png`.

## Final VR result

VR risk: non-low — public publication, privacy, remote loading and deployment retention.
VR review round: 1; reviewer: reused (independent review agent).

All 19 acceptance criteria are complete:

| Criterion | Evidence |
|---|---|
| Static 1: manifests and unchanged referenced images | Full collection builds; byte-for-byte fixture comparisons pass. |
| Static 2: private content excluded | Allowlisted serialization, deployment scans, unused-entry exclusion and sanitized validation errors are covered. |
| Static 3: immutable version isolation | Update tests retain old bytes while new catalog/HTML reference only the new version. |
| Static 4: original ZIP provenance; no normal ZIP/Blob reading | Source paths, sizes and SHA-256 remain recorded; browser online reading uses HTTP images without ZIP requests or story Blob URLs. |
| Static 5: separate source/deployment capacity | Deployment excludes ZIPs; source ZIP and complete deployment limits remain enforced independently. |
| Loading 1: immediate content and native lazy loading | Initial HTML contains the story; browser initialization fetched 9 of 44 images. |
| Loading 2: cacheable HTTP resources | No online ZIP requests; unchanged versioned images produced browser cache hits on the cacheable static host. |
| Loading 3: preserved size boundaries | Legal 80-page/255.31 MiB fixture with an 11.99 MiB image builds and loads through one manifest request without image buffers or Blob allocation. |
| Loading 4: separate local preview | Fixture ZIP opens locally with preview notice and disabled save/share; publication files remain unchanged. |
| SEO 1: complete content without scripts | Same-tab script-disabled verification retained title, captions, 44 figures and story navigation. |
| SEO 2: accessible HTTP image relationships | Generated figures contain meaningful alt text, caption associations, intrinsic dimensions and loading hints; first image supplies sharing metadata. |
| SEO 3: metadata and injection safety | Direct HTML tests verify canonical/social/CreativeWork values, escaped prose and script-safe JSON. |
| SEO 4: sitemap and canonical entry | Sitemap contains canonical story routes; initial image elements associate images with stories; old query links redirect and carry noindex. |
| SEO 5: generated HTML verification | Tests inspect emitted HTML directly, including project-subpath URLs, without client execution. |
| Integrity 1: validation before publication | Existing ZIP/CRC/path/size/hash checks remain; validation and promotion failures preserve the previous release. |
| Integrity 2: one verified version | Public manifests retain image hashes and ZIP provenance; catalog, HTML and images derive from the same prepared publication. |
| Integrity 3: compatibility | Legacy input, old query links, local preview, book/category routes, project prefix, modes, favourites and resumed progress are covered. |
| Integrity 4: independent remote reader | Selected-publication loading, exact-manifest failure behavior and remote book/theme origins pass; the selected Pages endpoint supports public JSON/CORS requests. |
| Integrity 5: complete verification | Node 24.22.1/pnpm 11.25.0: 89/89 tests passed; validation and build passed for 22 stories/808 images, producing 209.56 MiB. |

Every plan task is complete. The prior CR verdict remains valid. Live Actions execution and production deployment were not performed; workflow save/restore/pruning was exercised against a disposable Git origin.

VR passed: all acceptance criteria complete
