import {execFile} from 'node:child_process';
import {createHash} from 'node:crypto';
import {lstat, readdir} from 'node:fs/promises';
import path from 'node:path';
import {promisify} from 'node:util';
import {assert, LIMITS, regularFile} from './content.mjs';
import {parseStoryArchive} from '../site/assets/story-archive.mjs';

const run = promisify(execFile);
export const MAX_ARCHIVE_BYTES = 25 * 1024 * 1024;
export const validContributor = value => typeof value === 'string' && value.length <= 39 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
export const validArchiveSlug = value => typeof value === 'string' && value.length <= 64 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);

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
    for (const file of (await readdir(folder, {withFileTypes: true})).sort((a, b) => a.name.localeCompare(b.name))) {
      const slug = file.name.endsWith('.zip') ? file.name.slice(0, -4) : '';
      assert(file.isFile() && !file.isSymbolicLink() && validArchiveSlug(slug),
        `作品必须是 works/<GitHub 用户名>/<小写作品编号>.zip：${contributor.name}/${file.name}`);
      const relativePath = `works/${contributor.name}/${file.name}`, filename = path.join(root, relativePath);
      const stat = await lstat(filename);
      assert(stat.size > 0 && stat.size <= MAX_ARCHIVE_BYTES, `${relativePath} 为空或超过 25 MiB。`);
      total += stat.size;
      assert(total <= LIMITS.siteBytes, '作品 ZIP 总量超过 950 MiB，请调整收藏规模。');
      const archive = await regularFile(filename, works, MAX_ARCHIVE_BYTES);
      const id = `${contributor.name}--${slug}`;
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
        ...(retainArchive ? {archive} : {}), ...(retainCover ? {cover: first.bytes} : {})});
    }
  }
  return stories.sort((a, b) => b.manifest.publishedAt.localeCompare(a.manifest.publishedAt) || a.manifest.id.localeCompare(b.manifest.id));
}

export function archiveCatalogEntry(story) {
  const {pages, ...metadata} = story.manifest;
  return {...metadata, pageCount: pages.length, cover: story.coverName, archive: story.relativePath,
    sha256: story.sha256, archiveBytes: story.archiveBytes};
}

export function mergeCatalogs(...catalogs) {
  const stories = catalogs.flatMap(catalog => catalog.stories);
  const ids = new Set();
  for (const story of stories) { assert(!ids.has(story.id), `作品编号重复：${story.id}`); ids.add(story.id); }
  return {schemaVersion: 1, stories: stories.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || a.id.localeCompare(b.id))};
}
