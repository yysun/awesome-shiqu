# Project instructions

- 后续新增或修改的代码注释使用中文。
- This is a standalone curated collection and static reader, separate from yysun/shiqu.
- Use Node 24 and the pnpm version pinned in package.json. There are no third-party runtime dependencies.
- Run pnpm test and pnpm build for changes affecting import, validation, or publication.
- Publish only reviewed stories explicitly selected by the owner. Keep test fixtures out of stories/ and dist/.
- Story content is untrusted input. Render prose as text, validate paths, and retain author, source, and AI disclosures.
- Keep production prompts and private generation data out of public story manifests.
- Preserve GitHub Pages project-subpath compatibility. Avoid absolute-root asset paths and server-only routes.
- Code licensing does not automatically license the stories or illustrations.
- Do not build desktop applications or Docker images for this repository.
