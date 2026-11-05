# Current-source publication verification

1. In a disposable fixture workspace, build a selected ZIP, record its manifest and image paths and canonical route. Update the ZIP at the same path and rebuild: catalog and HTML use the new hash, old version directory is absent, canonical route is unchanged. A clean build from those sources produces identical public files.
2. After a successful build, corrupt the source and try again: validation fails and previous catalog/assets remain unchanged. Simulate final rename failure: previous complete output is restored.
3. Remove the selected ZIP and rebuild: catalog is empty and old story assets are absent.
4. Run the full existing Node suite and complete production collection validation/build; privacy, attribution, source/AI disclosures, project-subpath paths, HTML and manifest loading still pass.
5. Publish main with the simplified workflow. Inspect its successful check/build/deploy jobs and confirm no retain job. Confirm no old retention run remains active; delete the remote snapshot branch and verify its absence. Deployment artifact includes current assets and no source ZIPs.
