# Static story publication E2E

1. Build the complete reviewed collection with Node 24. Serve dist under a project prefix. Open a canonical story in the in-app browser: title/first image/caption visible; switch multi/scroll, save, navigate next story and return; progress/favourites remain. Network contains HTTP images and manifests, no ZIP or story Blob image URLs.
2. Inspect generated HTML without running JS: title, hook, all captions, ordered images with dimensions/lazy hints, disclosures/source/original text, canonical, social image and escaped CreativeWork match the public manifest. Resolve all relative URLs beneath project prefix.
3. Open reader.html?story=<id>: reaches canonical story. Open reader.html?preview=1 and select a valid fixture ZIP: local preview displays without changing catalog/publication files.
4. Build a synthetic 80-page ZIP near the existing 256 MiB expanded limit, with one image near 12 MiB (owner confirmed preserving existing limits), in a temporary workspace. Manifest and HTML enumerate all pages, first eager/remaining lazy; reader initialization fetches no image bytes, creates no Blob URLs and allocates no aggregate image buffer. Do not put fixture assets in works/stories/dist of this repository.
5. Update one source ZIP in a temporary workspace and rebuild: new version directory, old version remains byte-identical, catalog/HTML reference only new version. Corrupt a ZIP and rebuild: failure leaves previous output unchanged. Remote manifest failure never requests another version or ZIP.


## Executed evidence — 2026-11-04

- Node24.22.1/pnpm11.25.0: 89 tests passed; full collection validated/built (22 stories/808 pages, 209.56 MiB). Tests directly parse generated HTML and inspect metadata/JSON/bytes without client execution.
- In-app browser: 黄忠智取定军山 canonical page contains44 figures. Initialization requested9/44 story images and0 ZIPs; every story image src is HTTP, no online Blob images. First image decoded (941px intrinsic width).
- Same browser/session: project prefix at127.0.0.1:4174/awesome-shiqu/ loads images and controls; multi/scroll works, favourite survives next-story/back, scroll saves nonzero progress and reload resumes the story row. `reader.html?story=yysun--zip-24371ad5e8e3670d7addfa3b` resolves to canonical route.
- Scripts disabled through same-tab CDP, then reloaded: title/first caption/all44 figures/previous-next nav remain visible; controls disabled. Script execution restored and page reloaded afterward.
- Local fixture selected through file chooser at`reader.html?preview=1`: two Blob images, local-preview notice, save disabled; no catalogue/deployment writes. Fixture never added to production story directories.
- Cacheable temporary static host at127.0.0.1:4175/awesome-shiqu/: reload produced browser memory-cache hits for unchanged versioned images. Repository preview intentionally uses no-store, so this host supplied cache headers solely to test normal browser caching; no production cache lifetime is claimed.
- Synthetic ZIP:80 pages/255.31MiB expanded image bytes, first image11.99MiB, builds and loads through one manifest fetch with0 image fetches/Blob allocations by the loader. Source/deploy limits unchanged.
- Actual workflow shell tested against disposable local bare Git remote: empty first publication, separate snapshot branch, original main source unchanged, restoration, and withdrawal pruning pass. No live CI run or deployment performed.
- Final preview screenshot: `/Users/esun/.codex/visualizations/2026/11/04/01a1a6c2-e9dc-7473-b06d-ae73260f1efb/static-story-publication.png`.
