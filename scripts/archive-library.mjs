// Index reviewed ZIPs with byte-preserving covers and distinct creator/contributor credits.
import {execFile} from 'node:child_process';
import {createHash} from 'node:crypto';
import {lstat, readdir} from 'node:fs/promises';
import path from 'node:path';
import {promisify} from 'node:util';
import {assert, LIMITS, regularFile} from './content.mjs';
import {parseStoryArchive} from '../site/assets/story-archive.mjs';
import {ZIP_LIMITS} from '../site/assets/zip.mjs';
import {encodeArchivePath, validArchiveName, validContributor} from '../site/assets/archive-path.mjs';

const run = promisify(execFile);
export const MAX_ARCHIVE_BYTES = ZIP_LIMITS.archiveBytes;
export {validArchiveName, validContributor};
export const validArchiveSlug = value => typeof value === 'string' && validArchiveName(`${value}.zip`);

export function archiveStoryId(contributor, filename) {
  assert(validContributor(contributor) && validArchiveName(filename), '作品文件名或作者目录无效。');
  const stem = filename.slice(0, -4).normalize('NFC');
  // Preserve existing links; other filenames get a stable ID independent of ZIP contents.
  const slug = stem.length <= 64 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(stem) ? stem
    : `zip-${createHash('sha256').update(stem).digest('hex').slice(0, 24)}`;
  return `${contributor}--${slug}`;
}

async function publishedDate(root, relative, stat) {
  try {
    const {stdout} = await run('git', ['log', '--diff-filter=A', '--format=%cs', '--reverse', '--', relative], {cwd: root, maxBuffer: 65536});
    const date = stdout.trim().split('\n')[0];
    if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  } catch { /* A source download need not contain Git history. */ }
  return stat.mtime.toISOString().slice(0, 10);
}

export async function readArchiveLibrary(root, {retainArchive = true, retainCover = true} = {}) {
  const works = path.join(root, 'works');
  let entries;
  try {
    const stat = await lstat(works);
    assert(stat.isDirectory() && !stat.isSymbolicLink(), 'works/ 必须是真实文件夹。');
    entries = await readdir(works, {withFileTypes: true});
  } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const stories = [], ids = new Set();
  let total = 0;
  for (const contributor of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (contributor.name === 'README.md' && contributor.isFile()) continue;
    assert(contributor.isDirectory() && !contributor.isSymbolicLink() && validContributor(contributor.name),
      `works/ 下只允许小写 GitHub 用户名目录：${contributor.name}`);
    const folder = path.join(works, contributor.name);
    const filenames = new Set();
    for (const file of (await readdir(folder, {withFileTypes: true})).sort((a, b) => a.name.localeCompare(b.name))) {
      assert(file.isFile() && !file.isSymbolicLink() && validArchiveName(file.name),
        `作品必须是 works/<GitHub 用户名>/<作品名>.zip；支持中文，文件名不能含路径分隔符、控制字符或过长：${contributor.name}/${file.name}`);
      const key = file.name.normalize('NFC').toLowerCase();
      assert(!filenames.has(key), `作品文件名仅大小写或 Unicode 形式不同：${contributor.name}/${file.name}`);
      filenames.add(key);
      const relativePath = `works/${contributor.name}/${file.name}`, filename = path.join(root, relativePath);
      const stat = await lstat(filename);
      assert(stat.size > 0 && stat.size <= MAX_ARCHIVE_BYTES, `${relativePath} 为空或超过 ${MAX_ARCHIVE_BYTES / 1024 / 1024} MiB。`);
      total += stat.size;
      assert(total <= LIMITS.siteBytes, '作品 ZIP 总量超过 950 MiB，请调整收藏规模。');
      const archive = await regularFile(filename, works, MAX_ARCHIVE_BYTES);
      const id = archiveStoryId(contributor.name, file.name);
      assert(!ids.has(id), `作品编号重复：${id}`); ids.add(id);
      let parsed;
      try {
        parsed = await parseStoryArchive(archive, {id, author: contributor.name, publishedAt: await publishedDate(root, relativePath, stat)});
      } catch (error) { throw new Error(`${relativePath}：${error.message}`); }
      const first = parsed.images.find(image => image.name === parsed.manifest.pages[0].image);
      assert(first, `${relativePath} 缺少封面。`);
      const sha256 = createHash('sha256').update(archive).digest('hex');
      stories.push({manifest: parsed.manifest, relativePath, sha256, archiveBytes: archive.length,
        coverName: `covers/${id}${path.extname(first.name)}`,
        coverExtension: path.extname(first.name),
        ...(retainArchive ? {archive} : {}), ...(retainCover ? {cover: Uint8Array.from(first.bytes)} : {})});
    }
  }
  return stories.sort((a, b) => b.manifest.publishedAt.localeCompare(a.manifest.publishedAt) || a.manifest.id.localeCompare(b.manifest.id));
}

export function archiveCatalogEntry(story) {
  const {pages, sourceText: _sourceText, ...metadata} = story.manifest;
  return {...metadata, pageCount: pages.length, cover: story.coverName, archive: encodeArchivePath(story.relativePath),
    sha256: story.sha256, archiveBytes: story.archiveBytes};
}

export function mergeCatalogs(...catalogs) {
  const stories = catalogs.flatMap(catalog => catalog.stories);
  const ids = new Set();
  for (const story of stories) { assert(!ids.has(story.id), `作品编号重复：${story.id}`); ids.add(story.id); }
  return {schemaVersion: 1, stories: stories.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || a.id.localeCompare(b.id))};
}
