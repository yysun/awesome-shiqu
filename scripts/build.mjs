#!/usr/bin/env node
import {copyFile, lstat, mkdir, mkdtemp, readdir, rename, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {assert, LIMITS, makeCatalog, readLibrary} from './content.mjs';
import {archiveCatalogEntry, mergeCatalogs, readArchiveLibrary} from './archive-library.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function copySite(source, destination, topLevel = true) {
  const stat = await lstat(source);
  assert(stat.isDirectory() && !stat.isSymbolicLink(), 'site/ 必须是真实文件夹。');
  let bytes = 0;
  for (const entry of await readdir(source, {withFileTypes: true})) {
    if (entry.name.startsWith('.')) continue;
    assert(!topLevel || !['stories', 'works', 'covers'].includes(entry.name), `site/${entry.name} 是作品构建保留路径。`);
    assert(!entry.isSymbolicLink(), `site/ 不允许符号链接：${entry.name}`);
    const from = path.join(source, entry.name), to = path.join(destination, entry.name);
    if (entry.isDirectory()) {
      await mkdir(to);
      bytes += await copySite(from, to, false);
      assert(bytes <= LIMITS.siteBytes, '站点文件超过 950 MiB，请先压缩或移除大图。');
    } else {
      assert(entry.isFile(), `site/ 不允许特殊文件：${entry.name}`);
      bytes += (await lstat(from)).size;
      assert(bytes <= LIMITS.siteBytes, '站点文件超过 950 MiB，请先压缩或移除大图。');
      await copyFile(from, to);
    }
  }
  return bytes;
}

export async function build(root = ROOT) {
  const stories = await readLibrary(root);
  const archives = await readArchiveLibrary(root);
  const destination = path.join(root, 'dist');
  try {
    const stat = await lstat(destination);
    assert(stat.isDirectory() && !stat.isSymbolicLink(), 'dist/ 必须是真实输出文件夹，不能是符号链接。');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const staging = await mkdtemp(path.join(root, '.dist-build-'));
  try {
    let size = await copySite(path.join(root, 'site'), staging);
    assert((await lstat(path.join(staging, 'index.html'))).isFile(), 'site/index.html 不存在。');
    assert((await lstat(path.join(staging, 'reader.html'))).isFile(), 'site/reader.html 不存在。');
    for (const {manifest, images} of stories) {
      const storyDirectory = path.join(staging, 'stories', manifest.id);
      await mkdir(path.join(storyDirectory, 'images'), {recursive: true});
      const json = JSON.stringify(manifest, null, 2) + '\n';
      size += Buffer.byteLength(json);
      await writeFile(path.join(storyDirectory, 'story.json'), json);
      for (const image of images) {
        size += image.bytes.length;
        assert(size <= LIMITS.siteBytes, '站点文件超过 950 MiB，请先压缩或移除大图。');
        await writeFile(path.join(storyDirectory, image.name), image.bytes);
      }
    }
    for (const story of archives) {
      for (const [relative, bytes] of [[story.relativePath, story.archive], [story.coverName, story.cover]]) {
        size += bytes.length;
        assert(size <= LIMITS.siteBytes, '站点文件超过 950 MiB，请先压缩或移除大图。');
        const destinationFile = path.join(staging, relative);
        await mkdir(path.dirname(destinationFile), {recursive: true});
        await writeFile(destinationFile, bytes);
      }
    }
    const catalog = mergeCatalogs(makeCatalog(stories), {stories: archives.map(archiveCatalogEntry)});
    const catalogJson = JSON.stringify(catalog, null, 2) + '\n';
    size += Buffer.byteLength(catalogJson);
    assert(size <= LIMITS.siteBytes, '站点文件超过 950 MiB，请先压缩或移除大图。');
    await writeFile(path.join(staging, 'catalog.json'), catalogJson);
    await writeFile(path.join(staging, '.nojekyll'), '');
    await rm(destination, {recursive: true, force: true});
    await rename(staging, destination);
    return {count: catalog.stories.length, pages: catalog.stories.reduce((sum, story) => sum + story.pageCount, 0), bytes: size};
  } catch (error) { await rm(staging, {recursive: true, force: true}); throw error; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log('用法：pnpm build\n验证 works/<GitHub 用户名>/<作品编号>.zip，生成书架目录和封面，并原样复制 ZIP。\n兼容已有 stories/ 作品。空作品集可以正常构建。');
  } else {
    try {
      const result = await build();
      console.log(`已生成 dist/：${result.count} 篇作品，${result.pages} 幅画面，${(result.bytes / 1024 / 1024).toFixed(2)} MiB。`);
    } catch (error) { console.error(`构建失败：${error.message}`); process.exitCode = 1; }
  }
}
